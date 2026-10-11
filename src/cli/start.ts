import path from 'node:path';
import { createServer, version as viteVersion, type ViteDevServer } from 'vite';
import pc from 'picocolors';
import { hotFilePath } from '../dev/hot-file.js';
import { version } from '../../package.json';
import { contextOf, inlineConfig, type CommonOptions } from './config.js';

export interface StartCommandOptions extends CommonOptions {
  host?: string | boolean;
  port?: number;
  strictPort?: boolean;
  force?: boolean;
}

// Same as `vite` with the plugin configured: the dev server, which launches the watch build of
// classic block scripts and writes the hot file on its own.
export async function runStart(options: StartCommandOptions = {}): Promise<ViteDevServer> {
  const config = inlineConfig(options);
  config.server = {};
  if (options.host !== undefined) config.server.host = options.host;
  if (options.port !== undefined) config.server.port = options.port;
  if (options.strictPort !== undefined) config.server.strictPort = options.strictPort;
  if (options.force !== undefined) config.forceOptimizeDeps = options.force;

  const server = await createServer(config);
  const ctx = contextOf(server.config);
  if (!server.httpServer) throw new Error('HTTP server not available');
  await server.listen();

  const { info } = server.config.logger;
  const ready = pc.dim(`ready in ${pc.reset(pc.bold(Math.ceil(performance.now())))} ms`);
  const mode = server.config.mode !== 'development' ? `  ${pc.bgGreen(` ${pc.bold(server.config.mode)} `)}` : '';
  info(`\n  ${pc.green(`${pc.bold('WP-VITE')} v${version}`)} ${pc.dim(`vite v${viteVersion}`)}${mode}  ${ready}\n`);
  server.printUrls();
  if (ctx.options.hot !== false) {
    const hot = path.relative(ctx.options.root, hotFilePath(ctx)).split(path.sep).join('/');
    info(`  ${pc.green('➜')}  ${pc.bold('Hot file')}: ${pc.cyan(hot)} ${pc.dim('(written once the first build finishes)')}`);
  }
  return server;
}
