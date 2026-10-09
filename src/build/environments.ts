import type { EnvironmentOptions, ViteBuilder } from 'vite';
import type { WPViteContext } from '../context.js';
import type { Entry } from '../discovery/entries.js';

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

export async function buildApp(builder: ViteBuilder, ctx: WPViteContext, hasClient: boolean): Promise<void> {
  if (hasClient) await builder.build(builder.environments[CLIENT_ENVIRONMENT]!);
  for (const name of ctx.iifeEnvironments) {
    await builder.build(builder.environments[name]!);
  }
}
