import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { WPViteError } from '../errors.js';
import { toPosix } from './names.js';

export const SCRIPT_FIELDS = ['editorScript', 'script', 'viewScript'] as const;
export const MODULE_FIELDS = ['viewScriptModule'] as const;
export const STYLE_FIELDS = ['editorStyle', 'style', 'viewStyle'] as const;

export type ScriptField = (typeof SCRIPT_FIELDS)[number];
export type ModuleField = (typeof MODULE_FIELDS)[number];
export type StyleField = (typeof STYLE_FIELDS)[number];
export type AssetField = ScriptField | ModuleField | StyleField;

export interface BlockMeta {
  name: string;
  file: string;
  dir: string;
  relDir: string;
  json: Record<string, unknown>;
}

export async function findBlocks(srcDir: string, patterns: string[]): Promise<BlockMeta[]> {
  const files = await glob(patterns, { cwd: srcDir, absolute: true, ignore: ['**/node_modules/**'] });
  files.sort();
  const blocks: BlockMeta[] = [];
  for (const file of files) {
    const json = await readBlockJson(file);
    const name = json.name;
    if (typeof name !== 'string' || !name.includes('/')) {
      throw new WPViteError(`${file}: "name" must be a namespaced block name like "my-plugin/my-block"`);
    }
    const dir = path.dirname(file);
    blocks.push({ name, file, dir, relDir: toPosix(path.relative(srcDir, dir)), json });
  }
  return blocks;
}

export function fileFieldValues(json: Record<string, unknown>, field: AssetField): string[] {
  const raw = json[field];
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return values
    .filter((v): v is string => typeof v === 'string' && v.startsWith('file:'))
    .map((v) => v.slice('file:'.length));
}

async function readBlockJson(file: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new WPViteError(`${file}: invalid JSON (${(error as Error).message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WPViteError(`${file}: block.json must contain an object`);
  }
  return parsed as Record<string, unknown>;
}
