import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuilder, type InlineConfig } from 'vite';
import { expect } from 'vitest';
import type { ContextHolder } from '../src/build/config.js';
import { wpVite, type WPViteContext, type WPViteOptions } from '../src/index.js';

export const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);

const silentLogger = {
  info() {},
  warn() {},
  warnOnce() {},
  error() {},
  clearScreen() {},
  hasErrorLogged: () => false,
  hasWarned: false,
};

export interface Built {
  root: string;
  ctx: WPViteContext;
  warnings: string[];
}

export async function build(name: string, options: WPViteOptions = {}, config: InlineConfig = {}): Promise<Built> {
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
      ...config,
    });
    await builder.buildApp();
  } finally {
    process.env.NODE_ENV = previous;
  }
  return { root, ctx: (plugins[0]!.api as ContextHolder).get(), warnings };
}

export async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])),
  );
  return files.flat().map((f) => f.split(path.sep).join('/')).sort();
}

export const readBuilt = (root: string, file: string) => fs.readFile(path.join(root, 'build', file), 'utf8');

export async function readPhp(root: string, file: string): Promise<string> {
  const php = await readBuilt(root, file);
  expect(php).toMatch(/^<\?php return array\(.*\);\n$/s);
  return php;
}
