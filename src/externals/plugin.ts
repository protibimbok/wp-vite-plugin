import type { Plugin } from 'vite';
import type { ContextHolder } from '../build/config.js';
import type { WPViteContext } from '../context.js';
import { globalExpression } from './rewrite.js';
import { rewriteExternals, type ExternalDeps } from './rewrite.js';

const VIRTUAL_PREFIX = '\0wp-vite:external:';
const SCRIPT_RE = /\.(?:m|c)?[jt]sx?(?:$|\?)|^\/@wp-vite\//;

export function externalsPlugin(holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:externals',
    enforce: 'post',

    // Runs before vite:resolve, which would otherwise resolve an installed @wordpress package from
    // node_modules and bundle it.
    resolveId: {
      order: 'pre',
      handler(source, importer) {
        if (!importer || !isBare(source)) return null;
        const ctx = holder.get();
        const environment = this.environment?.name ?? 'client';
        const classification = ctx.classify(source, ctx.formatOf(environment));
        if (classification.kind === 'bundle') return null;
        if (classification.kind === 'global') {
          return ctx.isDev ? { id: VIRTUAL_PREFIX + source, external: true } : { id: source, external: true };
        }
        const id = ctx.isDev && ctx.devOrigin ? `${ctx.devOrigin}/@wp-vite/wp-module/${classification.id}` : classification.id;
        return { id, external: true };
      },
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const ctx = holder.get();
      const classification = ctx.classify(id.slice(VIRTUAL_PREFIX.length), 'es');
      if (classification.kind !== 'global') return null;
      return `export default ${globalExpression(classification.global)};`;
    },

    transform: {
      filter: { code: /\b(?:import|export)\b/ },
      handler(code, id) {
        if (id.startsWith('\0') || !SCRIPT_RE.test(id)) return null;
        const ctx = holder.get();
        const environment = this.environment?.name ?? 'client';
        const format = ctx.formatOf(environment);
        const result = rewriteExternals(code, id, (request) => ctx.classify(request, format));
        if (!result) return null;
        setRecord(ctx, environment, id, result.deps);
        if (!result.map) return null;
        // Virtual modules have no source file for a map to point at.
        return { code: result.code, map: id.startsWith('/@wp-vite/') ? { mappings: '' } : result.map };
      },
    },
  };
}

function setRecord(ctx: WPViteContext, environment: string, id: string, deps: ExternalDeps): void {
  let records = ctx.records.get(environment);
  if (!records) {
    records = new Map();
    ctx.records.set(environment, records);
  }
  if (deps.globals.size || deps.modules.size) records.set(id, deps);
  else records.delete(id);
}

function isBare(source: string): boolean {
  return !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0') && !/^[a-z]+:/i.test(source);
}
