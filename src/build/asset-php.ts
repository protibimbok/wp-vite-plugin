import { createHash } from 'node:crypto';
import type { Plugin, Rolldown } from 'vite';
import type { ContextHolder } from './config.js';
import type { EntryDeps } from '../context.js';
import type { Entry } from '../discovery/entries.js';
import { WPViteError } from '../errors.js';
import { phpFile } from '../php/serialize.js';
import { collectEntryDependencies, type ChunkGraphNode } from './deps.js';

export function assetPhpSource(deps: EntryDeps): string {
  if (deps.format === 'iife') return phpFile({ dependencies: deps.scripts, version: deps.version });
  const dependencies = [
    ...deps.modules.map((id) => ({ id, import: 'static' })),
    ...deps.dynamicModules.map((id) => ({ id, import: 'dynamic' })),
  ];
  return phpFile({ dependencies, version: deps.version, type: 'module' });
}

export function assetsPlugin(holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:assets',
    apply: 'build',
    enforce: 'post',

    generateBundle(_, bundle) {
      const ctx = holder.get();
      const environment = this.environment.name;
      const format = ctx.formatOf(environment);
      const records = ctx.records.get(environment) ?? new Map();
      const chunks = chunkGraph(bundle);

      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        const entry = ctx.discovery.entries.find((e) => e.name === chunk.name);
        if (!entry) continue;

        const dependencies = collectEntryDependencies(chunks.get(chunk.fileName)!, chunks, records);
        const { css, styleCss } = cssFor(chunk, dependencies.imports, entry, bundle, format, ctx.styleFiles);
        const deps: EntryDeps = {
          name: entry.name,
          file: chunk.fileName,
          format,
          ...dependencies,
          css,
          styleCss,
          version: versionOf(chunk, [...css, ...styleCss], bundle),
        };
        checkModuleEntry(entry, deps, ctx.options.moduleClassicDeps, (message) => this.warn(message));
        ctx.deps.set(entry.name, deps);
        this.emitFile({ type: 'asset', fileName: `${entry.name}.asset.php`, source: assetPhpSource(deps) });
      }
    },
  };
}

function chunkGraph(bundle: Rolldown.OutputBundle): Map<string, ChunkGraphNode> {
  const chunks = new Map<string, ChunkGraphNode>();
  for (const output of Object.values(bundle)) {
    if (output.type === 'chunk') chunks.set(output.fileName, output);
  }
  return chunks;
}

// Static chunk CSS belongs to the entry; dynamically imported chunks load theirs through Vite's
// preload helper at runtime.
function cssFor(
  chunk: Rolldown.OutputChunk,
  staticImports: string[],
  entry: Entry,
  bundle: Rolldown.OutputBundle,
  format: 'es' | 'iife',
  styleFiles: ReadonlySet<string>,
): { css: string[]; styleCss: string[] } {
  const files = new Set(chunk.viteMetadata?.importedCss);
  for (const file of staticImports) {
    const imported = bundle[file];
    if (imported?.type === 'chunk') imported.viteMetadata?.importedCss.forEach((css) => files.add(css));
  }
  if (format === 'iife' && `${entry.name}.css` in bundle) files.add(`${entry.name}.css`);
  const sorted = [...files].sort();
  return { css: sorted.filter((f) => !styleFiles.has(f)), styleCss: sorted.filter((f) => styleFiles.has(f)) };
}

function versionOf(chunk: Rolldown.OutputChunk, css: string[], bundle: Rolldown.OutputBundle): string {
  const hash = createHash('sha1').update(chunk.code);
  for (const file of css) {
    const asset = bundle[file];
    if (asset?.type === 'asset') hash.update(asset.source);
  }
  return hash.digest('hex').slice(0, 20);
}

function checkModuleEntry(entry: Entry, deps: EntryDeps, mode: 'error' | 'warn', warn: (message: string) => void): void {
  if (deps.format !== 'es' || deps.scripts.length === 0) return;
  const blockFields = entry.sources.filter((s) => s.field === 'viewScriptModule');
  if (blockFields.length === 0) return;
  const message =
    `${entry.name} is a viewScriptModule of ${blockFields.map((s) => s.block).join(', ')} but depends on classic scripts ` +
    `(${deps.scripts.join(', ')}); WordPress cannot load those for a script module registered from block.json. ` +
    `Use script-module packages instead, or set moduleClassicDeps: 'warn' to accept the risk.`;
  if (mode === 'error') throw new WPViteError(message);
  warn(message);
}
