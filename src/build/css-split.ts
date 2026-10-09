import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { ContextHolder } from './config.js';
import { finalizeCss } from './css-finalize.js';

const STYLE_RE = /(?:^|[\\/])style(?:\.module)?\.(?:css|scss|sass|less|styl|stylus|pcss|postcss|sss)$/;
const ASSET_URL_RE = /__VITE_ASSET__([\w$]{22})(?:_[a-f\d]{24})?__/g;
const VITE_HASH_MARKER_RE = /\/\*\$vite\$:\d+\*\//g;

export function isStyleFile(id: string): boolean {
  return !id.startsWith('\0') && !id.includes('?') && STYLE_RE.test(id);
}

export function styleFileName(cssFile: string): string {
  const dir = path.posix.dirname(cssFile);
  const base = `style-${path.posix.basename(cssFile)}`;
  return dir === '.' ? base : `${dir}/${base}`;
}

// Sits between vite:css (preprocessing) and vite:css-post (collection) so that style.* sources
// leave Vite's chunk CSS and are emitted as style-<name>.css like wp-scripts.
export function cssSplitPlugin(holder: ContextHolder): Plugin {
  const styles = new Map<string, string>();
  let config: ResolvedConfig;

  return {
    name: 'wp-vite:css-split',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    transform: {
      filter: { id: STYLE_RE },
      handler(code, id) {
        if (!isStyleFile(id)) return null;
        styles.set(id, code);
        return { code: '', map: { mappings: '' } };
      },
    },
    async renderChunk(_, chunk) {
      let css = '';
      for (const id of chunk.moduleIds) css += styles.get(id) ?? '';
      if (!css) return null;

      const ctx = holder.get();
      const target = chunk.isEntry ? styleFileName(`${chunk.name}.css`) : undefined;
      const cssDir = target ? path.posix.dirname(target) : 'chunks';
      css = css.replace(ASSET_URL_RE, (_, ref: string) => {
        const file = this.getFileName(ref);
        chunk.viteMetadata?.importedAssets.add(file);
        return cssUrl(file, cssDir, config.base);
      });
      css = await finalizeCss(css, this.environment.config.build, config.css.lightningcss, (m) => this.warn(m));

      const ref = this.emitFile(
        target ? { type: 'asset', fileName: target, source: css } : { type: 'asset', name: `style-${chunk.name}.css`, source: css },
      );
      const fileName = this.getFileName(ref);
      ctx.styleFiles.add(fileName);
      chunk.viteMetadata?.importedCss.add(fileName);
      return null;
    },
  };
}

// Runs after vite:css-post: drops CSS files left empty by the split and the hash marker Vite
// forgets to strip from non-code-split bundles.
export function cssOutputPlugin(): Plugin {
  return {
    name: 'wp-vite:css-output',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const removed = new Set<string>();
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css') || typeof asset.source !== 'string') continue;
        asset.source = asset.source.replace(VITE_HASH_MARKER_RE, '');
        if (asset.source.trim()) continue;
        delete bundle[asset.fileName];
        removed.add(asset.fileName);
      }
      if (removed.size === 0) return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const file of removed) chunk.viteMetadata?.importedCss.delete(file);
      }
    },
  };
}

function cssUrl(file: string, cssDir: string, base: string): string {
  if (base !== '' && base !== './') return encodeURI(base.endsWith('/') ? base + file : `${base}/${file}`);
  const relative = path.posix.relative(cssDir, file);
  return encodeURI(relative.startsWith('.') ? relative : `./${relative}`);
}
