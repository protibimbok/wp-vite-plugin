import type { Discovery } from './discovery/entries.js';
import type { ResolvedOptions } from './options.js';

export interface WPViteContext {
  options: ResolvedOptions;
  discovery: Discovery;
}
