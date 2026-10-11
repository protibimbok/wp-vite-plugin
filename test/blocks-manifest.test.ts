import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBlocksManifest } from '../src/cli/blocks-manifest.js';
import { build, readBuilt } from './helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('wp-vite build-blocks-manifest', () => {
  it('regenerates the file the build emitted, byte for byte', async () => {
    const { root } = await build('copy-php');
    const fromBuild = await readBuilt(root, 'blocks-manifest.php');
    await fs.rm(path.join(root, 'build', 'blocks-manifest.php'));
    const result = await buildBlocksManifest({ root });
    expect(result.file).toBe(path.join(root, 'build', 'blocks-manifest.php'));
    expect(result.blocks).toEqual(['fixture/alpha', 'fixture/beta']);
    expect(await readBuilt(root, 'blocks-manifest.php')).toBe(fromBuild);
  });

  it('takes --input and --output', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-manifest-'));
    await fs.mkdir(path.join(tempDir, 'out', 'blocks', 'alpha'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'out', 'blocks', 'alpha', 'block.json'), JSON.stringify({ name: 'x/alpha', editorScript: 'file:./index.js' }));
    const result = await buildBlocksManifest({ root: tempDir, input: 'out', output: 'manifest.php' });
    expect(result).toEqual({ file: path.join(tempDir, 'manifest.php'), blocks: ['x/alpha'] });
    expect(await fs.readFile(result.file, 'utf8')).toBe(
      "<?php\n// This file is generated. Do not modify it manually.\nreturn array(\n\t'alpha' => array(\n\t\t'name' => 'x/alpha',\n\t\t'editorScript' => 'file:./index.js',\n\t),\n);\n",
    );
  });

  it('fails on a missing directory, no blocks or duplicate directory names', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-manifest-'));
    await expect(buildBlocksManifest({ root: tempDir })).rejects.toThrow(/Input directory .* does not exist/);
    await fs.mkdir(path.join(tempDir, 'build'));
    await expect(buildBlocksManifest({ root: tempDir })).rejects.toThrow(/No block\.json files found/);
    for (const dir of ['a/same', 'b/same']) {
      await fs.mkdir(path.join(tempDir, 'build', dir), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'build', dir, 'block.json'), JSON.stringify({ name: `x/${dir.replace('/', '-')}` }));
    }
    await expect(buildBlocksManifest({ root: tempDir })).rejects.toThrow(/x\/a-same and x\/b-same both live in a directory named "same"/);
  });
});
