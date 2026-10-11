import { createBuilder, mergeConfig, type InlineConfig, type Plugin, type PluginOption, type ViteDevServer } from 'vite';
import { DEV_BUILD_PLUGIN, type ContextHolder } from '../build/config.js';
import { isWatcher, watchBuilds, type Watcher } from '../build/watch.js';

export interface DevBuild {
  // Settles once every environment has finished (or failed) its first build.
  ready: Promise<void>;
  close(): Promise<void>;
}

// Classic block scripts cannot be served as modules, so the dev server builds them into outDir
// with a second Vite instance in watch mode. Re-evaluating the config file gives that instance
// its own plugins and context; the marker plugin switches wp-vite into the dev flavour.
export async function startDevBuild(server: ViteDevServer, freshPlugins: () => Plugin[], onRebuilt: () => void): Promise<DevBuild> {
  const builder = await createBuilder(await devBuildConfig(server, freshPlugins));
  const holder = builder.config.plugins.find((plugin) => plugin.name === 'wp-vite:config')?.api as ContextHolder | undefined;
  if (!holder) throw new Error('wp-vite: the dev build config does not register wpVite()');

  const watchers: Watcher[] = [];
  const settled: Promise<void>[] = [];
  for (const name of holder.get().iifeEnvironments.keys()) {
    const result = await builder.build(builder.environments[name]!);
    if (!isWatcher(result)) continue;
    watchers.push(result);
    settled.push(watchBuilds(result, onRebuilt));
  }
  return {
    ready: Promise.all(settled).then(() => undefined),
    close: async () => {
      await Promise.all(watchers.map((watcher) => watcher.close()));
    },
  };
}

async function devBuildConfig(server: ViteDevServer, freshPlugins: () => Plugin[]): Promise<InlineConfig> {
  const { inlineConfig, configFile, server: serverOptions } = server.config;
  const marker: Plugin = { name: DEV_BUILD_PLUGIN };
  // With a config file the user's plugins are instantiated anew by Vite; inline plugins are reused,
  // except wp-vite's own, which must not share their context with the dev server.
  const inlinePlugins = (await flatten(inlineConfig.plugins ?? [])).filter((plugin) => !plugin.name.startsWith('wp-vite:'));
  const plugins = configFile ? [marker, ...inlinePlugins] : [marker, ...freshPlugins(), ...inlinePlugins];
  const polling = serverOptions.watch ? { usePolling: serverOptions.watch.usePolling, interval: serverOptions.watch.interval } : {};
  return {
    ...inlineConfig,
    configFile: configFile ?? false,
    mode: server.config.mode,
    customLogger: server.config.logger,
    plugins,
    build: mergeConfig({ watch: { chokidar: polling } }, inlineConfig.build ?? {}),
  };
}

async function flatten(option: PluginOption): Promise<Plugin[]> {
  const resolved = await option;
  if (Array.isArray(resolved)) return (await Promise.all(resolved.map(flatten))).flat();
  return resolved && typeof resolved === 'object' && 'name' in resolved ? [resolved] : [];
}
