import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBuild, type BuildCommand } from '../src/cli/build.js';
import { hasConfigFile, inlineConfig } from '../src/cli/config.js';
import { runStart } from '../src/cli/start.js';
import { fixture, listFiles } from './helpers.js';

let tempDir: string | undefined;
let running: BuildCommand | undefined;
let server: ViteDevServer | undefined;

// The CLI writes into `build/` and the watch tests edit sources, so every test gets its own copy.
async function copyFixture(name: string): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-cli-'));
  await fs.cp(fixture(name), tempDir, { recursive: true, filter: (src) => path.basename(src) !== 'build' });
  return tempDir;
}

// Fixture configs cannot import the plugin relatively once copied, so the config is written here;
// `.mts` because the temp copy has no package.json to make a `.ts` config ESM.
async function withConfig(root: string, options: string): Promise<void> {
  const plugin = path.join(import.meta.dirname, '..', 'src', 'index.ts');
  await fs.writeFile(path.join(root, 'vite.config.mts'), `import { wpVite } from ${JSON.stringify(plugin)};\nexport default { plugins: [wpVite(${options})] };\n`);
}

const built = (root: string) => listFiles(path.join(root, 'build'));
const readBuilt = (root: string, file: string) => fs.readFile(path.join(root, 'build', file), 'utf8');
const exists = (file: string) => fs.access(file).then(() => true, () => false);

afterEach(async () => {
  await running?.close();
  running = undefined;
  await server?.close();
  server = undefined;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('inline config', () => {
  it('adds wpVite() with defaults when the root has no vite.config', () => {
    const root = fixture('basic-block');
    expect(hasConfigFile(root)).toBe(false);
    const config = inlineConfig({ root });
    expect(config).toMatchObject({ root, configFile: false });
    expect(config.plugins?.flat().map((p) => p && 'name' in p && p.name)).toContain('wp-vite:config');
  });

  it('leaves config loading to Vite when a vite.config exists or --config is given', () => {
    const root = fixture('installed-externals');
    expect(hasConfigFile(root)).toBe(true);
    expect(inlineConfig({ root })).toEqual({ root });
    expect(inlineConfig({ root: fixture('basic-block'), config: 'custom.config.ts', mode: 'staging', logLevel: 'warn' })).toEqual({
      root: fixture('basic-block'),
      configFile: 'custom.config.ts',
      mode: 'staging',
      logLevel: 'warn',
    });
  });
});

describe('wp-vite build', () => {
  it('builds a project without a config file with the plugin defaults', async () => {
    const root = await copyFixture('basic-block');
    running = await runBuild({ root, logLevel: 'silent' });
    expect(running.builder.config.configFile).toBeUndefined();
    expect(await built(root)).toEqual([
      'blocks-manifest.php',
      'blocks/basic/block.json',
      'blocks/basic/index.asset.php',
      'blocks/basic/index.js',
      'blocks/basic/view.asset.php',
      'blocks/basic/view.js',
      'wp-vite.json',
      'wp-vite.php',
    ]);
    expect(running.ctx.watchers).toEqual([]);
    expect(running.ctx.options.minify).toBe('terser');
    expect(JSON.parse(await readBuilt(root, 'wp-vite.json')).entries['blocks/basic/index'].format).toBe('iife');
  });

  it('uses the config file when there is one', async () => {
    const root = await copyFixture('basic-block');
    await withConfig(root, "{ entries: { 'admin/index': 'src/admin.ts' } }");
    running = await runBuild({ root, logLevel: 'silent' });
    expect(running.builder.config.configFile).toBe(path.join(root, 'vite.config.mts'));
    expect(Object.keys(JSON.parse(await readBuilt(root, 'wp-vite.json')).entries)).toEqual(['blocks/basic/index', 'blocks/basic/view', 'admin/index']);
  });

  it('rejects a config file that does not register the plugin', async () => {
    const root = await copyFixture('no-plugin');
    await expect(runBuild({ root, logLevel: 'silent' })).rejects.toThrow(/vite\.config\.ts does not register wp-vite\. Add .*wpVite\(\)/);
  });

  it('keeps every environment running and the output intact with --watch', async () => {
    const root = await copyFixture('basic-block');
    await withConfig(root, "{ entries: { 'admin/index': 'src/admin.ts', 'frontend/index': 'src/frontend.ts' } }");
    await fs.mkdir(path.join(root, 'build'), { recursive: true });
    await fs.writeFile(path.join(root, 'build', 'stale.js'), '');
    running = await runBuild({ root, logLevel: 'silent', watch: true });
    expect(running.ctx.watchers).toHaveLength(3);
    const first = await built(root);
    expect(first).not.toContain('stale.js');
    expect(first).toEqual(expect.arrayContaining(['admin/index.js', 'blocks/basic/index.js', 'blocks/basic/block.json', 'wp-vite.php']));
    const before = await readBuilt(root, 'frontend/index.js');

    // A rebuild of the client environment must not wipe the classic scripts or the copied files.
    const source = path.join(root, 'src', 'frontend.ts');
    await fs.writeFile(source, `${await fs.readFile(source, 'utf8')}\nconsole.log('changed');\n`);
    await vi.waitFor(async () => expect(await readBuilt(root, 'frontend/index.js')).not.toBe(before), { timeout: 20_000, interval: 50 });
    await vi.waitFor(async () => expect(await exists(path.join(root, 'build', 'wp-vite.json'))).toBe(true), { timeout: 5_000, interval: 50 });
    expect(await readBuilt(root, 'frontend/index.js')).toContain('changed');
    expect(await built(root)).toEqual(first);
    const manifest = JSON.parse(await readBuilt(root, 'wp-vite.json'));
    expect(Object.keys(manifest.entries).sort()).toEqual(['admin/index', 'blocks/basic/index', 'blocks/basic/view', 'frontend/index']);
  });
});

describe('wp-vite start', () => {
  it('starts the dev server with the plugin and writes the hot file', async () => {
    const root = await copyFixture('basic-block');
    await withConfig(root, "{ entries: { 'admin/index': 'src/admin.ts', 'frontend/index': 'src/frontend.ts' } }");
    server = await runStart({ root, logLevel: 'silent', host: 'localhost', port: 0 });
    expect(server.config.plugins.map((p) => p.name)).toContain('wp-vite:dev-server');
    expect(server.resolvedUrls?.local[0]).toMatch(/^http:\/\/localhost:\d+\/$/);
    const hotFile = path.join(root, 'build', '.wp-vite', 'hot.json');
    const hot = await vi.waitFor(async () => JSON.parse(await fs.readFile(hotFile, 'utf8')), { timeout: 20_000, interval: 25 });
    expect(hot.origin).toBe(new URL(server.resolvedUrls!.local[0]!).origin);
    expect(Object.keys(hot.entries)).toEqual(['admin/index', 'frontend/index']);
    expect(await exists(path.join(root, 'build', 'blocks', 'basic', 'index.js'))).toBe(true);
  });

  it('rejects a config file that does not register the plugin', async () => {
    const root = await copyFixture('no-plugin');
    await expect(runStart({ root, logLevel: 'silent', port: 0 })).rejects.toThrow(/does not register wp-vite/);
  });
});
