import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { Plugin } from 'vite';
import { MODULE_FIELDS, SCRIPT_FIELDS, fileFieldValues, type BlockMeta } from '../discovery/blocks.js';
import { isInside, stripScriptExtension, toPosix } from '../discovery/names.js';
import { WPViteError } from '../errors.js';
import { phpFile, type PhpValue } from '../php/serialize.js';
import type { ContextHolder } from './config.js';

export const BLOCKS_MANIFEST_FILE = 'blocks-manifest.php';
const PHP_FIELDS = ['render', 'variations'];
const PHP_GLOB_IGNORE = ['**/node_modules/**', '**/vendor/**'];

// Script fields point at the built .js next to the copied block.json; style fields already name
// built files (style-index.css) and are left alone, like wp-scripts.
export function builtBlockJson(json: Record<string, unknown>): Record<string, unknown> {
  const out = { ...json };
  const convert = (value: unknown) =>
    typeof value === 'string' && value.startsWith('file:') ? `file:${stripScriptExtension(value.slice('file:'.length))}.js` : value;
  for (const field of [...SCRIPT_FIELDS, ...MODULE_FIELDS]) {
    const value = out[field];
    if (Array.isArray(value)) out[field] = value.map(convert);
    else if (value !== undefined) out[field] = convert(value);
  }
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

export function copyPlugin(holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:copy',
    apply: 'build',
    enforce: 'post',

    async generateBundle() {
      const ctx = holder.get();
      if (this.environment.name !== ctx.primaryEnvironment) return;
      const { options, discovery } = ctx;

      for (const block of discovery.blocks) {
        const fileName = path.posix.join(block.relDir, 'block.json');
        this.emitFile({ type: 'asset', fileName, source: `${JSON.stringify(builtBlockJson(block.json), null, 2)}\n` });
      }

      for (const file of await phpFiles(options.srcDir, options.copyPhp, discovery.blocks)) {
        this.emitFile({ type: 'asset', fileName: toPosix(path.relative(options.srcDir, file)), source: await fs.readFile(file) });
      }

      if (options.blocksManifest && discovery.blocks.length > 0) {
        const source = phpFile(blocksManifest(discovery.blocks) as PhpValue, true);
        this.emitFile({ type: 'asset', fileName: BLOCKS_MANIFEST_FILE, source });
      }
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
