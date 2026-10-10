import fs from 'node:fs';
import path from 'node:path';
import type { WPViteContext } from '../context.js';
import { MODULE_FIELDS, STYLE_FIELDS, type ModuleField, type StyleField } from '../discovery/blocks.js';
import { toPosix } from '../discovery/names.js';
import type { DevDeps } from './crawl.js';

export type ServedField = ModuleField | StyleField;

export interface HotFileEntry {
  url: string;
  src: string;
  format: 'es' | 'css';
  scripts: string[];
  modules: string[];
  styles: string[];
}

export interface HotFileBlock {
  name: string;
  dir: string;
  fields: Partial<Record<ServedField, string[]>>;
}

export interface HotFile {
  origin: string;
  srcDir: string;
  refresh: boolean;
  entries: Record<string, HotFileEntry>;
  blocks: HotFileBlock[];
}

export const HOT_FILE = path.join('.wp-vite', 'hot.json');
const SERVED_FIELDS: readonly ServedField[] = [...MODULE_FIELDS, ...STYLE_FIELDS];

export function hotFilePath(ctx: WPViteContext): string {
  return path.join(ctx.options.outDir, HOT_FILE);
}

// Lists what the dev server serves: script modules and stylesheets. Classic block scripts are
// watch-built into outDir and WordPress loads them from there as in production.
export function createHotFile(ctx: WPViteContext, origin: string, refresh: boolean, deps?: DevDeps): HotFile {
  const { root, srcDir } = ctx.options;
  const relative = (file: string) => toPosix(path.relative(root, file));
  const entries: Record<string, HotFileEntry> = {};
  const fields = new Map<string, HotFileBlock['fields']>();
  for (const entry of ctx.discovery.entries) {
    if (entry.format === 'iife') continue;
    const src = relative(entry.file);
    const { scripts = [], modules = [], styles = [] } = deps?.get(entry.name) ?? {};
    entries[entry.name] = { url: `${origin}/${src}`, src, format: entry.format, scripts, modules, styles };
    for (const source of entry.sources) {
      const field = source.field as ServedField;
      if (!SERVED_FIELDS.includes(field)) continue;
      const blockFields = fields.get(source.block) ?? {};
      (blockFields[field] ??= []).push(entry.name);
      fields.set(source.block, blockFields);
    }
  }
  return {
    origin,
    srcDir: relative(srcDir),
    refresh,
    entries,
    blocks: ctx.discovery.blocks.map((block) => ({ name: block.name, dir: relative(block.dir), fields: fields.get(block.name) ?? {} })),
  };
}

// PHP reads the file on every request and throws on invalid JSON, so it must never observe a
// partial write: write a sibling, then rename over the target.
export function writeHotFile(file: string, data: HotFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(temp, file);
}

export function removeHotFile(file: string): void {
  fs.rmSync(file, { force: true });
  try {
    fs.rmdirSync(path.dirname(file));
  } catch {
    // not empty or already gone
  }
}
