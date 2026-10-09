import path from 'node:path';

export type ScriptFormat = 'es' | 'iife';
export type EntryFormat = ScriptFormat | 'css';

export interface EntryOption {
  src: string;
  format?: ScriptFormat;
}

export interface ExternalsOptions {
  requestToExternal?: (request: string) => string | string[] | false | undefined;
  requestToExternalModule?: (request: string) => string | false | undefined;
  requestToHandle?: (request: string) => string | undefined;
  bundled?: string[];
}

export interface WPViteOptions {
  srcDir?: string;
  outDir?: string;
  entries?: Record<string, string | EntryOption>;
  blocks?: boolean | string | string[];
  indexFallback?: boolean;
  copyPhp?: boolean;
  blocksManifest?: boolean;
  rtl?: boolean;
  externals?: ExternalsOptions;
  moduleClassicDeps?: 'error' | 'warn';
  hot?: boolean;
  wpOrigin?: string | string[];
  minify?: 'terser' | 'oxc';
  manifest?: { php?: boolean; json?: boolean };
  sourcemap?: boolean;
}

export interface ResolvedOptions {
  root: string;
  srcDir: string;
  outDir: string;
  entries: Record<string, Required<EntryOption>>;
  blocks: string[] | false;
  indexFallback: boolean;
  copyPhp: boolean;
  blocksManifest: boolean;
  rtl: boolean;
  externals: ExternalsOptions;
  moduleClassicDeps: 'error' | 'warn';
  hot: boolean | undefined;
  wpOrigin: string[] | undefined;
  minify: 'terser' | 'oxc';
  manifest: { php: boolean; json: boolean };
  sourcemap: boolean | undefined;
}

const DEFAULT_BLOCK_GLOB = '**/block.json';

export function resolveOptions(options: WPViteOptions, root: string): ResolvedOptions {
  const entries: ResolvedOptions['entries'] = {};
  for (const [name, value] of Object.entries(options.entries ?? {})) {
    const entry = typeof value === 'string' ? { src: value } : value;
    entries[name] = { src: entry.src, format: entry.format ?? 'es' };
  }

  const blocks =
    options.blocks === false
      ? false
      : options.blocks === true || options.blocks === undefined
        ? [DEFAULT_BLOCK_GLOB]
        : ([] as string[]).concat(options.blocks);

  return {
    root,
    srcDir: path.resolve(root, options.srcDir ?? 'src'),
    outDir: path.resolve(root, options.outDir ?? 'build'),
    entries,
    blocks,
    indexFallback: options.indexFallback ?? true,
    copyPhp: options.copyPhp ?? false,
    blocksManifest: options.blocksManifest ?? true,
    rtl: options.rtl ?? true,
    externals: options.externals ?? {},
    moduleClassicDeps: options.moduleClassicDeps ?? 'error',
    hot: options.hot,
    wpOrigin: options.wpOrigin === undefined ? undefined : ([] as string[]).concat(options.wpOrigin),
    minify: options.minify ?? 'terser',
    manifest: { php: options.manifest?.php ?? true, json: options.manifest?.json ?? true },
    sourcemap: options.sourcemap,
  };
}
