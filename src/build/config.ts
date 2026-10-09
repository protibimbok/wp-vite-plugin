import fs from 'node:fs';
import path from 'node:path';
import type { ConfigEnv, Plugin, UserConfig } from 'vite';
import { createContext, type WPViteContext } from '../context.js';
import { discoverEntries } from '../discovery/entries.js';
import { BUNDLED_PACKAGES, WORDPRESS_NAMESPACE } from '../externals/table.js';
import { resolveOptions, type WPViteOptions } from '../options.js';
import { CLIENT_ENVIRONMENT, buildApp, iifeEnvironment, iifeEnvironmentName } from './environments.js';
import { terserOptions } from './i18n.js';

const FIXED_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'lodash',
  'lodash-es',
  'jquery',
  'moment',
  '@babel/runtime/regenerator',
];

const IMAGE_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const FONT_RE = /\.(?:woff2?|eot|ttf|otf)$/i;

export interface ContextHolder {
  ctx: WPViteContext | undefined;
  get(): WPViteContext;
}

export function createHolder(): ContextHolder {
  return {
    ctx: undefined,
    get() {
      if (!this.ctx) throw new Error('wp-vite: context is not initialised; is the plugin registered in vite.config?');
      return this.ctx;
    },
  };
}

export function configPlugin(rawOptions: WPViteOptions, holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:config',
    api: holder,
    async config(userConfig, env) {
      const root = userConfig.root ? path.resolve(userConfig.root) : process.cwd();
      const options = resolveOptions(rawOptions, root);
      const discovery = await discoverEntries(options);
      const ctx = createContext(options, discovery, env.command === 'serve');
      holder.ctx = ctx;
      return buildConfig(ctx, userConfig, env);
    },
    buildStart() {
      holder.get().activeIifeEntry = holder.get().iifeEnvironments.get(this.environment.name);
    },
  };
}

function buildConfig(ctx: WPViteContext, userConfig: UserConfig, env: ConfigEnv): UserConfig {
  const { options, discovery } = ctx;
  const esEntries = discovery.entries.filter((e) => e.format === 'es');
  const iifeEntries = discovery.entries.filter((e) => e.format === 'iife');
  const isBuild = env.command === 'build';

  const config: UserConfig = {
    appType: 'custom',
    publicDir: false,
    define: { SCRIPT_DEBUG: JSON.stringify(!isBuild) },
    optimizeDeps: {
      entries: discovery.entries.map((e) => e.file),
      exclude: externalsToExclude(options.root),
    },
    server: {
      cors: options.wpOrigin ? { origin: options.wpOrigin } : true,
    },
    build: {
      outDir: options.outDir,
      manifest: false,
      assetsDir: 'assets',
      sourcemap: userConfig.build?.sourcemap ?? options.sourcemap ?? false,
      minify: userConfig.build?.minify ?? options.minify,
      terserOptions: { ...terserOptions(), ...userConfig.build?.terserOptions },
      rolldownOptions: { output: { assetFileNames: assetFileNames(ctx) } },
    },
    environments: {},
  };

  if (!isBuild) return config;
  config.base = './';

  const output = {
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    comments: { jsdoc: true },
  };

  ctx.primaryEnvironment = esEntries.length > 0 ? CLIENT_ENVIRONMENT : iifeEnvironmentName(iifeEntries[0]!, 0);
  config.environments![CLIENT_ENVIRONMENT] = {
    build: {
      emptyOutDir: true,
      cssCodeSplit: true,
      rolldownOptions: {
        input: Object.fromEntries(esEntries.map((e) => [e.name, e.file])),
        preserveEntrySignatures: 'exports-only',
        optimization: { inlineConst: false },
        output: { ...output, format: 'es' },
      },
    },
  };

  iifeEntries.forEach((entry, index) => {
    const name = iifeEnvironmentName(entry, index);
    ctx.iifeEnvironments.set(name, entry);
    const emptyOutDir = esEntries.length === 0 && index === 0;
    config.environments![name] = iifeEnvironment(entry, emptyOutDir, output);
  });

  if (!userConfig.builder) {
    config.builder = { buildApp: (builder) => buildApp(builder, ctx, esEntries.length > 0) };
  }
  return config;
}

// One function for every environment: Vite resolves url() paths in chunk CSS against the root
// config's assetFileNames, so the IIFE entry is read from context instead of being bound per env.
function assetFileNames(ctx: WPViteContext) {
  return (info: { names?: string[]; name?: string; originalFileNames?: string[] }): string => {
    const name = info.names?.[0] ?? info.name ?? 'asset';
    if (name.endsWith('.css')) return cssFileName(ctx, info.originalFileNames?.[0]);
    if (IMAGE_RE.test(name)) return 'images/[name]-[hash][extname]';
    if (FONT_RE.test(name)) return 'fonts/[name]-[hash][extname]';
    return 'assets/[name]-[hash][extname]';
  };
}

function cssFileName(ctx: WPViteContext, originalFileName: string | undefined): string {
  if (ctx.activeIifeEntry) return `${ctx.activeIifeEntry.name}.css`;
  const file = originalFileName && path.resolve(ctx.options.root, originalFileName);
  const entry = file && ctx.discovery.entries.find((e) => e.file === file);
  return entry ? `${entry.name}.css` : 'chunks/[name]-[hash].css';
}

function externalsToExclude(root: string): string[] {
  const dir = path.join(root, 'node_modules', '@wordpress');
  let installed: string[] = [];
  try {
    installed = fs.readdirSync(dir).map((name) => WORDPRESS_NAMESPACE + name);
  } catch {
    installed = [];
  }
  return [...FIXED_EXTERNALS, ...installed.filter((name) => !BUNDLED_PACKAGES.includes(name))];
}
