import path from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { createHolder } from '../src/build/config.js';
import { createContext } from '../src/context.js';
import { discoverEntries } from '../src/discovery/entries.js';
import { createClassifier } from '../src/externals/classify.js';
import { externalsPlugin } from '../src/externals/plugin.js';
import { rewriteExternals } from '../src/externals/rewrite.js';
import { resolveOptions } from '../src/options.js';

const root = path.join(import.meta.dirname, 'fixtures', 'externals-dev');
const classify = createClassifier({}, root);
const rewrite = (code: string, format: 'es' | 'iife' = 'es') => rewriteExternals(code, 'test.js', (r) => classify(r, format));
const codeOf = (code: string, format?: 'es' | 'iife') => rewrite(code, format)?.code;

describe('rewriteExternals', () => {
  it('rewrites named, default and namespace imports to global references', () => {
    expect(
      codeOf(`import { useState as s, createElement } from '@wordpress/element';
import el from '@wordpress/element';
import * as ns from '@wordpress/data';
s(1); createElement('p'); el.render(); ns.select('x');`),
    ).toBe(`


window.wp.element.useState(1); window.wp.element.createElement('p'); window.wp.element.render(); window.wp.data.select('x');`);
  });

  it('keeps i18n calls as member expressions', () => {
    expect(codeOf(`import { __, _n } from '@wordpress/i18n';\nconst a = __('Hi', 'd'); _n('a', 'b', 2, 'd');`)).toBe(
      `\nconst a = window.wp.i18n.__('Hi', 'd'); window.wp.i18n._n('a', 'b', 2, 'd');`,
    );
  });

  it('respects shadowing and non-reference positions', () => {
    expect(
      codeOf(`import { useState } from '@wordpress/element';
function f(useState) { return useState; }
const g = () => { const useState = 1; return useState; };
const o = { useState: 1, [useState]: 2 };
o.useState; useState;`),
    ).toBe(`
function f(useState) { return useState; }
const g = () => { const useState = 1; return useState; };
const o = { useState: 1, [window.wp.element.useState]: 2 };
o.useState; window.wp.element.useState;`);
  });

  it('expands shorthand properties', () => {
    expect(codeOf(`import { useState } from '@wordpress/element';\nexport const o = { useState, x: 1 };`)).toBe(
      `\nexport const o = { useState: window.wp.element.useState, x: 1 };`,
    );
  });

  it('handles re-exports from externals and of imported bindings', () => {
    expect(codeOf(`export { useState, default as element } from '@wordpress/element';`)).toBe(
      `export const useState = window.wp.element.useState; export const element = window.wp.element;`,
    );
    expect(codeOf(`import { useState } from '@wordpress/element';\nconst local = 1;\nexport { useState, local, useState as default };`)).toBe(
      `\nconst local = 1;\nexport { local }; export const useState = window.wp.element.useState; export default window.wp.element.useState;`,
    );
    expect(() => rewrite(`export * from '@wordpress/element';`)).toThrow(/export \*/);
  });

  it('rewrites dynamic imports and removes side-effect imports', () => {
    expect(codeOf(`import 'jquery';\nconst m = import('@wordpress/api-fetch');`)).toBe(
      `\nconst m = Promise.resolve(window.wp.apiFetch).then((m) => ({ ...m, default: m }));`,
    );
  });

  it('uses bracket access for non-identifier global segments', () => {
    const custom = createClassifier({ requestToExternal: (r) => (r === 'acme' ? ['acme', 'my-lib'] : undefined) }, root);
    expect(rewriteExternals(`import a from 'acme'; a();`, 't.js', (r) => custom(r, 'es'))?.code).toBe(` window.acme["my-lib"]();`);
  });

  it('leaves bundled and relative imports untouched and returns null without imports', () => {
    const code = `import { Icon } from '@wordpress/icons';\nimport x from './x.js';\nIcon(x);`;
    expect(codeOf(code)).toBe(code);
    expect(rewrite(`const a = 1;`)).toBeNull();
  });

  it('keeps module externals and records static versus dynamic use', () => {
    const code = `import { store } from '@wordpress/interactivity';\nconst r = import('@wordpress/interactivity-router');\nconst a = import('@wordpress/a11y');\nimport { speak } from '@wordpress/a11y';`;
    const result = rewrite(code)!;
    expect(result.code).toBe(code);
    expect([...result.deps.modules.entries()].map(([id, m]) => [id, m.dynamic])).toEqual([
      ['@wordpress/interactivity', false],
      ['@wordpress/a11y', false],
      ['@wordpress/interactivity-router', true],
    ]);
    expect(result.deps.globals.size).toBe(0);
  });

  it('records global handles including side-effect imports', () => {
    const result = rewrite(`import 'lodash';\nimport { __ } from '@wordpress/i18n';\n__('x');`)!;
    expect([...result.deps.globals.values()].map((g) => g.handle)).toEqual(['lodash', 'wp-i18n']);
  });

  it('produces a source map when it changes code', () => {
    const result = rewrite(`import { __ } from '@wordpress/i18n';\n__('x');`)!;
    expect(result.map?.mappings).toBeTruthy();
  });
});

describe('externalsPlugin in dev', () => {
  it('rewrites user code and pre-bundled dependencies, and maps module externals to the dev origin', async () => {
    const options = resolveOptions({ entries: { entry: 'src/entry.js' }, blocks: false }, root);
    const holder = createHolder();
    const ctx = createContext(options, await discoverEntries(options), true);
    ctx.devOrigin = 'http://127.0.0.1:5173';
    holder.ctx = ctx;
    const server = await createServer({
      configFile: false,
      root,
      appType: 'custom',
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      optimizeDeps: { include: ['fake-dep'], exclude: ['react', '@wordpress/element', '@wordpress/interactivity'], entries: ['src/entry.js'] },
      plugins: [externalsPlugin(holder)],
    });
    try {
      await server.listen();
      const entry = (await server.transformRequest('/src/entry.js'))!.code;
      expect(entry).toContain(`import { store } from "http://127.0.0.1:5173/@wp-vite/wp-module/@wordpress/interactivity"`);
      expect(entry).toContain('console.log(window.wp.element.useState, store, useFake)');
      expect(entry).not.toContain('@wordpress/element');

      const depUrl = /from "([^"]*fake-dep[^"]*)"/.exec(entry)![1]!;
      const dep = (await server.transformRequest(depUrl))!.code;
      expect(dep).toContain('window.React.createElement');
      expect(dep).toContain('window.React.useState(0)');
      expect(dep).not.toMatch(/from ['"]react['"]/);

      const entryId = path.join(root, 'src', 'entry.js');
      const record = ctx.records.get('client')!.get(entryId)!;
      expect([...record.globals.keys()]).toEqual(['@wordpress/element']);
      expect([...record.modules.keys()]).toEqual(['@wordpress/interactivity']);
    } finally {
      await server.close();
    }
  });
});
