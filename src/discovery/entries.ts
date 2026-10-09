import fs from 'node:fs/promises';
import path from 'node:path';
import { WPViteError } from '../errors.js';
import type { EntryFormat, ResolvedOptions } from '../options.js';
import { MODULE_FIELDS, SCRIPT_FIELDS, fileFieldValues, findBlocks, type BlockMeta, type ScriptField, type ModuleField } from './blocks.js';
import { SCRIPT_EXTENSIONS, entryNameFor, isInside, stripScriptExtension } from './names.js';

export interface BlockEntrySource {
  block: string;
  field: ScriptField | ModuleField;
}

export interface Entry {
  name: string;
  file: string;
  format: EntryFormat;
  sources: BlockEntrySource[];
}

export interface Discovery {
  entries: Entry[];
  blocks: BlockMeta[];
}

export async function discoverEntries(options: ResolvedOptions): Promise<Discovery> {
  const byName = new Map<string, Entry>();
  const byFile = new Map<string, Entry>();

  const add = (entry: Omit<Entry, 'sources'>, source?: BlockEntrySource) => {
    const existing = byFile.get(entry.file) ?? byName.get(entry.name);
    if (existing) {
      if (existing.file !== entry.file) {
        throw new WPViteError(`Entry name "${entry.name}" is used by both ${existing.file} and ${entry.file}`);
      }
      if (existing.format !== entry.format) {
        throw new WPViteError(
          `${entry.file} is referenced both as a classic script and as a script module; use separate files`,
        );
      }
      if (source) existing.sources.push(source);
      return;
    }
    const created: Entry = { ...entry, sources: source ? [source] : [] };
    byName.set(created.name, created);
    byFile.set(created.file, created);
  };

  const blocks = options.blocks ? await findBlocks(options.srcDir, options.blocks) : [];
  for (const block of blocks) {
    const fields: Array<[ScriptField | ModuleField, EntryFormat]> = [
      ...SCRIPT_FIELDS.map((f): [ScriptField, EntryFormat] => [f, 'iife']),
      ...MODULE_FIELDS.map((f): [ModuleField, EntryFormat] => [f, 'es']),
    ];
    for (const [field, format] of fields) {
      for (const value of fileFieldValues(block.json, field)) {
        const file = await resolveScriptFile(path.resolve(block.dir, value), `${block.file} (${field})`);
        if (!isInside(options.srcDir, file)) {
          throw new WPViteError(`${block.file} (${field}): ${value} resolves outside the source directory`);
        }
        add({ name: entryNameFor(file, options.srcDir), file, format }, { block: block.name, field });
      }
    }
  }

  for (const [name, { src, format }] of Object.entries(options.entries)) {
    const file = await resolveScriptFile(path.resolve(options.root, src), `entries.${name}`);
    add({ name, file, format });
  }

  if (byName.size === 0 && options.indexFallback) {
    const index = await findWithExtensions(path.join(options.srcDir, 'index'));
    if (index) add({ name: 'index', file: index, format: 'es' });
  }

  return { entries: [...byName.values()], blocks };
}

async function resolveScriptFile(file: string, context: string): Promise<string> {
  if (await exists(file)) return file;
  const found = await findWithExtensions(stripScriptExtension(file));
  if (!found) throw new WPViteError(`${context}: cannot find ${file}`);
  return found;
}

async function findWithExtensions(base: string): Promise<string | undefined> {
  for (const ext of SCRIPT_EXTENSIONS) {
    if (await exists(base + ext)) return base + ext;
  }
  return undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}
