import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { ContextHolder } from '../build/config.js';
import { discoverEntries } from '../discovery/entries.js';
import { isInside } from '../discovery/names.js';
import { crawlEntries, type DevDeps } from './crawl.js';
import { createHotFile, hotFilePath, removeHotFile, writeHotFile, type HotFile } from './hot-file.js';
import { REACT_REFRESH_PLUGIN } from './virtual.js';
import { wpModuleMiddleware } from './wp-modules.js';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

interface HotState {
  file: string;
  origin: string;
  refresh: boolean;
  deps: DevDeps;
  current: HotFile | undefined;
  closed: boolean;
}

export function devServerPlugin(holder: ContextHolder): Plugin {
  let cleanup: (() => void) | undefined;
  let state: HotState | undefined;

  const publish = (hot: HotFile) => {
    if (!state || state.closed) return;
    state.current = hot;
    writeHotFile(state.file, hot);
    cleanup ??= installCleanup(() => removeHotFile(state!.file));
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
        if (ctx.options.hot === false) return;

        state = { file: hotFilePath(ctx), origin, refresh, deps: new Map(), current: undefined, closed: false };
        // The hot file switches WordPress to dev mode, so it is only written once the dependencies
        // are known; until then pages keep using the production build.
        void crawlEntries(server.environments.client, ctx).then(({ deps, errors }) => {
          for (const { entry, error } of errors) {
            server.config.logger.error(`[wp-vite] ${entry.name}: ${error.message}`, { error, timestamp: true });
          }
          if (!state) return;
          state.deps = deps;
          publish(createHotFile(ctx, origin, refresh, deps));
        });
      });
    },

    async hotUpdate({ file, modules }) {
      if (this.environment.name !== 'client' || !state?.current) return;
      const ctx = holder.get();
      const blockJson = path.basename(file) === 'block.json' && isInside(ctx.options.srcDir, file);
      if (!blockJson && modules.length === 0) return;

      if (blockJson) {
        try {
          ctx.discovery = await discoverEntries(ctx.options);
        } catch (error) {
          this.environment.logger.error(`[wp-vite] ${(error as Error).message}`, { error: error as Error, timestamp: true });
          return;
        }
      }

      // Broken modules are reported by Vite when the browser fetches them; the previous deps stand.
      const { deps } = await crawlEntries(this.environment, ctx, state.deps);
      if (!state.current) return;
      state.deps = deps;
      const next = createHotFile(ctx, state.origin, state.refresh, deps);
      if (JSON.stringify(next) === JSON.stringify(state.current)) return;

      // WordPress enqueues the dependencies, so a change in them needs a fresh page.
      publish(next);
      this.environment.hot.send({ type: 'full-reload', path: '*' });
      return [];
    },

    closeServer() {
      if (state) state.closed = true;
      cleanup?.();
      cleanup = undefined;
      state = undefined;
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
