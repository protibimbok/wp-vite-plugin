import type { AddressInfo } from 'node:net';
import type { Plugin, ViteDevServer } from 'vite';
import type { ContextHolder } from '../build/config.js';
import { createHotFile, hotFilePath, removeHotFile, writeHotFile } from './hot-file.js';
import { REACT_REFRESH_PLUGIN } from './virtual.js';
import { wpModuleMiddleware } from './wp-modules.js';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export function devServerPlugin(holder: ContextHolder): Plugin {
  let cleanup: (() => void) | undefined;

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

        const file = hotFilePath(ctx);
        writeHotFile(file, createHotFile(ctx, origin, refresh));
        cleanup = installCleanup(() => removeHotFile(file));
      });
    },

    closeServer() {
      cleanup?.();
      cleanup = undefined;
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
