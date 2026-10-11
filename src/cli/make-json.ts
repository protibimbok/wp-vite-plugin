import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { po, type GetTextTranslation, type GetTextTranslations } from 'gettext-parser';
import { glob } from 'tinyglobby';
import { WPViteError } from '../errors.js';
import { version } from '../../package.json';

export interface MakeJsonOptions {
  // A .po file or a directory of them.
  source: string;
  // Directory for the JSON files; defaults to each .po file's own directory.
  destination?: string;
  // Text domain for the file names; defaults to the .po file name without its extension.
  domain?: string;
  prettyPrint?: boolean;
  // Remove the strings that only JavaScript references from the .po file afterwards.
  purge?: boolean;
  // Map of referenced source paths to the shipped script paths (JSON object, string or array values).
  useMap?: string;
}

export interface MakeJsonResult {
  files: string[];
  purged: string[];
}

export type SourceMap = Record<string, string | string[]>;

type Messages = Record<string, string[]>;

const SCRIPT_RE = /\.(?:[cm]?[jt]sx?)$/;
const DEFAULT_PLURAL_FORMS = 'nplurals=2; plural=(n != 1);';

// `wp i18n make-json`: one JED JSON per script a .po file references, named after the md5 of the
// path WordPress loads it by, which load_script_textdomain() matches against the script URL.
export async function makeJson(options: MakeJsonOptions): Promise<MakeJsonResult> {
  const source = path.resolve(options.source);
  const map = options.useMap === undefined ? null : await readMap(path.resolve(options.useMap));
  const result: MakeJsonResult = { files: [], purged: [] };
  for (const poFile of await poFiles(source)) {
    const destination = path.resolve(options.destination ?? path.dirname(poFile));
    const translations = parsePo(poFile, await fs.readFile(poFile));
    const baseName = options.domain ? `${options.domain}-${localeOf(translations, poFile)}` : path.basename(poFile, '.po');
    await fs.mkdir(destination, { recursive: true });
    for (const [file, json] of jsonFiles(translations, map)) {
      const target = path.join(destination, `${baseName}-${md5(file)}.json`);
      await fs.writeFile(target, `${JSON.stringify(json, null, options.prettyPrint ? 2 : undefined)}\n`);
      result.files.push(target);
    }
    if (options.purge && purgeScripts(translations)) {
      await fs.writeFile(poFile, po.compile(translations));
      result.purged.push(poFile);
    }
  }
  return result;
}

export function jsonFiles(translations: GetTextTranslations, map: SourceMap | null): Map<string, Record<string, unknown>> {
  const byFile = new Map<string, Messages>();
  for (const translation of entries(translations)) {
    if (!isTranslated(translation)) continue;
    const key = translation.msgctxt ? `${translation.msgctxt}\u0004${translation.msgid}` : translation.msgid;
    const value = translation.msgid_plural ? translation.msgstr : [translation.msgstr[0]!];
    const files = new Set<string>();
    for (const file of scriptReferences(translation)) for (const mapped of map ? arrayOf(map[file]) : [file]) files.add(mapped);
    for (const file of files) {
      const messages = byFile.get(file) ?? {};
      messages[key] = value;
      byFile.set(file, messages);
    }
  }

  const header = (name: string) => Object.entries(translations.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  const files = new Map<string, Record<string, unknown>>();
  for (const [file, messages] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    files.set(file, {
      'translation-revision-date': header('PO-Revision-Date') ?? '',
      generator: `wp-vite/${version}`,
      source: file,
      domain: 'messages',
      locale_data: {
        messages: {
          '': { domain: 'messages', lang: localeOf(translations, null), 'plural-forms': header('Plural-Forms') ?? DEFAULT_PLURAL_FORMS },
          ...messages,
        },
      },
    });
  }
  return files;
}

// Drops the strings only scripts reference; returns whether anything changed.
export function purgeScripts(translations: GetTextTranslations): boolean {
  let changed = false;
  for (const translation of entries(translations)) {
    const references = referencesOf(translation);
    if (references.length === 0 || !references.every((file) => SCRIPT_RE.test(file))) continue;
    delete translations.translations[translation.msgctxt ?? '']![translation.msgid];
    changed = true;
  }
  return changed;
}

function* entries(translations: GetTextTranslations): Generator<GetTextTranslation> {
  for (const context of Object.values(translations.translations)) {
    for (const translation of Object.values(context)) if (translation.msgid !== '') yield translation;
  }
}

function isTranslated(translation: GetTextTranslation): boolean {
  if (translation.obsolete || /\bfuzzy\b/.test(translation.comments?.flag ?? '')) return false;
  return translation.msgstr.some((text) => text !== '');
}

// `#: path:line path:line` comments, one or more per line; the line number is optional.
function referencesOf(translation: GetTextTranslation): string[] {
  const text = translation.comments?.reference ?? '';
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((reference) => reference.replace(/:\d+$/, ''));
}

function scriptReferences(translation: GetTextTranslation): string[] {
  return referencesOf(translation).filter((file) => SCRIPT_RE.test(file));
}

function localeOf(translations: GetTextTranslations, poFile: string | null): string {
  const language = Object.entries(translations.headers).find(([k]) => k.toLowerCase() === 'language')?.[1];
  if (language) return language;
  const fromName = poFile ? /-([a-z]{2,3}(?:_[A-Za-z]+)*)$/.exec(path.basename(poFile, '.po'))?.[1] : undefined;
  return fromName ?? 'en';
}

function parsePo(file: string, buffer: Buffer): GetTextTranslations {
  try {
    return po.parse(buffer);
  } catch (error) {
    throw new WPViteError(`${file}: ${(error as Error).message}`);
  }
}

async function poFiles(source: string): Promise<string[]> {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new WPViteError(`${source} does not exist.`);
  if (stat.isFile()) return [source];
  const files = await glob('*.po', { cwd: source, absolute: true });
  if (files.length === 0) throw new WPViteError(`No .po files found in ${source}.`);
  return files.sort();
}

async function readMap(file: string): Promise<SourceMap> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new WPViteError(`${file}: ${(error as Error).message}`);
  }
  const valid =
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every((v) => typeof v === 'string' || (Array.isArray(v) && v.every((s) => typeof s === 'string')));
  if (!valid) throw new WPViteError(`${file}: a map is a JSON object of source path to script path (string or array of strings)`);
  return parsed as SourceMap;
}

function arrayOf(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}
