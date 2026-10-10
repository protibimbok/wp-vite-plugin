import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { ContextHolder } from '../build/config.js';
import { writeCopyFiles } from '../build/copy.js';
import type { WPViteContext } from '../context.js';
import { discoverEntries } from '../discovery/entries.js';
import { isInside } from '../discovery/names.js';
import { startDevBuild, type DevBuild } from './build.js';
import { crawlEntries, type DevDeps } from './crawl.js';
import { createHotFile, hotFilePath, removeHotFile, writeHotFile, type HotFile } from './hot-file.js';
import { REACT_REFRESH_PLUGIN } from './virtual.js';
import { wpModuleMiddleware } from './wp-modules.js';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const RELOAD_DEBOUNCE_MS = 100;

interface HotState {
  file: string;
  deps: DevDeps;
  current: HotFile | undefined;
}

interface DevState {
  server: ViteDevServer;
  origin: string;
  refresh: boolean;
  hot: HotState | undefined;
  build: DevBuild | undefined;
  buildKey: string;
  reloadTimer: NodeJS.Timeout | undefined;
  closed: boolean;
}

export function devServerPlugin(holder: ContextHolder, freshPlugins: () => Plugin[]): Plugin {
  let cleanup: (() => void) | undefined;
  let state: DevState | undefined;

  const log = (error: unknown) => {
    state?.server.config.logger.error(`[wp-vite] ${(error as Error).message}`, { error: error as Error, timestamp: true });
  };

  const publish = (hot: HotFile) => {
    if (!state?.hot || state.closed) return;
    const { file } = state.hot;
    state.hot.current = hot;
    writeHotFile(file, hot);
    cleanup ??= installCleanup(() => removeHotFile(file));
  };

  // Each IIFE environment rebuilds on its own; one reload covers a change shared between them.
  const scheduleReload = () => {
    if (!state || state.closed || !holder.get().options.liveReload) return;
    clearTimeout(state.reloadTimer);
    state.reloadTimer = setTimeout(() => {
      if (state && !state.closed) state.server.environments.client.hot.send({ type: 'full-reload', path: '*' });
    }, RELOAD_DEBOUNCE_MS);
  };

  const iifeKey = (ctx: WPViteContext) =>
    ctx.discovery.entries
      .filter((e) => e.format === 'iife')
      .map((e) => `${e.name}=${e.file}`)
      .join('\n');

  // Classic block scripts come from a watch build, restarted when the set of them changes.
  const syncBuild = async (current: DevState, ctx: WPViteContext) => {
    const key = iifeKey(ctx);
    if (key === current.buildKey && (current.build || !key)) return;
    current.buildKey = key;
    const previous = current.build;
    current.build = undefined;
    await previous?.close();
    if (!key || current.closed) return;
    try {
      current.build = await startDevBuild(current.server, freshPlugins, scheduleReload);
      if (current.closed) await current.build.close();
    } catch (error) {
      log(error);
    }
  };

  const writeCopies = (ctx: WPViteContext) => writeCopyFiles(ctx).catch(log);

  // The hot file switches WordPress to dev mode, so it is only written once the served entries'
  // dependencies are known and the classic scripts are built; until then pages use the production build.
  const start = async (current: DevState, ctx: WPViteContext) => {
    await writeCopies(ctx);
    await syncBuild(current, ctx);
    if (!current.hot) return;
    const [{ deps, errors }] = await Promise.all([crawlEntries(current.server.environments.client, ctx), current.build?.ready]);
    for (const { entry, error } of errors) {
      current.server.config.logger.error(`[wp-vite] ${entry.name}: ${error.message}`, { error, timestamp: true });
    }
    if (state !== current) return;
    current.hot.deps = deps;
    publish(createHotFile(ctx, current.origin, current.refresh, deps));
  };

  return {
    name: 'wp-vite:dev-server',
    apply: 'serve',

    configureServer(server) {
      const ctx = holder.get();
      const refresh = server.config.plugins.some((plugin) => plugin.name === REACT_REFRESH_PLUGIN);
      server.middlewares.use(wpModuleMiddleware(server.config));

      const { httpServer } = server;
      if (!httpServer) return;
      httpServer.once('listening', () => {
        const origin = resolveOrigin(server);
        ctx.devOrigin = origin;
        // Vite reads server.origin lazily when it rewrites asset URLs; without it, `/src/logo.png`
        // would resolve against the WordPress page instead of the dev server.
        if (!server.config.server.origin) server.config.server.origin = origin;

        const hot = ctx.options.hot === false ? undefined : { file: hotFilePath(ctx), deps: new Map(), current: undefined };
        state = { server, origin, refresh, hot, build: undefined, buildKey: '', reloadTimer: undefined, closed: false };
        void start(state, ctx);
      });
    },

    async hotUpdate({ file, modules }) {
      const current = state;
      if (this.environment.name !== 'client' || !current) return;
      const ctx = holder.get();
      const inSrc = isInside(ctx.options.srcDir, file);
      const blockJson = inSrc && path.basename(file) === 'block.json';
      const php = inSrc && file.endsWith('.php');
      if (!blockJson && !php && modules.length === 0) return;

      if (blockJson) {
        try {
          ctx.discovery = await discoverEntries(ctx.options);
        } catch (error) {
          log(error);
          return;
        }
        await syncBuild(current, ctx);
      }
      if (blockJson || php) await writeCopies(ctx);
      if (!current.hot?.current || (!blockJson && modules.length === 0)) return;

      // Broken modules are reported by Vite when the browser fetches them; the previous deps stand.
      const { deps } = await crawlEntries(this.environment, ctx, current.hot.deps);
      if (current.closed) return;
      current.hot.deps = deps;
      const next = createHotFile(ctx, current.origin, current.refresh, deps);
      if (JSON.stringify(next) === JSON.stringify(current.hot.current)) return;

      // WordPress enqueues the dependencies, so a change in them needs a fresh page.
      publish(next);
      this.environment.hot.send({ type: 'full-reload', path: '*' });
      return [];
    },

    async closeServer() {
      const current = state;
      if (!current) return;
      current.closed = true;
      clearTimeout(current.reloadTimer);
      cleanup?.();
      cleanup = undefined;
      state = undefined;
      await current.build?.close();
    },
  };
}

function resolveOrigin(server: ViteDevServer): string {
  const configured = server.config.server.origin;
  if (configured) return configured.replace(/\/$/, '');
  const resolved = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
  if (resolved) return new URL(resolved).origin;
  const address = server.httpServer?.address() as AddressInfo | null;
  const protocol = server.config.server.https ? 'https' : 'http';
  return `${protocol}://localhost:${address?.port ?? server.config.server.port}`;
}

// Vite closes the server on SIGTERM and on the `q` shortcut, but a plain SIGINT would exit without
// our closeServer hook, leaving WordPress pointed at a dead server.
function installCleanup(remove: () => void): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    remove();
    process.off('exit', run);
    for (const signal of SIGNALS) process.off(signal, onSignal);
  };
  const onSignal: NodeJS.SignalsListener = (signal) => {
    run();
    if (process.listenerCount(signal) === 0) process.exit();
  };
  process.on('exit', run);
  for (const signal of SIGNALS) process.on(signal, onSignal);
  return run;
}
