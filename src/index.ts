import type { Plugin } from 'vite';
import type { WPViteOptions } from './options.js';

export type { WPViteOptions, EntryFormat, EntryOption, ExternalsOptions, ResolvedOptions } from './options.js';
export type { Entry, BlockEntrySource, Discovery } from './discovery/entries.js';
export type { BlockMeta } from './discovery/blocks.js';
export { WPViteError } from './errors.js';

export function wpVite(_options: WPViteOptions = {}): Plugin[] {
  return [];
}
export type { Classification, Classify } from './externals/classify.js';
export type { WPViteContext } from './context.js';
export type { ExternalDeps, RewriteResult } from './externals/rewrite.js';
