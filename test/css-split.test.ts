import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertTargets, hoistAtRules } from '../src/build/css-finalize.js';
import { isStyleFile, styleFileName } from '../src/build/css-split.js';
import type { WPViteContext } from '../src/index.js';
import { build, listFiles, readBuilt } from './helpers.js';

describe('style file detection', () => {
  it('matches wp-scripts style sources only', () => {
    for (const id of ['/p/src/style.scss', '/p/src/style.css', '/p/src/style.module.css', '/p/src/a/style.sass', '/p/style.pcss']) {
      expect(isStyleFile(id), id).toBe(true);
    }
    for (const id of ['/p/src/editor.scss', '/p/src/mystyle.css', '/p/src/style.scss?inline', '/p/src/style.scss?url', '/p/style/index.css', '\0virtual/style.css']) {
      expect(isStyleFile(id), id).toBe(false);
    }
  });

  it('prefixes the basename with style-', () => {
    expect(styleFileName('blocks/basic/index.css')).toBe('blocks/basic/style-index.css');
    expect(styleFileName('index.css')).toBe('style-index.css');
  });

  it('hoists @charset and @import like Vite', () => {
    expect(hoistAtRules('.a{}@charset "UTF-8";.b{}@import url(x.css);@charset "UTF-8";')).toBe('@charset "UTF-8";@import url(x.css);.a{}.b{}');
  });

  it('converts esbuild targets to lightningcss versions', () => {
    expect(convertTargets(['chrome111', 'safari16.4', 'es2020', 'esnext', 'node18'])).toEqual({ chrome: 111 << 16, safari: (16 << 16) | (4 << 8) });
    expect(convertTargets(false)).toBeUndefined();
  });
});

describe('build with style and editor CSS', () => {
  let root: string;
  let ctx: WPViteContext;
  const read = (file: string) => readBuilt(root, file);

  beforeAll(async () => {
    ({ root, ctx } = await build(
      'css-split',
      { entries: { 'admin/index': 'src/admin/index.ts', 'settings/index': 'src/settings/index.ts' } },
      { build: { assetsInlineLimit: 0 } },
    ));
  });

  it('emits style-*.css next to *.css for IIFE and ESM entries, with RTL variants', async () => {
    const files = await listFiles(path.join(root, 'build'));
    expect(files.filter((f) => !f.startsWith('chunks/') && !f.startsWith('images/'))).toEqual([
      'admin/index-rtl.css',
      'admin/index.asset.php',
      'admin/index.css',
      'admin/index.js',
      'admin/style-index-rtl.css',
      'admin/style-index.css',
      'blocks-manifest.php',
      'blocks/styled/block.json',
      'blocks/styled/index-rtl.css',
      'blocks/styled/index.asset.php',
      'blocks/styled/index.css',
      'blocks/styled/index.js',
      'blocks/styled/style-index-rtl.css',
      'blocks/styled/style-index.css',
      'settings/index.asset.php',
      'settings/index.js',
      'wp-vite.json',
      'wp-vite.php',
    ]);
    expect(files.filter((f) => f.startsWith('chunks/'))).toEqual([
      expect.stringMatching(/^chunks\/style-widget-[\w-]+-rtl\.css$/),
      expect.stringMatching(/^chunks\/style-widget-[\w-]+\.css$/),
      expect.stringMatching(/^chunks\/widget-[\w-]+-rtl\.css$/),
      expect.stringMatching(/^chunks\/widget-[\w-]+\.css$/),
      expect.stringMatching(/^chunks\/widget-[\w-]+\.js$/),
    ]);
    expect(files.filter((f) => f.startsWith('images/'))).toEqual([expect.stringMatching(/^images\/icon-[\w-]+\.png$/)]);
  });

  it('puts only style.* sources into style-index.css and resolves asset urls relative to it', async () => {
    const style = await read('blocks/styled/style-index.css');
    expect(style).toMatch(/^\.wp-block-fixture-styled\{background:url\(\.\.\/\.\.\/images\/icon-[\w-]+\.png\) 0 no-repeat;margin-left:1em\}\n$/);
    const editor = await read('blocks/styled/index.css');
    expect(editor).toMatch(
      /^\.(_panel_\w+)\{float:left\}\.wp-block-fixture-styled\.is-selected\{background:url\(\.\.\/\.\.\/images\/icon-[\w-]+\.png\);padding-left:2px\}\n$/,
    );
    expect(editor).not.toContain('$vite$');
    const className = /\.(_panel_\w+)\{/.exec(editor)![1];
    expect(await read('blocks/styled/index.js')).toContain(className);
  });

  it('flips the RTL variants', async () => {
    expect(await read('blocks/styled/style-index-rtl.css')).toMatch(/background:url\([^)]+\) 100% no-repeat;margin-right:1em/);
    expect(await read('blocks/styled/index-rtl.css')).toContain('float:right');
    expect(await read('blocks/styled/index-rtl.css')).toContain('padding-right:2px');
    expect(await read('admin/style-index-rtl.css')).toBe('.admin-front{right:0}\n');
  });

  it('splits ESM entry and shared chunk CSS the same way', async () => {
    expect(await read('admin/style-index.css')).toBe('.admin-front{left:0}\n');
    expect(await read('admin/index.css')).toBe('.admin-screen{right:0}\n');
    const admin = ctx.deps.get('admin/index')!;
    expect(admin.css).toEqual(['admin/index.css', expect.stringMatching(/^chunks\/widget-[\w-]+\.css$/)]);
    expect(admin.styleCss).toEqual(['admin/style-index.css', expect.stringMatching(/^chunks\/style-widget-[\w-]+\.css$/)]);
    expect(await read(admin.styleCss[1]!)).toBe('.widget{border-left:1px solid}\n');
    expect(await read(admin.css[1]!)).toBe('.widget-editor{text-align:left}\n');
    expect(ctx.deps.get('settings/index')).toMatchObject({ css: [admin.css[1]], styleCss: [admin.styleCss[1]] });
  });

  it('records block CSS on the IIFE entry and hashes it into the version', async () => {
    const block = ctx.deps.get('blocks/styled/index')!;
    expect(block).toMatchObject({ format: 'iife', css: ['blocks/styled/index.css'], styleCss: ['blocks/styled/style-index.css'] });
    expect(await readBuilt(root, 'blocks/styled/index.asset.php')).toContain(`'version' => '${block.version}'`);
  });
});

describe('build without rtl', () => {
  it('emits no -rtl.css files', async () => {
    const { root } = await build('css-split', { rtl: false, entries: { 'admin/index': 'src/admin/index.ts' } });
    const files = await listFiles(path.join(root, 'build'));
    expect(files.some((f) => f.endsWith('-rtl.css'))).toBe(false);
    expect(files).toContain('blocks/styled/style-index.css');
  });
});
