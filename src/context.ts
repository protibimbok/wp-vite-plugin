import type { EntryDependencies } from './build/deps.js';
import type { Discovery, Entry } from './discovery/entries.js';
import { JSX_DEV_RUNTIME_REQUEST } from './dev/virtual.js';
import { createClassifier, type Classify } from './externals/classify.js';
import type { ExternalDeps } from './externals/rewrite.js';
import type { ScriptFormat, ResolvedOptions } from './options.js';
import type { Watcher } from './build/watch.js';

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
  // Rolldown watchers of a `build --watch` run, one per environment.
  watchers: Watcher[];
  styleFiles: Set<string>;
  isDev: boolean;
  devOrigin: string | undefined;
  formatOf(environment: string): ScriptFormat;
}

export function createContext(options: ResolvedOptions, discovery: Discovery, isDev: boolean): WPViteContext {
  const iifeEnvironments = new Map<string, Entry>();
  const classify = createClassifier(options.externals, options.root);
  return {
    options,
    discovery,
    // In dev the JSX transform imports jsxDEV, which the WordPress runtime lacks; leaving the
    // request unclassified lets wp-vite:dev-virtual resolve it to a shim.
    classify: isDev ? (request, format) => (request === JSX_DEV_RUNTIME_REQUEST ? { kind: 'bundle', request } : classify(request, format)) : classify,
    records: new Map(),
    deps: new Map(),
    chunks: new Map(),
    iifeEnvironments,
    finalEnvironment: '',
    watchers: [],
    styleFiles: new Set(),
    isDev,
    devOrigin: undefined,
    formatOf: (environment) => (iifeEnvironments.has(environment) ? 'iife' : 'es'),
  };
}
