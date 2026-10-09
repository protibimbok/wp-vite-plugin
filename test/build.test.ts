import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuilder } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContextHolder } from '../src/build/config.js';
import { wpVite, type WPViteContext, type WPViteOptions } from '../src/index.js';

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

const silentLogger = {
  info() {},
  warn() {},
  warnOnce() {},
  error() {},
  clearScreen() {},
  hasErrorLogged: () => false,
  hasWarned: false,
};

interface Built {
  root: string;
  ctx: WPViteContext;
  warnings: string[];
}

async function build(name: string, options: WPViteOptions = {}): Promise<Built> {
  const root = fixture(name);
  await fs.rm(path.join(root, 'build'), { recursive: true, force: true });
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const warnings: string[] = [];
  const plugins = wpVite(options);
  try {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: 'silent',
      mode: 'production',
      plugins,
      customLogger: { ...silentLogger, warn: (message) => void warnings.push(message) },
    });
    await builder.buildApp();
  } finally {
    process.env.NODE_ENV = previous;
  }
  return { root, ctx: (plugins[0]!.api as ContextHolder).get(), warnings };
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])),
  );
  return files.flat().map((f) => f.split(path.sep).join('/')).sort();
}

const readBuilt = (root: string, file: string) => fs.readFile(path.join(root, 'build', file), 'utf8');

async function readPhp(root: string, file: string): Promise<string> {
  const php = await readBuilt(root, file);
  expect(php).toMatch(/^<\?php return array\(.*\);\n$/s);
  return php;
}

describe('build', () => {
  let root: string;
  let ctx: WPViteContext;
  const read = (file: string) => readBuilt(root, file);

  beforeAll(async () => {
    ({ root, ctx } = await build('basic-block', { entries: { 'admin/index': 'src/admin.ts', 'frontend/index': 'src/frontend.ts' } }));
  });

  it('emits IIFE files for block script fields and ESM for other entries', async () => {
    const files = await listFiles(path.join(root, 'build'));
    expect(files.filter((f) => !f.startsWith('chunks/'))).toEqual([
      'admin/index.asset.php',
      'admin/index.js',
      'blocks/basic/index.asset.php',
      'blocks/basic/index.js',
      'blocks/basic/view.asset.php',
      'blocks/basic/view.js',
      'frontend/index.asset.php',
      'frontend/index.js',
    ]);
    expect(files.filter((f) => f.startsWith('chunks/'))).toEqual([expect.stringMatching(/^chunks\/shared-[\w-]+\.js$/)]);
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

  it('emits asset.php with sorted classic handles for IIFE entries', async () => {
    expect(await readPhp(root, 'blocks/basic/index.asset.php')).toMatch(
      /^<\?php return array\('dependencies' => array\('react-jsx-runtime', 'wp-blocks', 'wp-i18n'\), 'version' => '[0-9a-f]{20}'\);\n$/,
    );
    expect(await readPhp(root, 'blocks/basic/view.asset.php')).toContain("'dependencies' => array('wp-a11y', 'wp-i18n')");
  });

  it('emits module-typed asset.php for ESM entries with module deps only', async () => {
    expect(await readPhp(root, 'admin/index.asset.php')).toMatch(
      /^<\?php return array\('dependencies' => array\(array\('id' => '@wordpress\/a11y', 'import' => 'dynamic'\)\), 'version' => '[0-9a-f]{20}', 'type' => 'module'\);\n$/,
    );
    expect(await readPhp(root, 'frontend/index.asset.php')).toContain("'dependencies' => array(), 'version' => '");
  });

  it('records full dependencies per entry, following shared chunks', () => {
    const admin = ctx.deps.get('admin/index')!;
    expect(admin).toMatchObject({
      file: 'admin/index.js',
      format: 'es',
      scripts: ['wp-api-fetch', 'wp-element', 'wp-i18n'],
      modules: [],
      dynamicModules: ['@wordpress/a11y'],
      imports: [expect.stringMatching(/^chunks\/shared-[\w-]+\.js$/)],
      dynamicImports: [],
      css: [],
    });
    expect(admin.version).toMatch(/^[0-9a-f]{20}$/);
    expect(ctx.deps.get('frontend/index')).toMatchObject({ scripts: ['wp-data', 'wp-i18n'], imports: admin.imports });
    expect(ctx.deps.get('blocks/basic/view')).toMatchObject({ format: 'iife', scripts: ['wp-a11y', 'wp-i18n'], imports: [] });
    expect(ctx.deps.get('blocks/basic/index')!.version).not.toBe(ctx.deps.get('blocks/basic/view')!.version);
  });

  it('keeps translator comments through minification', async () => {
    const index = await read('blocks/basic/index.js');
    expect(index).toContain('/** translators: block title */');
    expect(index).toContain('/** translators: shared label */');
    expect(await read('blocks/basic/view.js')).toMatch(/\/\*\* translators: shared label \*\/\s*var \w+=\(\)=>window\.wp\.i18n\.__\("Shared"/);
  });
});

describe('build with script modules', () => {
  it('lists only module ids for a viewScriptModule entry', async () => {
    const { root } = await build('interactive-block');
    expect(await readPhp(root, 'blocks/counter/view.asset.php')).toMatch(
      /^<\?php return array\('dependencies' => array\(array\('id' => '@wordpress\/interactivity', 'import' => 'static'\)\), 'version' => '[0-9a-f]{20}', 'type' => 'module'\);\n$/,
    );
    expect(await readBuilt(root, 'blocks/counter/view.js')).toMatch(/from\s*"@wordpress\/interactivity"/);
    expect(await readPhp(root, 'blocks/counter/index.asset.php')).toContain(
      "'dependencies' => array('react-jsx-runtime', 'wp-block-editor', 'wp-blocks')",
    );
  });

  it('errors when a viewScriptModule depends on classic scripts', async () => {
    await expect(build('module-classic')).rejects.toThrow(/WPViteError: blocks\/mixed\/view is a viewScriptModule of fixture\/mixed .*classic scripts \(wp-i18n\)/);
  });

  it('downgrades the classic-dependency error to a warning with moduleClassicDeps: "warn"', async () => {
    const { root, ctx, warnings } = await build('module-classic', { moduleClassicDeps: 'warn' });
    expect(warnings.some((w) => /classic scripts \(wp-i18n\)/.test(w))).toBe(true);
    expect(await readPhp(root, 'blocks/mixed/view.asset.php')).toContain(
      "'dependencies' => array(array('id' => '@wordpress/interactivity', 'import' => 'static'))",
    );
    expect(ctx.deps.get('blocks/mixed/view')).toMatchObject({ scripts: ['wp-i18n'], modules: ['@wordpress/interactivity'] });
  });
});
