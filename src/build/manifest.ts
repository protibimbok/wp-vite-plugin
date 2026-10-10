import path from 'node:path';
import type { Plugin } from 'vite';
import type { ChunkDeps, EntryDeps, WPViteContext } from '../context.js';
import type { BlockEntrySource } from '../discovery/entries.js';
import { toPosix } from '../discovery/names.js';
import { phpFile, type PhpValue } from '../php/serialize.js';
import { applyProdBuild, type ContextHolder } from './config.js';

export const MANIFEST_PHP_FILE = 'wp-vite.php';
export const MANIFEST_JSON_FILE = 'wp-vite.json';

export interface ManifestEntry extends Omit<EntryDeps, 'name'> {
  src: string;
  sources: BlockEntrySource[];
}

export interface ManifestBlock {
  name: string;
  dir: string;
}

export interface WPViteManifest {
  version: 1;
  rtl: boolean;
  entries: Record<string, ManifestEntry>;
  chunks: Record<string, ChunkDeps>;
  blocks: ManifestBlock[];
  blocksRoot: string | null;
}

export function buildManifest(ctx: WPViteContext): WPViteManifest {
  const { options, discovery } = ctx;
  const entries: Record<string, ManifestEntry> = {};
  for (const entry of discovery.entries) {
    const deps = ctx.deps.get(entry.name);
    if (!deps) continue;
    const { name: _name, file, format, ...rest } = deps;
    entries[entry.name] = { file, format, src: toPosix(path.relative(options.root, entry.file)), sources: entry.sources, ...rest };
  }
  const chunks = Object.fromEntries([...ctx.chunks.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    version: 1,
    rtl: options.rtl,
    entries,
    chunks,
    blocks: discovery.blocks.map((b) => ({ name: b.name, dir: b.relDir })),
    blocksRoot: blocksRoot(discovery.blocks.map((b) => b.relDir)),
  };
}

// The directory every block sits directly under, relative to outDir ('' for outDir itself), or
// null when depths differ; wp_register_block_types_from_metadata_collection() needs the former.
export function blocksRoot(relDirs: string[]): string | null {
  if (relDirs.length === 0) return null;
  const parents = new Set(relDirs.map((dir) => (dir === '' ? null : path.posix.dirname(dir))));
  if (parents.size !== 1 || parents.has(null)) return null;
  const [parent] = parents;
  return parent === '.' ? '' : parent!;
}

export function manifestPlugin(holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:manifest',
    apply: applyProdBuild,
    enforce: 'post',

    // Every environment emits the manifest with what has been built so far; the last one wins.
    generateBundle() {
      const ctx = holder.get();
      const { php, json } = ctx.options.manifest;
      if (!php && !json) return;
      const manifest = buildManifest(ctx);
      if (php) this.emitFile({ type: 'asset', fileName: MANIFEST_PHP_FILE, source: phpFile(manifest as unknown as PhpValue, true) });
      if (json) this.emitFile({ type: 'asset', fileName: MANIFEST_JSON_FILE, source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}
