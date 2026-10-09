# Spike findings: Vite 8.3.3 / Rolldown 1.2.13 (2026-10-09)

Verified with a throwaway project (`@vitejs/plugin-react` 6.1.2, `sass-embedded` 1.105, `terser` 5.51).

| Check | Result |
|---|---|
| `builder: {}` makes plain `vite build` build every environment | Yes. `client` builds first, then the custom environments. |
| Environment names | Must match `[A-Za-z0-9$_]`. `wp-iife:block` is rejected; use `wpIife_<slug>`. |
| Top-level `build.rolldownOptions.input` | Merges into every environment. With `codeSplitting:false` the IIFE env then fails with "multiple inputs are not supported". The ESM input must be set in `environments.client.build.rolldownOptions.input`; each IIFE env sets its own single input. |
| IIFE environment (`format:'iife'`, `codeSplitting:false`, `consumer:'client'`) | Emits JS. With `cssCodeSplit:true` CSS is injected into the JS as a `<style>` tag. With `cssCodeSplit:false` a single CSS asset is emitted (named `style.css` by `[name]`), so IIFE envs need `cssCodeSplit:false` and a per-env `assetFileNames` function. The emitted CSS keeps a trailing `/*$vite$:1*/` marker that we must strip. |
| `chunk.moduleIds` in `generateBundle` | Present for both formats, includes CSS/SCSS module ids. |
| `chunk.viteMetadata.importedCss` | Populated for ESM entries (`index.css`). Empty for IIFE with `cssCodeSplit:false`; read the CSS asset from the bundle instead. |
| `parseAst` exported from `vite` | Yes (function). |
| `/*! ... */` in CSS | Survives lightningcss minification. |
| Translator comments in JS | Rolldown codegen drops plain `/* */` comments. `/** translators: */` (JSDoc) survives with `minify:false`. The oxc minifier drops it even with `output.comments:{jsdoc:true,legal:true}`. `minify:'terser'` with `output.comments:{jsdoc:true}` (so Rolldown hands the comment to terser) and `terserOptions.format.comments:/translators:/i` keeps it. Default must be terser; pre-transform `/* translators:` to `/** translators:`. |
| Rolldown-native `external` + `output.globals` | Produces `(0, t.__)("x")` calls. `wp i18n make-pot` resolves `(0, u.__)` and member expressions, so make-pot works either way, but our own rewrite is still needed for dev mode and dependency recording. |
| Rolldown mangle reserved names | `MinifyOptions.mangle` exists; not relied upon because terser is the default and the rewrite emits member expressions (`window.wp.i18n.__`) that cannot be mangled. |
| `optimizeDeps.exclude` | Excluded ids stay as bare imports inside pre-bundled deps and are then routed through our `resolveId` (`/@id/__x00__wp-vite:external:react`). |
| `resolveId` returning an `http://` id with `external:true` in dev | Left untouched by import analysis: `import { store } from "http://127.0.0.1:5173/@wp-vite/wp-module/@wordpress/interactivity"`. |
| `wp i18n make-pot` comment rules | Comment must end on the call's line or the line above; same-line comments must start before the call. Callee resolution accepts identifiers, member expressions, `Object(u.__)` and `(0, u.__)`. |
