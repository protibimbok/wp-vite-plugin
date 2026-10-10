import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { Plugin } from 'vite';
import type { WPViteContext } from '../context.js';
import { MODULE_FIELDS, SCRIPT_FIELDS, STYLE_FIELDS, fileFieldValues, type BlockMeta } from '../discovery/blocks.js';
import { isInside, stripScriptExtension, stripStyleExtension, toPosix } from '../discovery/names.js';
import { WPViteError } from '../errors.js';
import type { ResolvedOptions } from '../options.js';
import { phpFile, type PhpValue } from '../php/serialize.js';
import { applyProdBuild, type ContextHolder } from './config.js';

export const BLOCKS_MANIFEST_FILE = 'blocks-manifest.php';
const PHP_FIELDS = ['render', 'variations'];
const PHP_GLOB_IGNORE = ['**/node_modules/**', '**/vendor/**'];

export interface CopyFile {
  fileName: string;
  source: string | Uint8Array;
}

// Every file: asset field names a source; the output tree mirrors srcDir, so the built file sits
// at the same relative path with the built extension.
export function builtBlockJson(json: Record<string, unknown>): Record<string, unknown> {
  const out = { ...json };
  const rewrite = (fields: readonly string[], convert: (value: string) => string) => {
    for (const field of fields) {
      const value = out[field];
      const map = (v: unknown) => (typeof v === 'string' && v.startsWith('file:') ? `file:${convert(v.slice('file:'.length))}` : v);
      if (Array.isArray(value)) out[field] = value.map(map);
      else if (value !== undefined) out[field] = map(value);
    }
  };
  rewrite([...SCRIPT_FIELDS, ...MODULE_FIELDS], (value) => `${stripScriptExtension(value)}.js`);
  rewrite(STYLE_FIELDS, (value) => `${stripStyleExtension(value)}.css`);
  return out;
}

// Keyed by block directory name, which is what WP_Block_Metadata_Registry looks blocks up by.
export function blocksManifest(blocks: BlockMeta[]): Record<string, Record<string, unknown>> {
  const manifest: Record<string, Record<string, unknown>> = {};
  const owners = new Map<string, string>();
  for (const block of blocks) {
    const key = path.basename(block.dir);
    const owner = owners.get(key);
    if (owner) {
      throw new WPViteError(
        `Blocks ${owner} and ${block.name} both live in a directory named "${key}"; ${BLOCKS_MANIFEST_FILE} needs unique ` +
          `directory names. Rename one or set blocksManifest: false.`,
      );
    }
    owners.set(key, block.name);
    manifest[key] = builtBlockJson(block.json);
  }
  return manifest;
}

// Block metadata, PHP and the blocks manifest: the build emits them, the dev server writes them.
export async function copyFiles(options: ResolvedOptions, blocks: BlockMeta[]): Promise<CopyFile[]> {
  const files: CopyFile[] = [];
  for (const block of blocks) {
    files.push({ fileName: path.posix.join(block.relDir, 'block.json'), source: `${JSON.stringify(builtBlockJson(block.json), null, 2)}\n` });
  }
  for (const file of await phpFiles(options.srcDir, options.copyPhp, blocks)) {
    files.push({ fileName: toPosix(path.relative(options.srcDir, file)), source: await fs.readFile(file) });
  }
  if (options.blocksManifest && blocks.length > 0) {
    files.push({ fileName: BLOCKS_MANIFEST_FILE, source: phpFile(blocksManifest(blocks) as PhpValue, true) });
  }
  return files;
}

export async function writeCopyFiles(ctx: WPViteContext): Promise<void> {
  for (const { fileName, source } of await copyFiles(ctx.options, ctx.discovery.blocks)) {
    const target = path.join(ctx.options.outDir, fileName);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source);
  }
}

export function copyPlugin(holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:copy',
    apply: applyProdBuild,
    enforce: 'post',

    async generateBundle() {
      const ctx = holder.get();
      if (this.environment.name !== ctx.finalEnvironment) return;
      for (const file of await copyFiles(ctx.options, ctx.discovery.blocks)) this.emitFile({ type: 'asset', ...file });
    },
  };
}

async function phpFiles(srcDir: string, all: boolean, blocks: BlockMeta[]): Promise<string[]> {
  if (all) {
    const files = await glob('**/*.php', { cwd: srcDir, absolute: true, ignore: PHP_GLOB_IGNORE });
    return files.sort();
  }
  const files = new Set<string>();
  for (const block of blocks) {
    for (const field of PHP_FIELDS) {
      for (const value of fileFieldValues(block.json, field)) {
        const file = path.resolve(block.dir, value);
        if (!isInside(srcDir, file)) throw new WPViteError(`${block.file} (${field}): ${value} resolves outside the source directory`);
        try {
          await fs.access(file);
        } catch {
          throw new WPViteError(`${block.file} (${field}): cannot find ${file}`);
        }
        files.add(file);
      }
    }
  }
  return [...files].sort();
}
