import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextHolder } from '../src/build/config.js';
import { wpVite, type HotFile, type WPViteContext, type WPViteOptions } from '../src/index.js';
import { fixture, listFiles } from './helpers.js';

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

// Each test works on a temp copy: the dev server writes into `build/`, which the build tests of the
// same fixtures wipe and list concurrently, and the hot-update tests edit sources.
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

// The hot file is written once the dependency crawl and the first watch build finish, after listen().
const waitForHot = (file: string) => vi.waitFor(() => readHot(file), { timeout: 20_000, interval: 25 });

const builtFiles = (dir: string) => listFiles(path.join(dir, 'build'));
const readBuilt = (dir: string, file: string) => fs.readFile(path.join(dir, 'build', file), 'utf8');

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

async function touch(server: ViteDevServer, file: string, content: string) {
  await fs.writeFile(file, content);
  server.watcher.emit('change', file);
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  await started?.server.close();
  started = undefined;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('dev server', () => {
  it('writes the hot file for served entries on listen and removes it on close', async () => {
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
      },
      blocks: [{ name: 'fixture/basic', dir: 'src/blocks/basic', fields: {} }],
    });
    expect(await fs.readdir(path.dirname(hotFile))).toEqual(['hot.json']);

    await server.close();
    expect(await exists(path.dirname(hotFile))).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it('lists imported stylesheets, stylesheet entries and the block field map', async () => {
    const { origin, hotFile } = await start({ entries: { 'admin/index': 'src/admin/index.ts' } }, [], 'css-split');
    const { entries, blocks } = await waitForHot(hotFile);
    expect(entries['admin/index']).toMatchObject({
      scripts: [],
      modules: [],
      styles: [`${origin}/src/admin/admin.css`, `${origin}/src/admin/style.css`, `${origin}/src/shared/style.scss`, `${origin}/src/shared/widget.css`],
    });
    expect(entries['blocks/styled/index']).toBeUndefined();
    expect(entries['blocks/styled/style']).toEqual({
      url: `${origin}/src/blocks/styled/style.scss`,
      src: 'src/blocks/styled/style.scss',
      format: 'css',
      scripts: [],
      modules: [],
      styles: [],
    });
    expect(entries['blocks/styled/editor']).toMatchObject({ format: 'css', styles: [] });
    expect(blocks).toEqual([
      { name: 'fixture/styled', dir: 'src/blocks/styled', fields: { style: ['blocks/styled/style'], editorStyle: ['blocks/styled/editor'] } },
    ]);
  });

  it('skips the hot file with hot: false but still builds classic scripts', async () => {
    const { root, hotFile } = await start({ hot: false });
    await vi.waitFor(() => fs.access(path.join(root, 'build/blocks/basic/view.asset.php')), { timeout: 20_000 });
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

  it('prepends the preamble import to script module entries when refresh is active', async () => {
    const { server } = await start({}, [{ name: 'vite:react-refresh' }]);
    const admin = await server.transformRequest('/src/admin.ts');
    expect(admin?.code).toMatch(PREAMBLE_IMPORT);
    // Module imports evaluate in source order, so the preamble has to be the first one.
    expect(admin?.code.indexOf('/@wp-vite/react-refresh-preamble')).toBeLessThan(admin!.code.indexOf('/src/blocks/basic/shared.js'));
    for (const url of ['/src/blocks/basic/index.tsx', '/src/blocks/basic/shared.js']) {
      const result = await server.transformRequest(url);
      expect(result?.code, url).not.toMatch(PREAMBLE_IMPORT);
    }
  });

  it('leaves entries untouched without a refresh plugin', async () => {
    const { server } = await start();
    const admin = await server.transformRequest('/src/admin.ts');
    expect(admin?.code).not.toMatch(PREAMBLE_IMPORT);
    expect(admin?.code).not.toContain('import.meta.hot');
  });
});

describe('dev build', () => {
  it('builds classic block scripts, asset.php and block copies into outDir without CSS or manifests', async () => {
    const { root, hotFile } = await start();
    await waitForHot(hotFile);
    expect(await builtFiles(root)).toEqual([
      '.wp-vite/hot.json',
      'blocks-manifest.php',
      'blocks/basic/block.json',
      'blocks/basic/index.asset.php',
      'blocks/basic/index.js',
      'blocks/basic/view.asset.php',
      'blocks/basic/view.js',
    ]);

    const index = await readBuilt(root, 'blocks/basic/index.js');
    expect(index).toContain('window.wp.blocks.registerBlockType(');
    expect(index).toContain('window.ReactJSXRuntime.jsx(');
    expect(index).not.toContain('jsxDEV');
    expect(index).toContain('/** translators: block title */');
    expect(index).toMatch(/^\(function\(\) \{\n/);
    expect(await readBuilt(root, 'blocks/basic/index.asset.php')).toMatch(
      /^<\?php return array\('dependencies' => array\('react-jsx-runtime', 'wp-blocks', 'wp-i18n'\), 'version' => '[0-9a-f]{20}'\);\n$/,
    );
    expect(JSON.parse(await readBuilt(root, 'blocks/basic/block.json'))).toMatchObject({ editorScript: 'file:./index.js', viewScript: 'file:./view.js' });
    expect(await readBuilt(root, 'blocks-manifest.php')).toContain("'basic' => array(");
  });

  it('builds CSS imported by classic scripts but serves block.json stylesheets', async () => {
    const { root, hotFile } = await start({ entries: { 'admin/index': 'src/admin/index.ts' } }, [], 'css-split');
    await waitForHot(hotFile);
    const files = await builtFiles(root);
    expect(files).toContain('blocks/styled/index.js');
    expect(files).toContain('blocks/styled/index.css');
    expect(files).not.toContain('blocks/styled/style.css');
    expect(files).not.toContain('blocks/styled/editor.css');
    expect(files.filter((f) => f.startsWith('admin/'))).toEqual([]);
  });

  it('defines SCRIPT_DEBUG as true', async () => {
    const { root, hotFile } = await start({ entries: { 'admin/index': 'src/admin.ts', legacy: { src: 'src/legacy.ts', format: 'iife' } } });
    await waitForHot(hotFile);
    expect(await readBuilt(root, 'legacy.js')).not.toContain('SCRIPT_DEBUG');
  });

  it('starts no watch build when there are no classic entries', async () => {
    const { root, hotFile } = await start({ entries: {} }, [], 'index-only');
    await waitForHot(hotFile);
    expect(await builtFiles(root)).toEqual(['.wp-vite/hot.json']);
  });

  it('rebuilds on edit and sends a full reload', async () => {
    const { server, root, hotFile } = await start();
    await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const view = path.join(root, 'src/blocks/basic/view.ts');
    await fs.writeFile(view, `${await fs.readFile(view, 'utf8')}\nconsole.log('rebuilt');\n`);
    await vi.waitFor(async () => expect(await readBuilt(root, 'blocks/basic/view.js')).toContain('console.log("rebuilt")'), { timeout: 20_000 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' }), { timeout: 5_000 });
    expect(await readHot(hotFile)).toEqual(await readHot(hotFile));
  });

  it('sends nothing after a rebuild with liveReload: false', async () => {
    const { server, root, hotFile } = await start({ liveReload: false });
    await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const view = path.join(root, 'src/blocks/basic/view.ts');
    await fs.writeFile(view, `${await fs.readFile(view, 'utf8')}\nconsole.log('rebuilt');\n`);
    await vi.waitFor(async () => expect(await readBuilt(root, 'blocks/basic/view.js')).toContain('console.log("rebuilt")'), { timeout: 20_000 });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('copies PHP files again when they change', async () => {
    const { server, root, hotFile } = await start({ entries: {} }, [], 'copy-php');
    await waitForHot(hotFile);
    expect(await readBuilt(root, 'blocks/alpha/render.php')).toBe('<?php echo "alpha";\n');

    await touch(server, path.join(root, 'src/blocks/alpha/render.php'), '<?php echo "alpha!";\n');
    await vi.waitFor(async () => expect(await readBuilt(root, 'blocks/alpha/render.php')).toBe('<?php echo "alpha!";\n'), { timeout: 10_000 });
  });
});

describe('hot updates', () => {
  it('re-crawls, rewrites the hot file and reloads the page when dependencies change', async () => {
    const { server, hotFile, root: dir } = await start();
    const before = await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const admin = path.join(dir, 'src/admin.ts');
    await touch(server, admin, `${await fs.readFile(admin, 'utf8')}\nimport { select } from '@wordpress/data';\nselect;\n`);

    await vi.waitFor(
      async () => expect((await readHot(hotFile)).entries['admin/index']!.scripts).toEqual(['wp-api-fetch', 'wp-data', 'wp-element', 'wp-i18n']),
      { timeout: 15_000 },
    );
    expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
    const after = await readHot(hotFile);
    expect(after.entries['admin/index']!.modules).toEqual(['@wordpress/a11y']);
    expect({ ...after, entries: { ...after.entries, 'admin/index': before.entries['admin/index'] } }).toEqual(before);
  });

  it('leaves the hot file alone and lets Vite handle the update when dependencies are unchanged', async () => {
    const { server, hotFile, root: dir } = await start();
    const before = await waitForHot(hotFile);
    await server.transformRequest('/src/admin.ts');
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const admin = path.join(dir, 'src/admin.ts');
    await touch(server, admin, (await fs.readFile(admin, 'utf8')).replace('/wp/v2/posts', '/wp/v2/pages'));

    // An entry has no importers, so Vite itself falls back to a full reload (marked by triggeredBy).
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'full-reload', triggeredBy: expect.any(String) })), { timeout: 15_000 });
    expect(send).not.toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
    expect(await readHot(hotFile)).toEqual(before);
    const served = await server.transformRequest('/src/admin.ts');
    expect(served?.code).toContain('"/wp/v2/pages"');
  });

  it('hot-swaps a block.json stylesheet instead of reloading', async () => {
    const { server, origin, hotFile, root: dir } = await start({ entries: { 'admin/index': 'src/admin/index.ts' } }, [], 'css-split');
    await waitForHot(hotFile);
    const link = await fetchText(`${origin}/src/blocks/styled/style.scss`, { accept: 'text/css' });
    expect(link.status).toBe(200);
    expect(link.headers.get('content-type')).toContain('text/css');
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const style = path.join(dir, 'src/blocks/styled/style.scss');
    await touch(server, style, `${await fs.readFile(style, 'utf8')}\n.swapped { color: red; }\n`);
    await vi.waitFor(
      () => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', updates: [expect.objectContaining({ type: 'css-update', path: '/src/blocks/styled/style.scss?direct' })] })),
      { timeout: 15_000 },
    );
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'full-reload' }));
  });

  it('rediscovers entries, rewrites the block copy and restarts the build when a block.json changes', async () => {
    const { server, origin, hotFile, root: dir } = await start();
    await waitForHot(hotFile);
    const send = vi.spyOn(server.environments.client.hot, 'send');

    const blockDir = path.join(dir, 'src/blocks/basic');
    await fs.writeFile(path.join(blockDir, 'module.ts'), "import { store } from '@wordpress/interactivity';\nstore('fixture/basic', {});\n");
    await fs.writeFile(path.join(blockDir, 'extra.ts'), "console.log('extra');\n");
    const blockJson = path.join(blockDir, 'block.json');
    const json = JSON.parse(await fs.readFile(blockJson, 'utf8')) as Record<string, unknown>;
    await touch(server, blockJson, JSON.stringify({ ...json, viewScriptModule: 'file:./module.ts', viewScript: ['file:./view.ts', 'file:./extra.ts'] }, null, 2));

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
    expect(Object.keys(hot.entries)).toEqual(['blocks/basic/module', 'admin/index']);
    expect(hot.blocks).toEqual([{ name: 'fixture/basic', dir: 'src/blocks/basic', fields: { viewScriptModule: ['blocks/basic/module'] } }]);
    expect(send).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });

    expect(JSON.parse(await readBuilt(dir, 'blocks/basic/block.json'))).toMatchObject({
      viewScriptModule: 'file:./module.js',
      viewScript: ['file:./view.js', 'file:./extra.js'],
    });
    await vi.waitFor(async () => expect(await readBuilt(dir, 'blocks/basic/extra.js')).toContain('console.log("extra")'), { timeout: 20_000 });
    expect(await exists(path.join(dir, 'build/blocks/basic/module.js'))).toBe(false);
  });
});
