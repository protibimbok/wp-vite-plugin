import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuilder } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { wpVite, type WPViteOptions } from '../src/index.js';

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

async function build(name: string, options: WPViteOptions = {}) {
  const root = fixture(name);
  await fs.rm(path.join(root, 'build'), { recursive: true, force: true });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const builder = await createBuilder({ root, configFile: false, logLevel: 'silent', mode: 'production', plugins: [wpVite(options)] });
    await builder.buildApp();
  } finally {
    process.env.NODE_ENV = previous;
  }
  return root;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])),
  );
  return files.flat().map((f) => f.split(path.sep).join('/')).sort();
}

describe('build', () => {
  let root: string;
  const read = (file: string) => fs.readFile(path.join(root, 'build', file), 'utf8');

  beforeAll(async () => {
    root = await build('basic-block', { entries: { 'admin/index': 'src/admin.ts' } });
  });

  it('emits IIFE files for block script fields and ESM for other entries', async () => {
    expect(await listFiles(path.join(root, 'build'))).toEqual(['admin/index.js', 'blocks/basic/index.js', 'blocks/basic/view.js']);
    for (const file of ['blocks/basic/index.js', 'blocks/basic/view.js']) {
      const code = await read(file);
      expect(code).not.toMatch(/\bimport\b/);
      expect(code).toMatch(/^!function|^\(function/);
    }
  });

  it('rewrites externals to globals in both formats', async () => {
    const index = await read('blocks/basic/index.js');
    expect(index).toContain('window.wp.blocks.registerBlockType(');
    expect(index).toContain('window.wp.i18n.__(');
    expect(index).toContain('window.ReactJSXRuntime.jsx(');
    expect(await read('blocks/basic/view.js')).toContain('window.wp.a11y.speak(');

    const admin = await read('admin/index.js');
    expect(admin).toContain('window.wp.element.useState(');
    expect(admin).toContain('window.wp.apiFetch(');
    expect(admin).toContain('import("@wordpress/a11y")');
    expect(admin).toMatch(/export\s*\{/);
  });

  it('keeps translator comments through minification', async () => {
    const index = await read('blocks/basic/index.js');
    expect(index).toContain('/** translators: block title */');
    expect(index).toContain('/** translators: shared label */');
    expect(await read('blocks/basic/view.js')).toMatch(/\/\*\* translators: shared label \*\/\s*var \w+=\(\)=>window\.wp\.i18n\.__\("Shared"/);
  });
});
