import MagicString from 'magic-string';
import { normalizePath, type Plugin } from 'vite';
import type { ContextHolder } from '../build/config.js';
import { REACT_REFRESH_PLUGIN, REFRESH_PREAMBLE_ID } from './virtual.js';

// Imports evaluate in source order, so an entry that imports the preamble first has Fast Refresh
// set up before any component module in its graph runs.
export function refreshPreamblePlugin(holder: ContextHolder): Plugin {
  let refresh = false;
  return {
    name: 'wp-vite:refresh-preamble',
    apply: 'serve',

    configResolved(config) {
      refresh = config.plugins.some((plugin) => plugin.name === REACT_REFRESH_PLUGIN);
    },

    transform(code, id) {
      if (!refresh || (this.environment?.name ?? 'client') !== 'client') return null;
      const entry = holder.get().discovery.entries.find((e) => normalizePath(e.file) === id);
      if (!entry || entry.format === 'css') return null;
      const s = new MagicString(code);
      s.prepend(`import ${JSON.stringify(REFRESH_PREAMBLE_ID)};\n`);
      return { code: s.toString(), map: s.generateMap({ hires: true, source: id }) };
    },
  };
}
