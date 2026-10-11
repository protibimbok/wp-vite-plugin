#!/usr/bin/env node
import { inspect } from 'node:util';
import { cac } from 'cac';
import pc from 'picocolors';
import { createLogger, type LogLevel } from 'vite';
import { version } from '../../package.json';
import { WPViteError } from '../errors.js';
import { runBuild } from './build.js';
import { runStart } from './start.js';

interface GlobalFlags {
  config?: string;
  mode?: string;
  logLevel?: LogLevel;
  clearScreen?: boolean;
}

const cli = cac('wp-vite');

cli
  .option('-c, --config <file>', '[string] use specified config file')
  .option('-m, --mode <mode>', '[string] set env mode')
  .option('-l, --logLevel <level>', '[string] info | warn | error | silent')
  .option('--clearScreen', '[boolean] allow/disable clear screen when logging');

cli
  .command('build [root]', 'build for production')
  .option('-w, --watch', '[boolean] rebuild when files change')
  .action(async (root: string | undefined, flags: GlobalFlags & { watch?: boolean }) => {
    lastWins(flags);
    await run('build', flags, () => runBuild({ ...pick(flags), ...(root !== undefined && { root }), ...(flags.watch !== undefined && { watch: flags.watch }) }));
  });

cli
  .command('start [root]', 'start the dev server')
  .alias('dev')
  .alias('serve')
  .option('--host [host]', '[string] specify hostname')
  .option('--port <port>', '[number] specify port')
  .option('--strictPort', '[boolean] exit if specified port is already in use')
  .option('--force', '[boolean] force the optimizer to ignore the cache and re-bundle')
  .action(async (root: string | undefined, flags: GlobalFlags & { host?: string | number | boolean; port?: number; strictPort?: boolean; force?: boolean }) => {
    lastWins(flags);
    await run('start', flags, async () => {
      const server = await runStart({
        ...pick(flags),
        ...(root !== undefined && { root }),
        ...(flags.host !== undefined && { host: typeof flags.host === 'number' ? String(flags.host) : flags.host }),
        ...(flags.port !== undefined && { port: flags.port }),
        ...(flags.strictPort !== undefined && { strictPort: flags.strictPort }),
        ...(flags.force !== undefined && { force: flags.force }),
      });
      server.bindCLIShortcuts({ print: true });
    });
  });

cli.help();
cli.version(version);
cli.parse();

function pick(flags: GlobalFlags): GlobalFlags {
  return {
    ...(flags.config !== undefined && { config: flags.config }),
    ...(flags.mode !== undefined && { mode: flags.mode }),
    ...(flags.logLevel !== undefined && { logLevel: flags.logLevel }),
    ...(flags.clearScreen !== undefined && { clearScreen: flags.clearScreen }),
  };
}

// cac collects a repeated flag into an array; Vite's CLI keeps the last value too.
function lastWins(flags: object): void {
  for (const [key, value] of Object.entries(flags)) if (Array.isArray(value)) (flags as Record<string, unknown>)[key] = value.at(-1);
}

async function run(command: string, flags: GlobalFlags, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const detail = error instanceof WPViteError ? error.message : inspect(error);
    createLogger(flags.logLevel).error(pc.red(`error during ${command}:\n${detail}`), { error: error as Error });
    process.exit(1);
  }
}
