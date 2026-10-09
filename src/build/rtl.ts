import rtlcss from 'rtlcss';
import type { Plugin } from 'vite';
import type { ContextHolder } from './config.js';

export function rtlFileName(cssFile: string): string {
  return cssFile.replace(/\.css$/, '-rtl.css');
}

export function rtlPlugin(holder: ContextHolder): Plugin {
  return {
    name: 'wp-vite:rtl',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      if (!holder.get().options.rtl) return;
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css') || typeof asset.source !== 'string') continue;
        this.emitFile({ type: 'asset', fileName: rtlFileName(asset.fileName), source: rtlcss.process(asset.source) });
      }
    },
  };
}
