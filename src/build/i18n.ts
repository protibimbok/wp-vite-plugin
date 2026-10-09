import type { Plugin } from 'vite';

export const I18N_FUNCTIONS = ['__', '_n', '_nx', '_x'];

const SCRIPT_RE = /\.(?:m|c)?[jt]sx?$/;
const BLOCK_COMMENT_RE = /\/\*(?!\*)\s*(translators:)/gi;
const LINE_COMMENT_RE = /\/\/[ \t]*(translators:[^\r\n]*)/gi;

export function promoteTranslatorComments(code: string): string | null {
  if (!/translators:/i.test(code)) return null;
  const next = code.replace(BLOCK_COMMENT_RE, '/** $1').replace(LINE_COMMENT_RE, (_, text: string) => `/** ${text.trim()} */`);
  return next === code ? null : next;
}

export function terserOptions(): Record<string, unknown> {
  return {
    mangle: { reserved: I18N_FUNCTIONS },
    compress: { reduce_vars: false, inline: false, collapse_vars: false, join_vars: false, sequences: false },
    format: { comments: /translators:/i },
  };
}

export function i18nPlugin(): Plugin {
  return {
    name: 'wp-vite:i18n',
    enforce: 'pre',
    transform: {
      filter: { code: /translators:/i },
      handler(code, id) {
        if (id.startsWith('\0') || id.includes('/node_modules/') || !SCRIPT_RE.test(id.split('?')[0]!)) return null;
        const next = promoteTranslatorComments(code);
        return next === null ? null : { code: next, map: null };
      },
    },
  };
}
