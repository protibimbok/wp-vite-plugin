import { attachScopes, type AttachedScope } from '@rollup/pluginutils';
import type * as ESTree from 'estree';
import { walk } from 'estree-walker';
import isReference from 'is-reference';
import MagicString, { type SourceMap } from 'magic-string';
import { parseAst } from 'vite';
import { WPViteError } from '../errors.js';
import type { Classification } from './classify.js';

type GlobalClassification = Extract<Classification, { kind: 'global' }>;
type ModuleClassification = Extract<Classification, { kind: 'module' }>;
type Node = ESTree.Node & { start: number; end: number; scope?: AttachedScope };

export interface ExternalDeps {
  globals: Map<string, GlobalClassification>;
  modules: Map<string, { classification: ModuleClassification; dynamic: boolean }>;
}

export interface RewriteResult {
  code: string;
  map: SourceMap | null;
  deps: ExternalDeps;
}

export function createDeps(): ExternalDeps {
  return { globals: new Map(), modules: new Map() };
}

export function globalExpression(path: string[]): string {
  return ['window', ...path].map((p, i) => (i === 0 ? p : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`)).join('');
}

export function rewriteExternals(code: string, id: string, classify: (request: string) => Classification): RewriteResult | null {
  if (!/\b(import|export)\b/.test(code)) return null;

  const ast = parseAst(code) as unknown as ESTree.Program & { start: number; end: number };
  const s = new MagicString(code);
  const deps = createDeps();
  const bindings = new Map<string, string>();
  let changed = false;

  const record = (classification: Classification, dynamic: boolean): string | undefined => {
    if (classification.kind === 'global') {
      deps.globals.set(classification.request, classification);
      return globalExpression(classification.global);
    }
    if (classification.kind === 'module') {
      const existing = deps.modules.get(classification.id);
      deps.modules.set(classification.id, { classification, dynamic: dynamic && (existing?.dynamic ?? true) });
    }
    return undefined;
  };

  const memberOf = (base: string, name: string) => (name === 'default' ? base : `${base}.${name}`);

  for (const node of ast.body as Node[]) {
    if (node.type === 'ImportDeclaration') {
      const base = record(classify(node.source.value as string), false);
      if (!base) continue;
      for (const spec of node.specifiers) {
        const imported = spec.type === 'ImportSpecifier' ? specifierName(spec.imported) : spec.type === 'ImportDefaultSpecifier' ? 'default' : null;
        bindings.set(spec.local.name, imported === null ? base : memberOf(base, imported));
      }
      s.remove(node.start, node.end);
      changed = true;
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      const base = record(classify(node.source.value as string), false);
      if (!base) continue;
      const decls = node.specifiers.map((spec) => exportFrom(specifierName(spec.exported), memberOf(base, specifierName(spec.local))));
      s.overwrite(node.start, node.end, decls.join(' '));
      changed = true;
    } else if (node.type === 'ExportAllDeclaration') {
      const classification = classify(node.source.value as string);
      if (classification.kind === 'global') {
        throw new WPViteError(`${id}: "export * from '${classification.request}'" is not supported for externals; re-export names explicitly`);
      }
      record(classification, false);
    }
  }

  let scope = attachScopes(ast, 'scope');
  const shadowed = (name: string) => scope.contains(name);
  const expressionFor = (name: string) => (bindings.has(name) && !shadowed(name) ? bindings.get(name) : undefined);

  walk(ast as unknown as ESTree.Node, {
    enter(n, p) {
      const node = n as Node;
      const parent = p as Node | null;
      if (node.scope) scope = node.scope;

      if (node.type === 'ImportDeclaration' || (node.type === 'ExportNamedDeclaration' && node.source) || node.type === 'ExportAllDeclaration') {
        this.skip();
        return;
      }

      if (node.type === 'ImportExpression') {
        const source = node.source as Node;
        if (source.type === 'Literal' && typeof source.value === 'string') {
          const base = record(classify(source.value), true);
          if (base) {
            s.overwrite(node.start, node.end, `Promise.resolve(${base}).then((m) => ({ ...m, default: m }))`);
            changed = true;
            this.skip();
          }
        }
        return;
      }

      if (node.type === 'ExportNamedDeclaration' && node.specifiers.length) {
        const kept: string[] = [];
        const extracted: string[] = [];
        for (const spec of node.specifiers) {
          const expression = spec.local.type === 'Identifier' ? expressionFor(spec.local.name) : undefined;
          if (expression) extracted.push(exportFrom(specifierName(spec.exported), expression));
          else kept.push(s.slice((spec as Node).start, (spec as Node).end));
        }
        if (extracted.length) {
          const parts = kept.length ? [`export { ${kept.join(', ')} };`, ...extracted] : extracted;
          s.overwrite(node.start, node.end, parts.join(' '));
          changed = true;
          this.skip();
        }
        return;
      }

      if (node.type === 'Property' && node.shorthand && node.value.type === 'Identifier') {
        const expression = expressionFor(node.value.name);
        if (expression) {
          s.overwrite(node.start, node.end, `${node.value.name}: ${expression}`);
          changed = true;
          this.skip();
        }
        return;
      }

      if (node.type === 'Identifier' && parent && isReference(node as ESTree.Identifier, parent as ESTree.Node)) {
        const expression = expressionFor(node.name);
        if (expression) {
          s.overwrite(node.start, node.end, expression);
          changed = true;
        }
      }
    },
    leave(n) {
      const node = n as Node;
      if (node.scope && scope.parent) scope = scope.parent;
    },
  });

  if (!changed) return { code, map: null, deps };
  return { code: s.toString(), map: s.generateMap({ hires: true, source: id }), deps };
}

function specifierName(node: ESTree.Identifier | ESTree.Literal): string {
  return node.type === 'Identifier' ? node.name : String(node.value);
}

function exportFrom(exported: string, expression: string): string {
  return exported === 'default' ? `export default ${expression};` : `export const ${exported} = ${expression};`;
}
