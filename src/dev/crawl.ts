import path from 'node:path';
import { isCSSRequest, type DevEnvironment, type EnvironmentModuleNode } from 'vite';
import type { WPViteContext } from '../context.js';
import type { Entry } from '../discovery/entries.js';
import { isInside, toPosix } from '../discovery/names.js';

export interface EntryDevDeps {
  scripts: string[];
  modules: string[];
  styles: string[];
}

export type DevDeps = Map<string, EntryDevDeps>;

export interface CrawlResult {
  deps: DevDeps;
  errors: Array<{ entry: Entry; error: Error }>;
}

// Imports that do not inject a stylesheet into the page.
const NON_STYLE_QUERY_RE = /[?&](?:inline|url|raw)(?:$|&)/;

export function entryUrl(ctx: WPViteContext, entry: Entry): string {
  const { root } = ctx.options;
  return isInside(root, entry.file) ? `/${toPosix(path.relative(root, entry.file))}` : path.posix.join('/@fs/', toPosix(entry.file));
}

// Dev serves whatever the browser asks for, so nothing has been transformed when the server starts.
// Walking each entry through transformRequest fills the module graph and the externals records at
// once; later crawls are cheap because unchanged modules come back from the transform cache.
export async function crawlEntries(environment: DevEnvironment, ctx: WPViteContext, previous?: DevDeps): Promise<CrawlResult> {
  const origin = ctx.devOrigin ?? '';
  const result: CrawlResult = { deps: new Map(), errors: [] };

  for (const entry of ctx.discovery.entries) {
    if (entry.format === 'iife') continue;
    if (entry.format === 'css') {
      result.deps.set(entry.name, { scripts: [], modules: [], styles: [] });
      continue;
    }
    const scripts = new Set<string>();
    const modules = new Set<string>();
    const styles = new Set<string>();
    try {
      await walk(environment, entryUrl(ctx, entry), (mod) => {
        if (isCSSRequest(mod.url) && !NON_STYLE_QUERY_RE.test(mod.url)) styles.add(origin + mod.url);
        // The transform creates the per-environment map on first use, so look it up per module.
        const record = mod.id ? ctx.records.get(environment.name)?.get(mod.id) : undefined;
        if (!record) return;
        for (const global of record.globals.values()) scripts.add(global.handle);
        for (const { classification } of record.modules.values()) modules.add(classification.id);
      });
      result.deps.set(entry.name, { scripts: [...scripts].sort(), modules: [...modules].sort(), styles: [...styles].sort() });
    } catch (error) {
      result.errors.push({ entry, error: error as Error });
      result.deps.set(entry.name, previous?.get(entry.name) ?? { scripts: [], modules: [], styles: [] });
    }
  }
  return result;
}

async function walk(environment: DevEnvironment, url: string, visit: (mod: EnvironmentModuleNode) => void): Promise<void> {
  const seen = new Set<EnvironmentModuleNode>();
  const queue = [url];
  while (queue.length) {
    const next = queue.shift()!;
    await environment.transformRequest(next);
    const mod = await environment.moduleGraph.getModuleByUrl(next);
    if (!mod || seen.has(mod)) continue;
    seen.add(mod);
    visit(mod);
    if (isCSSRequest(mod.url)) continue;
    for (const imported of mod.importedModules) {
      if (!seen.has(imported)) queue.push(imported.url);
    }
  }
}
