import type { Plugin } from 'vite';
import { assetsPlugin } from './build/asset-php.js';
import { configPlugin, createHolder } from './build/config.js';
import { i18nPlugin } from './build/i18n.js';
import { externalsPlugin } from './externals/plugin.js';
import type { WPViteOptions } from './options.js';

export type { WPViteOptions, EntryFormat, EntryOption, ExternalsOptions, ResolvedOptions } from './options.js';
export type { Entry, BlockEntrySource, Discovery } from './discovery/entries.js';
export type { BlockMeta } from './discovery/blocks.js';
export type { Classification, Classify } from './externals/classify.js';
export type { WPViteContext, EntryDeps } from './context.js';
export type { EntryDependencies } from './build/deps.js';
export type { ExternalDeps, RewriteResult } from './externals/rewrite.js';
export { WPViteError } from './errors.js';

export function wpVite(options: WPViteOptions = {}): Plugin[] {
  const holder = createHolder();
  return [configPlugin(options, holder), i18nPlugin(), externalsPlugin(holder), assetsPlugin(holder)];
}
