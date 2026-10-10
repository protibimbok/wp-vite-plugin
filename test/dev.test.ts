import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextHolder } from '../src/build/config.js';
import { wpVite, type HotFile, type WPViteContext, type WPViteOptions } from '../src/index.js';
import { fixture } from './helpers.js';

const root = fixture('basic-block');
const hotFile = path.join(root, 'build', '.wp-vite', 'hot.json');

interface Started {
  server: ViteDevServer;
  ctx: WPViteContext;
  origin: string;
}

let started: Started | undefined;

async function start(options: WPViteOptions = {}, extraPlugins: Plugin[] = []): Promise<Started> {
  const plugins = wpVite({ entries: { 'admin/index': 'src/admin.ts' }, ...options });
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [...plugins, ...extraPlugins],
    server: { port: 0, host: 'localhost' },
  });
  await server.listen();
  const ctx = (plugins[0]!.api as ContextHolder).get();
  started = { server, ctx, origin: ctx.devOrigin! };
  return started;
}

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

afterEach(async () => {
  await started?.server.close();
  started = undefined;
  await fs.rm(path.join(root, 'build', '.wp-vite'), { recursive: true, force: true });
});

describe('dev server', () => {
  it('writes the hot file on listen and removes it on close', async () => {
    const listeners = process.listenerCount('SIGINT');
    const { server, origin } = await start();
    expect(process.listenerCount('SIGINT')).toBe(listeners + 1);
    expect(origin).toMatch(/^http:\/\/localhost:\d+$/);
    expect(server.config.server.origin).toBe(origin);

    const hot = JSON.parse(await fs.readFile(hotFile, 'utf8')) as HotFile;
    expect(hot).toEqual({
      origin,
      srcDir: 'src',
      refresh: false,
      entries: {
        'admin/index': { url: `${origin}/src/admin.ts`, src: 'src/admin.ts', format: 'es', scripts: [], modules: [], styles: [] },
        'blocks/basic/index': { url: `${origin}/src/blocks/basic/index.tsx`, src: 'src/blocks/basic/index.tsx', format: 'iife', scripts: [], modules: [], styles: [] },
        'blocks/basic/view': { url: `${origin}/src/blocks/basic/view.ts`, src: 'src/blocks/basic/view.ts', format: 'iife', scripts: [], modules: [], styles: [] },
      },
      blocks: [{ name: 'fixture/basic', dir: 'src/blocks/basic' }],
    });
    expect(await fs.readdir(path.dirname(hotFile))).toEqual(['hot.json']);

    await server.close();
    expect(await exists(path.dirname(hotFile))).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it('skips the hot file with hot: false', async () => {
    await start({ hot: false });
    expect(await exists(hotFile)).toBe(false);
  });

  it('reports refresh when a react refresh plugin is present', async () => {
    const { origin } = await start({}, [{ name: 'vite:react-refresh' }]);
    const hot = JSON.parse(await fs.readFile(hotFile, 'utf8')) as HotFile;
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
