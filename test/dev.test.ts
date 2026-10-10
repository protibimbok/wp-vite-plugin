import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextHolder } from '../src/build/config.js';
import { wpVite, type HotFile, type WPViteContext, type WPViteOptions } from '../src/index.js';
import { fixture } from './helpers.js';

const hotFileIn = (dir: string) => path.join(dir, 'build', '.wp-vite', 'hot.json');

interface Started {
  server: ViteDevServer;
  ctx: WPViteContext;
  origin: string;
  root: string;
  hotFile: string;
}

let started: Started | undefined;
let tempDir: string | undefined;

// Each test works on a temp copy: the hot file lands in `build/`, which the build tests of the same
// fixtures wipe and list concurrently, and the hot-update tests edit sources.
async function copyFixture(name: string): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-dev-'));
  await fs.cp(fixture(name), tempDir, { recursive: true, filter: (src) => path.basename(src) !== 'build' });
  return tempDir;
}

async function start(options: WPViteOptions = {}, extraPlugins: Plugin[] = [], name = 'basic-block'): Promise<Started> {
  const dir = await copyFixture(name);
  const plugins = wpVite({ entries: { 'admin/index': 'src/admin.ts' }, ...options });
  const server = await createServer({
    root: dir,
    configFile: false,
    logLevel: 'silent',
    plugins: [...plugins, ...extraPlugins],
    server: { port: 0, host: 'localhost' },
  });
  await server.listen();
  const ctx = (plugins[0]!.api as ContextHolder).get();
  started = { server, ctx, origin: ctx.devOrigin!, root: dir, hotFile: hotFileIn(dir) };
  return started;
}

const readHot = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8')) as HotFile;

// The hot file is written once the dependency crawl finishes, after listen() has returned.
const waitForHot = (file: string) => vi.waitFor(() => readHot(file), { timeout: 15_000, interval: 25 });

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

async function touch(server: ViteDevServer, file: string, content: string) {
  await fs.writeFile(file, content);
  server.watcher.emit('change', file);
}

