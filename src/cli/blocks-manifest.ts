import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { BLOCKS_MANIFEST_FILE, blocksManifest } from '../build/copy.js';
import { readBlockJson } from '../discovery/blocks.js';
import { WPViteError } from '../errors.js';
import { phpFile, type PhpValue } from '../php/serialize.js';

export interface BlocksManifestOptions {
  root?: string;
  input?: string;
  output?: string;
}

export interface BlocksManifestResult {
  file: string;
  blocks: string[];
}

// Regenerates blocks-manifest.php from the built block.json files, like wp-scripts
// build-blocks-manifest; the build itself emits the same file.
export async function buildBlocksManifest(options: BlocksManifestOptions = {}): Promise<BlocksManifestResult> {
  const root = path.resolve(options.root ?? '.');
  const input = path.resolve(root, options.input ?? 'build');
  const file = path.resolve(root, options.output ?? path.join(input, BLOCKS_MANIFEST_FILE));
  if (!(await fs.stat(input).catch(() => null))?.isDirectory()) throw new WPViteError(`Input directory ${input} does not exist.`);

  const files = await glob('**/block.json', { cwd: input, absolute: true, ignore: ['**/node_modules/**'] });
  if (files.length === 0) throw new WPViteError(`No block.json files found in ${input}.`);
  files.sort();
  const blocks = [];
  for (const blockFile of files) {
    const json = await readBlockJson(blockFile);
    const dir = path.dirname(blockFile);
    blocks.push({ dir, name: typeof json.name === 'string' ? json.name : path.basename(dir), json });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, phpFile(blocksManifest(blocks) as PhpValue, true));
  return { file, blocks: blocks.map((b) => b.name) };
}
