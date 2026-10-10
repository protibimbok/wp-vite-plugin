import type { Plugin } from 'vite';
import type { ContextHolder } from '../build/config.js';

export const REFRESH_PREAMBLE_ID = '/@wp-vite/react-refresh-preamble';
export const JSX_DEV_RUNTIME_ID = '/@wp-vite/jsx-dev-runtime';
export const JSX_DEV_RUNTIME_REQUEST = 'react/jsx-dev-runtime';
export const REACT_REFRESH_PLUGIN = 'vite:react-refresh';

const VIRTUAL_IDS = new Set([REFRESH_PREAMBLE_ID, JSX_DEV_RUNTIME_ID]);

// WordPress ships ReactJSXRuntime (jsx/jsxs) but not the development runtime (jsxDEV) that
// Vite's JSX transform imports in dev, so dev builds get a shim over the production runtime.
const JSX_DEV_RUNTIME = `import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
export { Fragment };
export function jsxDEV(type, props, key, isStaticChildren) {
  return isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key);
}
`;

export function refreshPreamble(origin: string): string {
  return `import RefreshRuntime from '${origin}/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
`;
}

export function devVirtualPlugin(holder: ContextHolder): Plugin {
  let refresh = false;
  return {
    name: 'wp-vite:dev-virtual',
    apply: 'serve',
    enforce: 'pre',

    configResolved(config) {
      refresh = config.plugins.some((plugin) => plugin.name === REACT_REFRESH_PLUGIN);
    },

    resolveId(source, importer) {
      if (VIRTUAL_IDS.has(source)) return source;
      if (source === JSX_DEV_RUNTIME_REQUEST && importer && !importer.startsWith('\0')) return JSX_DEV_RUNTIME_ID;
      return null;
    },

    load(id) {
      if (id === JSX_DEV_RUNTIME_ID) return JSX_DEV_RUNTIME;
      if (id === REFRESH_PREAMBLE_ID) {
        const ctx = holder.get();
        return refresh && ctx.devOrigin ? refreshPreamble(ctx.devOrigin) : '';
      }
      return null;
    },
  };
}