afterEach(async () => {
  await started?.server.close();
  started = undefined;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('dev server', () => {
  it('writes the hot file with crawled dependencies on listen and removes it on close', async () => {
    const listeners = process.listenerCount('SIGINT');
    const { server, origin, hotFile } = await start();
    expect(origin).toMatch(/^http:\/\/localhost:\d+$/);
    expect(server.config.server.origin).toBe(origin);

    const hot = await waitForHot(hotFile);
    expect(process.listenerCount('SIGINT')).toBe(listeners + 1);
    expect(hot).toEqual({
      origin,
      srcDir: 'src',
      refresh: false,
      entries: {
        'admin/index': {
          url: `${origin}/src/admin.ts`,
          src: 'src/admin.ts',
          format: 'es',
          scripts: ['wp-api-fetch', 'wp-element', 'wp-i18n'],
          modules: ['@wordpress/a11y'],
          styles: [],
        },
        'blocks/basic/index': {
          url: `${origin}/src/blocks/basic/index.tsx`,
          src: 'src/blocks/basic/index.tsx',
          format: 'iife',
          scripts: ['react-jsx-runtime', 'wp-blocks', 'wp-i18n'],
          modules: [],
          styles: [],
        },
        'blocks/basic/view': {
          url: `${origin}/src/blocks/basic/view.ts`,
          src: 'src/blocks/basic/view.ts',
          format: 'iife',
          scripts: ['wp-i18n'],
          modules: ['@wordpress/a11y'],
          styles: [],
        },
      },
      blocks: [{ name: 'fixture/basic', dir: 'src/blocks/basic' }],
    });
    expect(await fs.readdir(path.dirname(hotFile))).toEqual(['hot.json']);

    await server.close();
    expect(await exists(path.dirname(hotFile))).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it('lists imported stylesheets and leaves stylesheet entries alone', async () => {
    const { origin, hotFile } = await start({ entries: { 'admin/index': 'src/admin/index.ts' } }, [], 'css-split');
    const { entries } = await waitForHot(hotFile);
    expect(entries['admin/index']).toMatchObject({
      scripts: [],
      modules: [],
      styles: [`${origin}/src/admin/admin.css`, `${origin}/src/admin/style.css`, `${origin}/src/shared/style.scss`, `${origin}/src/shared/widget.css`],
    });
    expect(entries['blocks/styled/index']).toMatchObject({
      scripts: ['react-jsx-runtime', 'wp-blocks'],
      styles: [`${origin}/src/blocks/styled/editor.module.css`],
    });
    expect(entries['blocks/styled/style']).toMatchObject({ format: 'css', scripts: [], modules: [], styles: [] });
    expect(entries['blocks/styled/editor']).toMatchObject({ format: 'css', styles: [] });
  });

  it('skips the hot file with hot: false', async () => {
    const { server, hotFile } = await start({ hot: false });
    await server.transformRequest('/src/blocks/basic/index.tsx');
    expect(await exists(hotFile)).toBe(false);
  });

  it('reports refresh when a react refresh plugin is present', async () => {
    const { origin, hotFile } = await start({}, [{ name: 'vite:react-refresh' }]);
    const hot = await waitForHot(hotFile);
    expect(hot.refresh).toBe(true);

    const preamble = await fetchText(`${origin}/@wp-vite/react-refresh-preamble`);
    expect(preamble.status).toBe(200);
    expect(preamble.text).toContain(`import RefreshRuntime from '${origin}/@react-refresh'`);
    expect(preamble.text).toContain('__vite_plugin_react_preamble_installed__ = true');
  });

  it('serves an empty preamble without react refresh', async () => {
    const { origin } = await start();
    const preamble = await fetchText(`${origin}/@wp-vite/react-refresh-preamble`);
    expect(preamble.status).toBe(200);
    expect(preamble.text).not.toContain('RefreshRuntime');
  });

  it('serves wp module shims with CORS headers', async () => {
    const { origin } = await start();
    const res = await fetchText(`${origin}/@wp-vite/wp-module/@wordpress/interactivity`, { origin: 'http://wp.test' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.text).toBe('export * from "@wordpress/interactivity";\n');

    const bad = await fetchText(`${origin}/@wp-vite/wp-module/../etc/passwd`);
    expect(bad.status).toBe(404);
  });

  it('restricts the shim CORS origin to wpOrigin', async () => {
    const { origin } = await start({ wpOrigin: 'http://wp.test' });
    const allowed = await fetchText(`${origin}/@wp-vite/wp-module/@wordpress/a11y`, { origin: 'http://wp.test' });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://wp.test');
    const denied = await fetchText(`${origin}/@wp-vite/wp-module/@wordpress/a11y`, { origin: 'http://other.test' });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rewrites globals, shims jsx-dev-runtime and points module externals at the shim middleware', async () => {
    const { server, origin } = await start();
    const block = await server.transformRequest('/src/blocks/basic/index.tsx');
    expect(block?.code).not.toContain('react/jsx-dev-runtime');
    expect(block?.code).not.toContain('@wordpress/blocks');
    expect(block?.code).toContain('window.wp.blocks.registerBlockType');
    expect(block?.code).toContain('jsxDEV');
    expect(block?.code).toMatch(/from "\/@wp-vite\/jsx-dev-runtime(?:\?[^"]*)?"/);

    const shim = await server.transformRequest('/@wp-vite/jsx-dev-runtime');
    expect(shim?.code).not.toContain('react/jsx-runtime');
    expect(shim?.code).toContain('window.ReactJSXRuntime.jsx(');
    expect(shim?.code).toContain('export function jsxDEV');

    const view = await server.transformRequest('/src/blocks/basic/view.ts');
    expect(view?.code).toContain(`from "${origin}/@wp-vite/wp-module/@wordpress/a11y"`);

    const served = await fetchText(`${origin}/@wp-vite/jsx-dev-runtime`);
    expect(served.status).toBe(200);
    expect(served.text).toContain('jsxDEV');
  });
});

describe('refresh preamble', () => {
  const PREAMBLE_IMPORT = /import "\/@wp-vite\/react-refresh-preamble(?:\?[^"]*)?";/;

  it('prepends the preamble import to every script entry when refresh is active', async () => {
    const { server } = await start({}, [{ name: 'vite:react-refresh' }]);
    for (const url of ['/src/blocks/basic/index.tsx', '/src/blocks/basic/view.ts', '/src/admin.ts']) {
      const result = await server.transformRequest(url);
      expect(result?.code, url).toMatch(PREAMBLE_IMPORT);
      // Module imports evaluate in source order, so the preamble has to be the first one.
      expect(result?.code.indexOf('/@wp-vite/react-refresh-preamble'), url).toBeLessThan(result!.code.indexOf('/src/blocks/basic/shared.js'));
    }
    const shared = await server.transformRequest('/src/blocks/basic/shared.js');
    expect(shared?.code).not.toMatch(PREAMBLE_IMPORT);
  });

  it('leaves entries untouched without a refresh plugin', async () => {
    const { server } = await start();
    const block = await server.transformRequest('/src/blocks/basic/index.tsx');
    expect(block?.code).not.toMatch(PREAMBLE_IMPORT);
    expect(block?.code).not.toContain('import.meta.hot');
  });
});

describe('hot updates', () => {
  it('re-crawls, rewrites the hot file and reloads the page when dependencies change', async () => {
    const { server, hotFile, root: dir } = await start();
    const before = await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const view = path.join(dir, 'src/blocks/basic/view.ts');
    await touch(server, view, `${await fs.readFile(view, 'utf8')}\nimport { select } from '@wordpress/data';\nselect;\n`);

    await vi.waitFor(async () => expect((await readHot(hotFile)).entries['blocks/basic/view']!.scripts).toEqual(['wp-data', 'wp-i18n']), { timeout: 15_000 });
    expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
    const after = await readHot(hotFile);
    expect(after.entries['blocks/basic/view']!.modules).toEqual(['@wordpress/a11y']);
    expect({ ...after, entries: { ...after.entries, 'blocks/basic/view': before.entries['blocks/basic/view'] } }).toEqual(before);
  });

  it('leaves the hot file alone and lets Vite handle the update when dependencies are unchanged', async () => {
    const { server, hotFile, root: dir } = await start();
    const before = await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const index = path.join(dir, 'src/blocks/basic/index.tsx');
    await touch(server, index, (await fs.readFile(index, 'utf8')).replace("'Basic block'", "'Basic block!'"));

    // An entry has no importers, so Vite itself falls back to a full reload (marked by triggeredBy).
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'full-reload', triggeredBy: expect.any(String) })), { timeout: 15_000 });
    expect(send).not.toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    expect(await readHot(hotFile)).toEqual(before);
    const served = await server.transformRequest('/src/blocks/basic/index.tsx');
    expect(served?.code).toContain('"Basic block!"');
  });

  it('rediscovers entries when a block.json changes', async () => {
    const { server, origin, hotFile, root: dir } = await start();
    await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const blockDir = path.join(dir, 'src/blocks/basic');
    await fs.writeFile(path.join(blockDir, 'module.ts'), "import { store } from '@wordpress/interactivity';\nstore('fixture/basic', {});\n");
    const blockJson = path.join(blockDir, 'block.json');
    const json = JSON.parse(await fs.readFile(blockJson, 'utf8')) as Record<string, unknown>;
    await touch(server, blockJson, JSON.stringify({ ...json, viewScriptModule: 'file:./module.ts' }, null, 2));

    const hot = await vi.waitFor(async () => {
      const hot = await readHot(hotFile);
      expect(hot.entries['blocks/basic/module']).toBeDefined();
      return hot;
    }, { timeout: 15_000 });
    expect(hot.entries['blocks/basic/module']).toEqual({
      url: `${origin}/src/blocks/basic/module.ts`,
      src: 'src/blocks/basic/module.ts',
      format: 'es',
      scripts: [],
      modules: ['@wordpress/interactivity'],
      styles: [],
    });
    expect(Object.keys(hot.entries)).toHaveLength(4);
    expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
  });
});
