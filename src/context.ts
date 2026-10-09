import type { EntryDependencies } from './build/deps.js';
import type { Discovery, Entry } from './discovery/entries.js';
import { createClassifier, type Classify } from './externals/classify.js';
import type { ExternalDeps } from './externals/rewrite.js';
import type { ScriptFormat, ResolvedOptions } from './options.js';

export interface EntryDeps extends EntryDependencies {
  name: string;
  file: string;
  format: ScriptFormat;
  css: string[];
  styleCss: string[];
  version: string;
}

export interface ChunkDeps extends EntryDependencies {
  file: string;
  css: string[];
  version: string;
}

export interface WPViteContext {
  options: ResolvedOptions;
  discovery: Discovery;
  classify: Classify;
  records: Map<string, Map<string, ExternalDeps>>;
  deps: Map<string, EntryDeps>;
  chunks: Map<string, ChunkDeps>;
  iifeEnvironments: Map<string, Entry>;
  finalEnvironment: string;
  styleFiles: Set<string>;
  isDev: boolean;
  devOrigin: string | undefined;
  formatOf(environment: string): ScriptFormat;
}

export function createContext(options: ResolvedOptions, discovery: Discovery, isDev: boolean): WPViteContext {
  const iifeEnvironments = new Map<string, Entry>();
  return {
    options,
    discovery,
    classify: createClassifier(options.externals, options.root),
    records: new Map(),
    deps: new Map(),
    chunks: new Map(),
    iifeEnvironments,
    finalEnvironment: '',
    styleFiles: new Set(),
    isDev,
    devOrigin: undefined,
    formatOf: (environment) => (iifeEnvironments.has(environment) ? 'iife' : 'es'),
  };
}
