#!/usr/bin/env node
import path from 'node:path';
import { inspect } from 'node:util';
import { cac } from 'cac';
import pc from 'picocolors';
import { createLogger, type LogLevel } from 'vite';
import { version } from '../../package.json';
import { WPViteError } from '../errors.js';
import { buildBlocksManifest } from './blocks-manifest.js';
import { runBuild } from './build.js';
import { makeJson } from './make-json.js';
import { pluginZip } from './plugin-zip.js';
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

cli
  .command('plugin-zip [root]', 'zip the plugin for distribution')
  .option('--root-folder [name]', '[string] folder the files sit in inside the zip (default: the plugin directory name)')
  .option('--no-root-folder', '[boolean] put the files at the root of the zip')
  .option('-o, --output <file>', '[string] zip file to write (default: <name>.zip in the plugin directory)')
  .action(async (root: string | undefined, flags: GlobalFlags & { rootFolder?: string | boolean; output?: string }) => {
    lastWins(flags);
    await run('plugin-zip', flags, async () => {
      const result = await pluginZip({ ...(root !== undefined && { root }), ...(flags.rootFolder !== undefined && { rootFolder: flags.rootFolder }), ...(flags.output !== undefined && { output: flags.output }) });
      createLogger(flags.logLevel).info(`${pc.green('✓')} ${pc.cyan(relative(result.file))} ${pc.dim(`(${count(result.files.length, 'file', 'files')}${result.folder ? ` in ${result.folder}/` : ''})`)}`);
    });
  });

cli
  .command('build-blocks-manifest [root]', 'regenerate blocks-manifest.php from the built block.json files')
  .option('--input <dir>', '[string] directory to scan for block.json files (default: build)')
  .option('--output <file>', '[string] manifest file to write (default: <input>/blocks-manifest.php)')
  .action(async (root: string | undefined, flags: GlobalFlags & { input?: string; output?: string }) => {
    lastWins(flags);
    await run('build-blocks-manifest', flags, async () => {
      const result = await buildBlocksManifest({ ...(root !== undefined && { root }), ...(flags.input !== undefined && { input: flags.input }), ...(flags.output !== undefined && { output: flags.output }) });
      createLogger(flags.logLevel).info(`${pc.green('✓')} ${pc.cyan(relative(result.file))} ${pc.dim(`(${count(result.blocks.length, 'block', 'blocks')})`)}`);
    });
  });

cli
  .command('make-json <source> [destination]', 'convert .po files to JSON for script translations')
  .option('--domain <domain>', '[string] text domain for the file names (default: the .po file name)')
  .option('--purge', '[boolean] remove the strings only scripts reference from the .po files')
  .option('--pretty-print', '[boolean] indent the JSON')
  .option('--use-map <file>', '[string] JSON file mapping referenced source paths to shipped script paths')
  .action(async (source: string, destination: string | undefined, flags: GlobalFlags & { domain?: string; purge?: boolean; prettyPrint?: boolean; useMap?: string }) => {
    lastWins(flags);
    await run('make-json', flags, async () => {
      const result = await makeJson({
        source,
        ...(destination !== undefined && { destination }),
        ...(flags.domain !== undefined && { domain: flags.domain }),
        ...(flags.purge !== undefined && { purge: flags.purge }),
        ...(flags.prettyPrint !== undefined && { prettyPrint: flags.prettyPrint }),
        ...(flags.useMap !== undefined && { useMap: flags.useMap }),
      });
      const logger = createLogger(flags.logLevel);
      for (const file of result.files) logger.info(`${pc.green('✓')} ${pc.cyan(relative(file))}`);
      if (result.files.length === 0) logger.warn(pc.yellow('No translated strings referenced by scripts were found.'));
      for (const file of result.purged) logger.info(`${pc.dim('purged')} ${pc.cyan(relative(file))}`);
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

function relative(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith('..') ? file : rel.split(path.sep).join('/') || '.';
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
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
