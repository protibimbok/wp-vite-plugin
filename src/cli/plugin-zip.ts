import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { glob } from 'tinyglobby';
import { toPosix } from '../discovery/names.js';
import { WPViteError } from '../errors.js';

export interface PluginZipOptions {
  root?: string;
  // Folder the files sit in inside the archive: the plugin directory name by default, false for none.
  rootFolder?: string | boolean;
  output?: string;
}

export interface PluginZipResult {
  file: string;
  folder: string | null;
  files: string[];
}

// What wp-scripts ships when package.json has no `files`, plus Composer's vendor directory.
const DEFAULT_FILES = (name: string) => [
  'admin/**',
  'build/**',
  'includes/**',
  'languages/**',
  'public/**',
  'vendor/**',
  `${name}.php`,
  'uninstall.php',
  'block.json',
  'changelog.*',
  'license.*',
  'readme.*',
];

export async function pluginZip(options: PluginZipOptions = {}): Promise<PluginZipResult> {
  const root = path.resolve(options.root ?? '.');
  const name = path.basename(root);
  const file = path.resolve(root, options.output ?? `${name}.zip`);
  const folder = options.rootFolder === false ? null : typeof options.rootFolder === 'string' ? options.rootFolder : name;

  const custom = await packageFiles(root);
  const files = await glob(custom ?? DEFAULT_FILES(name), {
    cwd: root,
    dot: custom !== null,
    caseSensitiveMatch: false,
    ignore: [toPosix(path.relative(root, file))],
  });
  if (files.length === 0) {
    throw new WPViteError(custom ? `No files match the "files" patterns of ${path.join(root, 'package.json')}.` : `No plugin files found in ${root}. Add a "files" array to package.json.`);
  }
  files.sort();

  const entries: Zippable = {};
  for (const relative of files) {
    const source = path.join(root, relative);
    const [data, stat] = await Promise.all([fs.readFile(source), fs.stat(source)]);
    entries[folder ? `${folder}/${relative}` : relative] = [new Uint8Array(data), { mtime: stat.mtime }];
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, zipSync(entries, { level: 9 }));
  return { file, folder, files };
}

async function packageFiles(root: string): Promise<string[] | null> {
  let json: unknown;
  try {
    json = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WPViteError(`${path.join(root, 'package.json')}: ${(error as Error).message}`);
  }
  const files = (json as { files?: unknown } | null)?.files;
  if (files === undefined) return null;
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) {
    throw new WPViteError(`${path.join(root, 'package.json')}: "files" must be an array of glob patterns`);
  }
  return files.length > 0 ? files : null;
}
