import { createBuilder, version as viteVersion, type ViteBuilder } from 'vite';
import pc from 'picocolors';
import type { WPViteContext } from '../context.js';
import { version } from '../../package.json';
import { contextOf, inlineConfig, type CommonOptions } from './config.js';

export interface BuildCommandOptions extends CommonOptions {
  watch?: boolean;
}

export interface BuildCommand {
  builder: ViteBuilder;
  ctx: WPViteContext;
  close(): Promise<void>;
}

// Same as `vite build` with the plugin configured; `--watch` keeps every environment's watcher
// running. The returned promise settles after the first build of each environment.
export async function runBuild(options: BuildCommandOptions = {}): Promise<BuildCommand> {
  const config = inlineConfig(options);
  if (options.watch) config.build = { watch: {} };
  // null lets Vite decide the builder from the resolved config, as its own CLI does.
  const builder = await createBuilder(config, null);
  const ctx = contextOf(builder.config);
  const { entries, blocks } = ctx.discovery;
  builder.config.logger.info(
    `${pc.cyan(`wp-vite v${version}`)} ${pc.dim(`(vite v${viteVersion})`)} ${pc.green(`${count(entries.length, 'entry', 'entries')}, ${count(blocks.length, 'block', 'blocks')}`)}`,
  );
  await builder.buildApp();
  return {
    builder,
    ctx,
    close: async () => {
      await Promise.all(ctx.watchers.map((watcher) => watcher.close()));
    },
  };
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
