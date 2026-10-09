import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClassifier } from '../src/externals/classify.js';
import { BUNDLED_PACKAGES, camelCaseDash, defaultRequestToHandle } from '../src/externals/table.js';

const root = path.join(import.meta.dirname, 'fixtures', 'externals-probe');
const classify = createClassifier({}, root);

describe('classify', () => {
  it.each([
    ['moment', ['moment'], 'moment'],
    ['@babel/runtime/regenerator', ['regeneratorRuntime'], 'regenerator-runtime'],
    ['lodash', ['lodash'], 'lodash'],
    ['lodash-es', ['lodash'], 'lodash'],
    ['jquery', ['jQuery'], 'jquery'],
    ['react', ['React'], 'react'],
    ['react-dom', ['ReactDOM'], 'react-dom'],
    ['react-dom/client', ['ReactDOM'], 'react-dom'],
    ['react/jsx-runtime', ['ReactJSXRuntime'], 'react-jsx-runtime'],
    ['react/jsx-dev-runtime', ['ReactJSXRuntime'], 'react-jsx-runtime'],
    ['react-refresh/runtime', ['ReactRefreshRuntime'], 'wp-react-refresh-runtime'],
    ['@wordpress/element', ['wp', 'element'], 'wp-element'],
    ['@wordpress/api-fetch', ['wp', 'apiFetch'], 'wp-api-fetch'],
    ['@wordpress/block-editor', ['wp', 'blockEditor'], 'wp-block-editor'],
  ])('%s -> global %j (%s)', (request, global, handle) => {
    expect(classify(request, 'iife')).toEqual({ kind: 'global', request, global, handle });
    expect(classify(request, 'es')).toEqual({ kind: 'global', request, global, handle });
  });

  it('keeps bundled packages, relative paths and files', () => {
    for (const request of [...BUNDLED_PACKAGES, './local', '../up', '/abs', 'other-lib', '@wordpress/components/build-style/style.css']) {
      expect(classify(request, 'iife').kind).toBe('bundle');
    }
  });

  it('maps core script modules for ES consumers', () => {
    expect(classify('@wordpress/interactivity', 'es')).toEqual({
      kind: 'module',
      request: '@wordpress/interactivity',
      id: '@wordpress/interactivity',
      staticOnly: true,
    });
    expect(classify('@wordpress/interactivity-router', 'es')).toMatchObject({ kind: 'module', staticOnly: false });
    expect(classify('@wordpress/a11y', 'es')).toMatchObject({ kind: 'module', id: '@wordpress/a11y' });
  });

  it('treats dual packages as globals for classic consumers and rejects module-only ones', () => {
    expect(classify('@wordpress/a11y', 'iife')).toMatchObject({ kind: 'global', global: ['wp', 'a11y'], handle: 'wp-a11y' });
    expect(() => classify('@wordpress/interactivity', 'iife')).toThrow(/cannot be imported from a classic script/);
    expect(() => classify('@wordpress/interactivity-router', 'iife')).toThrow(/cannot be imported from a classic script/);
  });

  it('probes installed package.json for wpScript and wpScriptModuleExports', () => {
    expect(classify('@wordpress/classic-pkg', 'es')).toMatchObject({ kind: 'global', global: ['wp', 'classicPkg'] });
    expect(classify('@wordpress/module-pkg', 'es')).toMatchObject({ kind: 'module', id: '@wordpress/module-pkg' });
    expect(classify('@wordpress/module-pkg/router', 'es')).toMatchObject({ kind: 'module', id: '@wordpress/module-pkg/router' });
    expect(() => classify('@wordpress/module-pkg', 'iife')).toThrow(/cannot be imported/);
    expect(classify('@wordpress/dual-pkg', 'es')).toMatchObject({ kind: 'module' });
    expect(classify('@wordpress/dual-pkg', 'iife')).toMatchObject({ kind: 'global', global: ['wp', 'dualPkg'] });
  });

  it('applies user overrides', () => {
    const custom = createClassifier(
      {
        requestToExternal: (r) => (r === 'acme-sdk' ? 'acme.sdk' : r === '@wordpress/icons' ? ['wp', 'icons'] : r === 'react' ? false : undefined),
        requestToExternalModule: (r) => (r === 'acme-module' ? '@acme/module' : undefined),
        requestToHandle: (r) => (r === 'acme-sdk' ? 'acme-sdk-handle' : undefined),
        bundled: ['@wordpress/element'],
      },
      root,
    );
    expect(custom('acme-sdk', 'iife')).toEqual({ kind: 'global', request: 'acme-sdk', global: ['acme', 'sdk'], handle: 'acme-sdk-handle' });
    expect(custom('@wordpress/icons', 'iife')).toMatchObject({ kind: 'global', global: ['wp', 'icons'], handle: 'wp-icons' });
    expect(custom('react', 'iife').kind).toBe('bundle');
    expect(custom('@wordpress/element', 'iife').kind).toBe('bundle');
    expect(custom('acme-module', 'es')).toMatchObject({ kind: 'module', id: '@acme/module', staticOnly: false });
    expect(custom('acme-module', 'iife').kind).toBe('bundle');
    expect(custom('@wordpress/i18n', 'iife')).toMatchObject({ kind: 'global', handle: 'wp-i18n' });
  });

  it('memoises per request and format', () => {
    expect(classify('@wordpress/data', 'es')).toBe(classify('@wordpress/data', 'es'));
    expect(classify('@wordpress/a11y', 'es')).not.toBe(classify('@wordpress/a11y', 'iife'));
  });
});

describe('table helpers', () => {
  it('camelCaseDash only uppercases letters after dashes', () => {
    expect(camelCaseDash('api-fetch')).toBe('apiFetch');
    expect(camelCaseDash('a11y')).toBe('a11y');
    expect(camelCaseDash('edit-site-2')).toBe('editSite-2');
  });

  it('defaults handles to the request', () => {
    expect(defaultRequestToHandle('moment')).toBe('moment');
    expect(defaultRequestToHandle('@wordpress/escape-html')).toBe('wp-escape-html');
  });
});
