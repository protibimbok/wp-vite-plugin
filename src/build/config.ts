import fs from 'node:fs';
import path from 'node:path';
import type { ConfigEnv, Plugin, PluginOption, UserConfig } from 'vite';
import { createContext, type WPViteContext } from '../context.js';
import { discoverEntries } from '../discovery/entries.js';
import { BUNDLED_PACKAGES, WORDPRESS_NAMESPACE } from '../externals/table.js';
import { resolveOptions, type WPViteOptions } from '../options.js';
import { CLIENT_ENVIRONMENT, buildApp, iifeEnvironment, iifeEnvironmentName } from './environments.js';
import { terserOptions } from './i18n.js';

// Marker plugin the dev server adds to the watch build it launches for classic block scripts.
export const DEV_BUILD_PLUGIN = 'wp-vite:dev-build';

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

export function isDevBuild(config: UserConfig): boolean {
  const flatten = (option: PluginOption): Plugin[] =>
    Array.isArray(option) ? option.flatMap(flatten) : option && typeof option === 'object' && 'name' in option ? [option] : [];
  return flatten(config.plugins ?? []).some((plugin) => plugin.name === DEV_BUILD_PLUGIN);
}

// For plugins that only produce output the dev server writes itself (copies, manifests).
export const applyProdBuild: NonNullable<Plugin['apply']> = (config, env) => env.command === 'build' && !isDevBuild(config);

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
      return buildConfig(holder, ctx, userConfig, env);
    },
  };
}

function buildConfig(holder: ContextHolder, ctx: WPViteContext, userConfig: UserConfig, env: ConfigEnv): UserConfig {
  const { options, discovery } = ctx;
  // Stylesheet entries (block.json style fields) build in the client environment with the ESM ones.
  const clientEntries = discovery.entries.filter((e) => e.format !== 'iife');
  const iifeEntries = discovery.entries.filter((e) => e.format === 'iife');
  const isBuild = env.command === 'build';
  const devBuild = isBuild && isDevBuild(userConfig);
  const watching = isBuild && !devBuild && !!userConfig.build?.watch;

  const config: UserConfig = {
    appType: 'custom',
    publicDir: false,
    define: { SCRIPT_DEBUG: JSON.stringify(!isBuild || devBuild) },
    optimizeDeps: {
      entries: discovery.entries.filter((e) => e.format === 'es').map((e) => e.file),
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
      minify: devBuild ? false : (userConfig.build?.minify ?? options.minify),
      terserOptions: { ...terserOptions(), ...userConfig.build?.terserOptions },
      rolldownOptions: { output: { assetFileNames: assetFileNames((original) => esCssFileName(ctx, original)) } },
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

  if (devBuild) {
    // The dev server serves modules and stylesheets; only classic scripts are built, next to the
    // production output they replace. WordPress has no jsxDEV runtime, hence the production JSX.
    config.oxc = { jsx: { development: false } };
    iifeEntries.forEach((entry, index) => {
      const name = iifeEnvironmentName(entry, index);
      ctx.iifeEnvironments.set(name, entry);
      config.environments![name] = iifeEnvironment(entry, false, { ...output, assetFileNames: assetFileNames(() => `${entry.name}.css`) });
    });
    return config;
  }

  ctx.finalEnvironment = iifeEntries.length > 0 ? iifeEnvironmentName(iifeEntries.at(-1)!, iifeEntries.length - 1) : CLIENT_ENVIRONMENT;
  config.environments![CLIENT_ENVIRONMENT] = {
    build: {
      emptyOutDir: !watching,
      cssCodeSplit: true,
      rolldownOptions: {
        input: Object.fromEntries(clientEntries.map((e) => [e.name, e.file])),
        preserveEntrySignatures: 'exports-only',
        optimization: { inlineConst: false },
        output: { ...output, format: 'es' },
      },
    },
  };

  iifeEntries.forEach((entry, index) => {
    const name = iifeEnvironmentName(entry, index);
    ctx.iifeEnvironments.set(name, entry);
    const emptyOutDir = clientEntries.length === 0 && index === 0 && !watching;
    const iifeOutput = { ...output, assetFileNames: assetFileNames(() => `${entry.name}.css`) };
    config.environments![name] = iifeEnvironment(entry, emptyOutDir, iifeOutput);
  });

  if (!userConfig.builder) {
    // Inline plugins re-run this hook per environment; the hooks read the holder, so must buildApp.
    config.builder = { buildApp: (builder) => buildApp(builder, holder.get(), clientEntries.length > 0) };
  }
  return config;
}

// Vite predicts the directory of an environment's CSS bundle from that environment's assetFileNames
// to resolve url() paths, so each IIFE environment names its own `<entry>.css` statically.
function assetFileNames(cssFileName: (originalFileName: string | undefined) => string) {
  return (info: { names?: string[]; name?: string; originalFileNames?: string[] }): string => {
    const name = info.names?.[0] ?? info.name ?? 'asset';
    if (name.endsWith('.css')) return cssFileName(info.originalFileNames?.[0]);
    if (IMAGE_RE.test(name)) return 'images/[name]-[hash][extname]';
    if (FONT_RE.test(name)) return 'fonts/[name]-[hash][extname]';
    return 'assets/[name]-[hash][extname]';
  };
}

function esCssFileName(ctx: WPViteContext, originalFileName: string | undefined): string {
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
