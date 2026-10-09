import type { BuildEnvironmentOptions, LightningCSSOptions } from 'vite';

type Targets = NonNullable<LightningCSSOptions['targets']>;

const AT_IMPORT_RE = /@import(?:\s*(?:url\([^)]*\)|"(?:[^"]|(?<=\\)")*"|'(?:[^']|(?<=\\)')*').*?|[^;]*);/g;
const AT_CHARSET_RE = /@charset(?:\s*(?:"(?:[^"]|(?<=\\)")*"|'(?:[^']|(?<=\\)')*').*?|[^;]*);/g;

const BROWSERS: Record<string, keyof Targets | false> = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  ie: 'ie',
  ios: 'ios_saf',
  opera: 'opera',
  safari: 'safari',
  hermes: false,
  node: false,
  rhino: false,
};

// Mirrors Vite's finalizeCss for CSS that bypasses vite:css-post. Only lightningcss is supported:
// Vite 8 no longer depends on esbuild, so `cssMinify: 'esbuild'` is treated as lightningcss.
export async function finalizeCss(
  css: string,
  build: BuildEnvironmentOptions,
  lightningcss: LightningCSSOptions | undefined,
  warn: (message: string) => void,
): Promise<string> {
  if (css.includes('@import') || css.includes('@charset')) css = hoistAtRules(css);
  if (!build.cssMinify) return css;
  const { transform } = await import('lightningcss');
  const { cssModules: _modules, visitor: _visitor, customAtRules: _atRules, targets: _targets, ...options } = lightningcss ?? {};
  const targets = convertTargets(build.cssTarget);
  const { code, warnings } = transform({
    ...options,
    ...(targets && { targets }),
    filename: 'style.css',
    code: Buffer.from(css),
    minify: true,
  });
  for (const warning of warnings) warn(`[lightningcss minify] ${warning.message}`);
  return `${new TextDecoder().decode(code)}\n`;
}

export function hoistAtRules(css: string): string {
  const imports: string[] = [];
  let charset: string | undefined;
  css = css.replace(AT_IMPORT_RE, (m) => (imports.push(m), ''));
  css = css.replace(AT_CHARSET_RE, (m) => ((charset ??= m), ''));
  return (charset ?? '') + imports.join('') + css;
}

// Esbuild-style targets ("chrome111", "safari16.4", "es2020") to lightningcss' packed versions.
export function convertTargets(target: BuildEnvironmentOptions['cssTarget']): Targets | undefined {
  if (!target) return undefined;
  const targets: Record<string, number> = {};
  for (const entry of ([] as string[]).concat(target)) {
    const index = entry.search(/\d/);
    if (index < 0 || /^es(?:6|\d{4})$/.test(entry)) continue;
    const browser = BROWSERS[entry.slice(0, index)];
    if (!browser) continue;
    const [major = NaN, minor = 0] = entry.slice(index).split('.').map((v) => parseInt(v, 10));
    if (Number.isNaN(major) || Number.isNaN(minor)) continue;
    const version = (major << 16) | (minor << 8);
    if (!(browser in targets) || version < targets[browser]!) targets[browser] = version;
  }
  return Object.keys(targets).length ? (targets as Targets) : undefined;
}
