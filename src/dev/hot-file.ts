import fs from 'node:fs';
import path from 'node:path';
import type { WPViteContext } from '../context.js';
import { toPosix } from '../discovery/names.js';
import type { EntryFormat } from '../options.js';
import type { DevDeps } from './crawl.js';

export interface HotFileEntry {
  url: string;
  src: string;
  format: EntryFormat;
  scripts: string[];
  modules: string[];
  styles: string[];
}

export interface HotFile {
  origin: string;
  srcDir: string;
  refresh: boolean;
  entries: Record<string, HotFileEntry>;
  blocks: Array<{ name: string; dir: string }>;
}

export const HOT_FILE = path.join('.wp-vite', 'hot.json');

export function hotFilePath(ctx: WPViteContext): string {
  return path.join(ctx.options.outDir, HOT_FILE);
}

export function createHotFile(ctx: WPViteContext, origin: string, refresh: boolean, deps?: DevDeps): HotFile {
  const { root, srcDir } = ctx.options;
  const relative = (file: string) => toPosix(path.relative(root, file));
  const entries: Record<string, HotFileEntry> = {};
  for (const entry of ctx.discovery.entries) {
    const src = relative(entry.file);
    const { scripts = [], modules = [], styles = [] } = deps?.get(entry.name) ?? {};
    entries[entry.name] = { url: `${origin}/${src}`, src, format: entry.format, scripts, modules, styles };
  }
  return {
    origin,
    srcDir: relative(srcDir),
    refresh,
    entries,
    blocks: ctx.discovery.blocks.map((block) => ({ name: block.name, dir: relative(block.dir) })),
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
