import type { Discovery } from './discovery/entries.js';
import { createClassifier, type Classify } from './externals/classify.js';
import type { ExternalDeps } from './externals/rewrite.js';
import type { EntryFormat, ResolvedOptions } from './options.js';

export interface WPViteContext {
  options: ResolvedOptions;
  discovery: Discovery;
  classify: Classify;
  records: Map<string, Map<string, ExternalDeps>>;
  iifeEnvironments: Set<string>;
  isDev: boolean;
  devOrigin: string | undefined;
  formatOf(environment: string): EntryFormat;
}

export function createContext(options: ResolvedOptions, discovery: Discovery, isDev: boolean): WPViteContext {
  const iifeEnvironments = new Set<string>();
  return {
    options,
    discovery,
    classify: createClassifier(options.externals, options.root),
    records: new Map(),
    iifeEnvironments,
    isDev,
    devOrigin: undefined,
    formatOf: (environment) => (iifeEnvironments.has(environment) ? 'iife' : 'es'),
  };
}
