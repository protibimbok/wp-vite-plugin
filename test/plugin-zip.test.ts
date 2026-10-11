import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { pluginZip } from '../src/cli/plugin-zip.js';
import { fixture } from './helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function tempPlugin(name: string, files: Record<string, string>): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-zip-'));
  const root = path.join(tempDir, name);
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  return root;
}

async function entriesOf(file: string): Promise<Record<string, string>> {
  const unzipped = unzipSync(new Uint8Array(await fs.readFile(file)));
  return Object.fromEntries(Object.entries(unzipped).map(([name, data]) => [name, strFromU8(data)]));
}

describe('wp-vite plugin-zip', () => {
  it('honours the "files" patterns of package.json, dotfiles included, inside a root folder', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-zip-'));
    const output = path.join(tempDir, 'out.zip');
    const result = await pluginZip({ root: fixture('plugin-zip'), output });
    expect(result).toEqual({
      file: output,
      folder: 'plugin-zip',
      files: ['.distignore', 'out/blocks/one/block.json', 'out/blocks/one/index.js', 'plugin-zip.php', 'readme.txt', 'vendor/x/a.php'],
    });
    const entries = await entriesOf(output);
    expect(Object.keys(entries)).toEqual(result.files.map((f) => `plugin-zip/${f}`));
    expect(entries['plugin-zip/plugin-zip.php']).toBe('<?php // plugin\n');
  });

  it('falls back to the wp-scripts file list and names the zip after the directory', async () => {
    const root = await tempPlugin('my-plugin', {
      'my-plugin.php': '<?php',
      'README.md': '# hi',
      'LICENSE.txt': 'GPL',
      'uninstall.php': '<?php',
      'build/index.js': '',
      'build/index.asset.php': '<?php',
      'languages/my-plugin-de_DE.po': '',
      'vendor/autoload.php': '<?php',
      'includes/class-a.php': '<?php',
      'src/index.ts': '',
      'node_modules/x/index.js': '',
      'package.json': JSON.stringify({ name: 'my-plugin' }),
      '.gitignore': 'build',
    });
    const result = await pluginZip({ root });
    expect(result.file).toBe(path.join(root, 'my-plugin.zip'));
    expect(result.files).toEqual([
      'LICENSE.txt',
      'README.md',
      'build/index.asset.php',
      'build/index.js',
      'includes/class-a.php',
      'languages/my-plugin-de_DE.po',
      'my-plugin.php',
      'uninstall.php',
      'vendor/autoload.php',
    ]);
    expect(Object.keys(await entriesOf(result.file))).toEqual(result.files.map((f) => `my-plugin/${f}`));
  });

  it('flattens with rootFolder: false, renames with a string and never includes its own output', async () => {
    const root = await tempPlugin('p', { 'p.php': '<?php', 'package.json': JSON.stringify({ files: ['**'] }) });
    const flat = await pluginZip({ root, rootFolder: false });
    expect(flat.folder).toBeNull();
    expect(Object.keys(await entriesOf(flat.file))).toEqual(['p.php', 'package.json']);
    const renamed = await pluginZip({ root, rootFolder: 'renamed', output: 'dist/renamed.zip' });
    expect(renamed.file).toBe(path.join(root, 'dist', 'renamed.zip'));
    // `**` matches the first zip now; the one being written never matches itself.
    expect(Object.keys(await entriesOf(renamed.file))).toEqual(['renamed/p.php', 'renamed/p.zip', 'renamed/package.json']);
  });

  it('fails when nothing matches', async () => {
    const root = await tempPlugin('empty', { 'src/index.ts': '' });
    await expect(pluginZip({ root })).rejects.toThrow(/No plugin files found .* Add a "files" array/);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ files: ['build/**'] }));
    await expect(pluginZip({ root })).rejects.toThrow(/No files match the "files" patterns/);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ files: 'build' }));
    await expect(pluginZip({ root })).rejects.toThrow(/"files" must be an array/);
  });
});
