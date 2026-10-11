import fs from 'node:fs/promises';
import path from 'node:path';
import type { EnvironmentOptions, ViteBuilder } from 'vite';
import type { WPViteContext } from '../context.js';
import type { Entry } from '../discovery/entries.js';
import { isWatcher, watchBuilds } from './watch.js';

export const CLIENT_ENVIRONMENT = 'client';

export function iifeEnvironmentName(entry: Entry, index: number): string {
  return `wpIife_${index}_${entry.name.replace(/[^A-Za-z0-9$_]/g, '_')}`;
}

export function iifeEnvironment(entry: Entry, emptyOutDir: boolean, output: Record<string, unknown>): EnvironmentOptions {
  return {
    consumer: 'client',
    build: {
      emptyOutDir,
      copyPublicDir: false,
      cssCodeSplit: false,
      rolldownOptions: {
        input: { [entry.name]: entry.file },
        optimization: { inlineConst: false },
        output: { ...output, format: 'iife', codeSplitting: false },
      },
    },
  };
}

// In watch mode Vite empties outDir again before every rebuild of an environment, which would
// drop the other environments' output, so the environments keep emptyOutDir off and the
// directory is cleared once here. First builds still run in order so the manifest emitted by the
// last one is complete.
export async function buildApp(builder: ViteBuilder, ctx: WPViteContext, hasClient: boolean): Promise<void> {
  const watching = !!builder.config.build.watch;
  if (watching) await emptyDir(ctx.options.outDir);
  const names = [...(hasClient ? [CLIENT_ENVIRONMENT] : []), ...ctx.iifeEnvironments.keys()];
  for (const name of names) {
    const result = await builder.build(builder.environments[name]!);
    if (!isWatcher(result)) continue;
    ctx.watchers.push(result);
    await watchBuilds(result);
  }
}

async function emptyDir(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(names.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true })));
}
