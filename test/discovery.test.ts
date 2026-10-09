import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverEntries } from '../src/discovery/entries.js';
import { resolveOptions, type WPViteOptions } from '../src/options.js';

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

async function discover(name: string, options: WPViteOptions = {}) {
  const root = fixture(name);
  const result = await discoverEntries(resolveOptions(options, root));
  return {
    blocks: result.blocks.map((b) => ({ name: b.name, relDir: b.relDir })),
    entries: result.entries.map((e) => ({
      name: e.name,
      file: path.relative(root, e.file).split(path.sep).join('/'),
      format: e.format,
      sources: e.sources,
    })),
  };
}

describe('discoverEntries', () => {
  it('maps block.json script fields to IIFE entries and resolves extensions', async () => {
    const { blocks, entries } = await discover('basic-block');
    expect(blocks).toEqual([{ name: 'fixture/basic', relDir: 'blocks/basic' }]);
    expect(entries).toEqual([
      {
        name: 'blocks/basic/index',
        file: 'src/blocks/basic/index.tsx',
        format: 'iife',
        sources: [
          { block: 'fixture/basic', field: 'editorScript' },
          { block: 'fixture/basic', field: 'script' },
        ],
      },
      {
        name: 'blocks/basic/view',
        file: 'src/blocks/basic/view.ts',
        format: 'iife',
        sources: [{ block: 'fixture/basic', field: 'viewScript' }],
      },
    ]);
  });

  it('maps viewScriptModule to an ES entry', async () => {
    const { entries } = await discover('interactive-block');
    expect(entries).toEqual([
      {
        name: 'blocks/counter/index',
        file: 'src/blocks/counter/index.jsx',
        format: 'iife',
        sources: [{ block: 'fixture/counter', field: 'editorScript' }],
      },
      {
        name: 'blocks/counter/view',
        file: 'src/blocks/counter/view.ts',
        format: 'es',
        sources: [{ block: 'fixture/counter', field: 'viewScriptModule' }],
      },
    ]);
  });

  it('adds user entries relative to the project root', async () => {
    const { entries } = await discover('basic-block', {
      entries: { 'admin/index': 'src/admin.ts', legacy: { src: 'src/legacy', format: 'iife' } },
    });
    expect(entries.slice(2)).toEqual([
      { name: 'admin/index', file: 'src/admin.ts', format: 'es', sources: [] },
      { name: 'legacy', file: 'src/legacy.ts', format: 'iife', sources: [] },
    ]);
  });

  it('falls back to src/index.* when nothing else is found', async () => {
    const { entries } = await discover('index-only');
    expect(entries).toEqual([{ name: 'index', file: 'src/index.tsx', format: 'es', sources: [] }]);
  });

  it('skips the index fallback when disabled or when entries exist', async () => {
    expect((await discover('index-only', { indexFallback: false })).entries).toEqual([]);
    expect((await discover('basic-block')).entries.map((e) => e.name)).not.toContain('index');
  });

  it('honours blocks: false and custom block globs', async () => {
    expect((await discover('basic-block', { blocks: false })).entries).toEqual([]);
    expect((await discover('basic-block', { blocks: 'blocks/*/block.json' })).entries).toHaveLength(2);
    expect((await discover('basic-block', { blocks: 'nope/**/block.json' })).entries).toEqual([]);
  });

  it('rejects block scripts outside the source directory', async () => {
    await expect(discover('invalid-block')).rejects.toThrow(/outside the source directory/);
  });

  it('rejects one file used as both classic script and script module', async () => {
    await expect(discover('conflict-block')).rejects.toThrow(/classic script and as a script module/);
  });

  it('rejects missing entry files and name collisions', async () => {
    await expect(discover('basic-block', { entries: { x: 'src/missing.ts' } })).rejects.toThrow(/cannot find/);
    await expect(
      discover('basic-block', { entries: { 'blocks/basic/index': 'src/admin.ts' } }),
    ).rejects.toThrow(/used by both/);
  });
});

describe('resolveOptions', () => {
  it('applies defaults', () => {
    const resolved = resolveOptions({}, '/root');
    expect(resolved).toMatchObject({
      srcDir: path.resolve('/root', 'src'),
      outDir: path.resolve('/root', 'build'),
      blocks: ['**/block.json'],
      indexFallback: true,
      copyPhp: false,
      blocksManifest: true,
      rtl: true,
      moduleClassicDeps: 'error',
      minify: 'terser',
      manifest: { php: true, json: true },
    });
  });

  it('normalises entries and origins', () => {
    const resolved = resolveOptions({ entries: { a: 'x.ts', b: { src: 'y.ts', format: 'iife' } }, wpOrigin: 'http://wp' }, '/root');
    expect(resolved.entries).toEqual({ a: { src: 'x.ts', format: 'es' }, b: { src: 'y.ts', format: 'iife' } });
    expect(resolved.wpOrigin).toEqual(['http://wp']);
  });
});
