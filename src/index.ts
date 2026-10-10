import type { Plugin } from 'vite';
import { assetsPlugin } from './build/asset-php.js';
import { configPlugin, createHolder } from './build/config.js';
import { copyPlugin } from './build/copy.js';
import { cssOutputPlugin, cssSplitPlugin } from './build/css-split.js';
import { manifestPlugin } from './build/manifest.js';
import { rtlPlugin } from './build/rtl.js';
import { refreshPreamblePlugin } from './dev/hmr-inject.js';
import { devServerPlugin } from './dev/server.js';
import { devVirtualPlugin } from './dev/virtual.js';
import { i18nPlugin } from './build/i18n.js';
import { externalsPlugin } from './externals/plugin.js';
import type { WPViteOptions } from './options.js';

export type { WPViteOptions, EntryFormat, ScriptFormat, EntryOption, ExternalsOptions, ResolvedOptions } from './options.js';
export type { Entry, BlockEntrySource, Discovery } from './discovery/entries.js';
export type { BlockMeta } from './discovery/blocks.js';
export type { Classification, Classify } from './externals/classify.js';
export type { WPViteContext, EntryDeps, ChunkDeps } from './context.js';
export type { WPViteManifest, ManifestEntry, ManifestBlock } from './build/manifest.js';
export type { EntryDependencies } from './build/deps.js';
export type { ExternalDeps, RewriteResult } from './externals/rewrite.js';
export type { HotFile, HotFileEntry } from './dev/hot-file.js';
export type { EntryDevDeps, DevDeps } from './dev/crawl.js';
export { WPViteError } from './errors.js';

export function wpVite(options: WPViteOptions = {}): Plugin[] {
  const holder = createHolder();
  const plugins = [
    configPlugin(options, holder),
    i18nPlugin(),
    externalsPlugin(holder),
    devVirtualPlugin(holder),
    devServerPlugin(holder),
    refreshPreamblePlugin(holder),
    cssSplitPlugin(holder),
    cssOutputPlugin(holder),
    rtlPlugin(holder),
    assetsPlugin(holder),
    copyPlugin(holder),
    manifestPlugin(holder),
  ];
  // `vite build` re-evaluates the config file per environment; sharing the instances keeps one
  // context (and so one complete manifest) across the ESM and IIFE builds.
  for (const plugin of plugins) plugin.sharedDuringBuild = true;
  return plugins;
}
