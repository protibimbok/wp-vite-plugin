import fs from 'node:fs';
import path from 'node:path';
import type { InlineConfig, LogLevel, ResolvedConfig } from 'vite';
import type { ContextHolder } from '../build/config.js';
import type { WPViteContext } from '../context.js';
import { WPViteError } from '../errors.js';
import { wpVite } from '../index.js';

export interface CommonOptions {
  root?: string;
  config?: string;
  mode?: string;
  logLevel?: LogLevel;
  clearScreen?: boolean;
}

// The names Vite itself looks for in the root.
const CONFIG_FILES = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.cjs', 'vite.config.mts', 'vite.config.cts'];

export function hasConfigFile(root: string): boolean {
  return CONFIG_FILES.some((name) => fs.existsSync(path.join(root, name)));
}

// A project without a vite.config gets the plugin with its defaults, like `wp-scripts` needs no
// webpack.config; with one, the file is expected to register wpVite() itself.
export function inlineConfig(options: CommonOptions): InlineConfig {
  const root = path.resolve(options.root ?? '.');
  const config: InlineConfig = { root };
  if (options.mode !== undefined) config.mode = options.mode;
  if (options.logLevel !== undefined) config.logLevel = options.logLevel;
  if (options.clearScreen !== undefined) config.clearScreen = options.clearScreen;
  if (options.config !== undefined) config.configFile = options.config;
  else if (!hasConfigFile(root)) {
    config.configFile = false;
    config.plugins = [wpVite()];
  }
  return config;
}

export function contextOf(config: ResolvedConfig): WPViteContext {
  const holder = config.plugins.find((plugin) => plugin.name === 'wp-vite:config')?.api as ContextHolder | undefined;
  if (!holder) {
    const file = config.configFile ? path.relative(config.root, config.configFile) : 'vite.config';
    throw new WPViteError(`${file} does not register wp-vite. Add \`import { wpVite } from 'wp-vite-plugin'\` and \`plugins: [wpVite()]\`.`);
  }
  return holder.get();
}
