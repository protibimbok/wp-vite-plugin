import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blocksManifest, builtBlockJson } from '../src/build/copy.js';
import { blocksRoot } from '../src/build/manifest.js';
import { build, listFiles, readBuilt } from './helpers.js';

const requirePhp = (root: string, file: string) =>
  JSON.parse(execFileSync('php', ['-r', 'echo json_encode(require $argv[1]);', path.join(root, 'build', file)], { encoding: 'utf8' }));

describe('builtBlockJson', () => {
  it('rewrites script and module file: fields to the built .js, leaving styles and other values alone', () => {
    expect(
      builtBlockJson({
        editorScript: 'file:./index.tsx',
        script: ['file:./index.js', 'wp-dom-ready'],
        viewScriptModule: 'file:./view',
        style: 'file:./style-index.css',
        render: 'file:./render.php',
      }),
    ).toEqual({
      editorScript: 'file:./index.js',
      script: ['file:./index.js', 'wp-dom-ready'],
      viewScriptModule: 'file:./view.js',
      style: 'file:./style-index.css',
      render: 'file:./render.php',
    });
  });
});

describe('blocksRoot', () => {
  it('is the shared parent directory, empty for outDir itself, null for mixed depths', () => {
    expect(blocksRoot(['blocks/a', 'blocks/b'])).toBe('blocks');
    expect(blocksRoot(['a', 'b'])).toBe('');
    expect(blocksRoot(['blocks/a', 'blocks/group/b'])).toBeNull();
    expect(blocksRoot([''])).toBeNull();
    expect(blocksRoot([])).toBeNull();
  });
});

describe('build copies block assets', () => {
  it('copies block.json with rewritten script fields and only the referenced PHP by default', async () => {
    const { root } = await build('copy-php');
    const files = await listFiles(path.join(root, 'build'));
    expect(files.filter((f) => f.endsWith('.php') || f.endsWith('.json'))).toEqual([
      'blocks-manifest.php',
      'blocks/alpha/block.json',
      'blocks/alpha/index.asset.php',
      'blocks/alpha/render.php',
      'blocks/alpha/variations.php',
      'blocks/alpha/view.asset.php',
      'blocks/beta/block.json',
      'blocks/beta/index.asset.php',
      'blocks/beta/view.asset.php',
      'wp-vite.json',
      'wp-vite.php',
    ]);
    expect(await readBuilt(root, 'blocks/alpha/render.php')).toBe('<?php echo "alpha";\n');

    const alpha = JSON.parse(await readBuilt(root, 'blocks/alpha/block.json'));
    expect(alpha).toMatchObject({
      name: 'fixture/alpha',
      editorScript: 'file:./index.js',
      viewScriptModule: 'file:./view.js',
      style: 'file:./style-index.css',
      render: 'file:./render.php',
      keywords: ['one', 'two'],
    });
    expect(JSON.parse(await readBuilt(root, 'blocks/beta/block.json')).viewScript).toEqual(['file:./view.js', 'wp-dom-ready']);
  });

  it('emits blocks-manifest.php keyed by block directory with the built block.json', async () => {
    const { root } = await build('copy-php');
    const php = await readBuilt(root, 'blocks-manifest.php');
    expect(php).toMatch(/^<\?php\n\/\/ This file is generated\. Do not modify it manually\.\nreturn array\(\n\t'alpha' => array\(\n/);
    expect(php).toContain("\t\t'keywords' => array(\n\t\t\t'one',\n\t\t\t'two',\n\t\t),\n");
    expect(requirePhp(root, 'blocks-manifest.php')).toEqual({
      alpha: JSON.parse(await readBuilt(root, 'blocks/alpha/block.json')),
      beta: JSON.parse(await readBuilt(root, 'blocks/beta/block.json')),
    });
  });

  it('copies every PHP file under srcDir with copyPhp and skips the blocks manifest when disabled', async () => {
    const { root } = await build('copy-php', { copyPhp: true, blocksManifest: false });
    const files = await listFiles(path.join(root, 'build'));
    expect(files.filter((f) => f.endsWith('.php') && !f.endsWith('.asset.php'))).toEqual([
      'blocks/alpha/helper.php',
      'blocks/alpha/render.php',
      'blocks/alpha/variations.php',
      'inc/functions.php',
      'wp-vite.php',
    ]);
  });

  it('describes the build in wp-vite.php and wp-vite.json', async () => {
    const { root, ctx } = await build('copy-php');
    const json = JSON.parse(await readBuilt(root, 'wp-vite.json'));
    // PHP has no empty map, so `chunks` comes back as [] here; the entries are what matters.
    expect(requirePhp(root, 'wp-vite.php')).toEqual({ ...json, chunks: [] });
    expect(json).toMatchObject({
      version: 1,
      rtl: true,
      blocks: [
        { name: 'fixture/alpha', dir: 'blocks/alpha' },
        { name: 'fixture/beta', dir: 'blocks/beta' },
      ],
      blocksRoot: 'blocks',
      chunks: {},
    });
    expect(Object.keys(json.entries)).toEqual(['blocks/alpha/index', 'blocks/alpha/view', 'blocks/beta/index', 'blocks/beta/view']);
    expect(json.entries['blocks/alpha/view']).toEqual({
      file: 'blocks/alpha/view.js',
      format: 'es',
      src: 'src/blocks/alpha/view.ts',
      sources: [{ block: 'fixture/alpha', field: 'viewScriptModule' }],
      scripts: [],
      modules: ['@wordpress/interactivity'],
      dynamicModules: [],
      imports: [],
      dynamicImports: [],
      css: [],
      styleCss: [],
      version: ctx.deps.get('blocks/alpha/view')!.version,
    });
    expect(json.entries['blocks/beta/index']).toMatchObject({ format: 'iife', scripts: ['wp-i18n'], sources: [{ block: 'fixture/beta', field: 'script' }] });
  });

  it('honours manifest: { php, json }', async () => {
    const { root } = await build('copy-php', { manifest: { php: false } });
    const files = await listFiles(path.join(root, 'build'));
    expect(files).toContain('wp-vite.json');
    expect(files).not.toContain('wp-vite.php');
  });
});

describe('blocks at mixed depths', () => {
  it('rejects duplicate block directory names in blocks-manifest.php', async () => {
    await expect(build('nested-blocks')).rejects.toThrow(/fixture\/nested-one and fixture\/one both live in a directory named "one"/);
    expect(() => blocksManifest([])).not.toThrow();
  });

  it('builds with blocksManifest: false and reports no blocksRoot', async () => {
    const { root } = await build('nested-blocks', { blocksManifest: false });
    const json = JSON.parse(await readBuilt(root, 'wp-vite.json'));
    expect(json.blocksRoot).toBeNull();
    expect(json.blocks).toEqual([
      { name: 'fixture/nested-one', dir: 'blocks/group/one' },
      { name: 'fixture/one', dir: 'blocks/one' },
    ]);
    expect(await listFiles(path.join(root, 'build'))).toContain('blocks/group/one/block.json');
  });
});
