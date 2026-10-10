# Build output and manifests

Everything below lands in `outDir` (default `build/`). Paths are POSIX and relative to `outDir`
unless stated otherwise.

## Files

| File | Source |
|---|---|
| `<entry>.js` | One per entry. `<entry>` is the source path relative to `srcDir` without extension (`blocks/basic/index`, `admin/index`). IIFE for block.json `editorScript`/`script`/`viewScript`, ESM otherwise. |
| `<entry>.asset.php` | wp-scripts compatible `array('dependencies' => ..., 'version' => ...)`; ESM entries add `'type' => 'module'` and list module ids as `array('id' => ..., 'import' => 'static'|'dynamic')`. |
| `<entry>.css`, `style-<base>.css` | Non-`style.*` CSS imported by a script entry, and CSS from `style(.module).*` sources. Shared-chunk CSS goes to `chunks/`. |
| `<block dir>/<name>.css` | One per block.json style field: the stylesheet source compiled on its own (`style.scss` becomes `style.css`). |
| `*-rtl.css` | `rtlcss` output for every CSS file, unless `rtl: false`. |
| `chunks/<name>-<hash>.js` | Shared or dynamically imported chunks of ESM entries. |
| `images/`, `fonts/`, `assets/` | Hashed static assets. |
| `<block dir>/block.json` | Copied from `srcDir`; see below. |
| `<block dir>/render.php`, `variations.php` | PHP files referenced by `file:` in `render` / `variations`. With `copyPhp: true` every `**/*.php` under `srcDir` is copied instead. |
| `blocks-manifest.php` | All built `block.json` files keyed by block directory name (`blocksManifest`, default on). |
| `wp-vite.php`, `wp-vite.json` | The build manifest below (`manifest.php`, `manifest.json`, default both on). |

### Copied `block.json`

`file:` values in the source `block.json` name source files, and the copy names what they were
built into:

- Script fields (`editorScript`, `script`, `viewScript`, `viewScriptModule`) become the built `.js`
  (`file:./index.tsx` becomes `file:./index.js`; a missing extension is added). Because the output
  tree mirrors `srcDir`, the relative path stays valid even when it points outside the block
  directory.
- Style fields (`editorStyle`, `style`, `viewStyle`) name a stylesheet source (`file:./style.scss`,
  `file:./editor.scss`). Each one is built as its own stylesheet entry through Vite's CSS pipeline
  (Sass, PostCSS, lightningcss, asset URLs, RTL) and the field becomes the built file
  (`file:./style.css`, `file:./editor.css`). Do not also import the file from the block's script:
  that ships the CSS twice and the build warns. Stylesheet entries have no `asset.php` (WordPress
  versions block styles by file modification time) and are not listed in `wp-vite.php`.
- Everything else (`render`, `variations`, handles, metadata) is copied verbatim.

### `blocks-manifest.php`

```php
<?php
// This file is generated. Do not modify it manually.
return array(
	'basic' => array( /* built block.json */ ),
);
```

Keys are block directory basenames, which is how `WP_Block_Metadata_Registry` looks blocks up, so
two blocks in directories with the same name are a build error (rename one or set
`blocksManifest: false`). When every block sits directly under one directory (`blocksRoot` below),
register them all with:

```php
wp_register_block_types_from_metadata_collection( __DIR__ . '/build/blocks', __DIR__ . '/build/blocks-manifest.php' );
```

Otherwise call `register_block_type( __DIR__ . '/build/<dir>' )` per block.

## Build manifest (`wp-vite.php` / `wp-vite.json`)

Both files hold the same data; the PHP one returns it as nested `array()`s (an empty map and an
empty list are both `array()`).

```ts
interface WPViteManifest {
  version: 1;
  rtl: boolean;                       // whether *-rtl.css files exist
  entries: Record<string, ManifestEntry>;
  chunks: Record<string, ManifestChunk>;
  blocks: Array<{ name: string; dir: string }>;   // block name and directory, in discovery order
  blocksRoot: string | null;          // common parent of all block dirs ('' = outDir), null if depths differ
}

interface ManifestEntry {
  file: string;                       // 'admin/index.js'
  format: 'es' | 'iife';
  src: string;                        // source file relative to the Vite root
  sources: Array<{ block: string; field: string }>;  // block.json fields that reference this entry
  scripts: string[];                  // classic script handles (wp-i18n, react-jsx-runtime, ...)
  modules: string[];                  // script module ids imported statically
  dynamicModules: string[];           // script module ids only imported dynamically
  imports: string[];                  // chunk files in the static import closure
  dynamicImports: string[];           // chunk files reached only through dynamic imports
  css: string[];                      // editor/non-style CSS of the entry and its static chunks
  styleCss: string[];                 // style-*.css of the entry and its static chunks
  version: string;                    // sha1 of code + css, 20 hex chars; same as the asset.php version
}

interface ManifestChunk {             // direct dependencies of one shared chunk
  file: string;
  scripts: string[];
  modules: string[];
  dynamicModules: string[];
  imports: string[];
  dynamicImports: string[];
  css: string[];
  version: string;
}
```

`scripts` lists classic handles for ESM entries too. WordPress cannot attach classic scripts to a
script module, so they never appear in the `.asset.php` of an ESM entry; the PHP package enqueues
them from the manifest instead. Entries referenced by a block `viewScriptModule` fail the build
when they have classic deps (`moduleClassicDeps: 'error'`).

## Hot file (`build/.wp-vite/hot.json`)

Written once the dev server is listening *and* the dependency crawl has finished (so WordPress never
sees a dev-mode entry without its deps), removed when the server closes (including SIGINT/SIGTERM/
SIGHUP). Its presence is what switches the PHP package to dev mode. `hot: false` disables it.

```jsonc
{
  "origin": "http://localhost:5173",       // dev server origin, no trailing slash
  "srcDir": "src",                         // relative to the Vite root (the plugin directory)
  "refresh": false,                        // true when a `vite:react-refresh` plugin is active
  "entries": {
    "blocks/basic/index": {
      "url": "http://localhost:5173/src/blocks/basic/index.tsx",
      "src": "src/blocks/basic/index.tsx",
      "format": "iife",                    // 'es' | 'iife' | 'css'; everything is served as ESM in dev
      "scripts": ["react-jsx-runtime", "wp-blocks", "wp-i18n"],  // classic handles, whole module graph
      "modules": ["@wordpress/a11y"],      // script module ids, static and dynamic imports alike
      "styles": ["http://localhost:5173/src/blocks/basic/editor.scss"]  // stylesheets imported by scripts
    }
  },
  "blocks": [{ "name": "fixture/basic", "dir": "src/blocks/basic" }]
}
```

- `scripts`/`modules` are the union over every module reachable from the entry (static and dynamic
  imports, pre-bundled deps included). Dynamic module imports are not marked: WordPress registers all
  of them as static deps in dev, which costs a `modulepreload` at most.
- `styles` lists the dev URLs of stylesheets imported from scripts (`?inline`/`?url`/`?raw` excluded).
  Vite's CSS modules inject their `<style>` tags themselves, so these are informational, e.g. for
  mirroring styles into the block editor canvas iframe. Stylesheet entries (`format: 'css'`) have
  empty deps; their `url` is served as CSS directly and can be enqueued as a `<link>`.
- On `hotUpdate` the crawl runs again. When any entry's deps (or the entry list, after a `block.json`
  change re-runs discovery) differ, the hot file is rewritten and a `full-reload` is sent instead of
  Vite's module update; otherwise Vite's update goes through untouched. A module that fails to
  transform keeps its entry's previous deps.

Dev-only URLs on the dev server origin:

- `/@wp-vite/react-refresh-preamble`: the React Fast Refresh preamble as a module (empty without
  `vite:react-refresh`); when refresh is active every script entry imports it first.
- `/@wp-vite/wp-module/<id>`: `export * from "<id>"`, served outside Vite's transform pipeline so the
  bare id resolves through WordPress's import map. Imports of module externals are rewritten to it.
- `/@wp-vite/jsx-dev-runtime`: `jsxDEV` shim over `ReactJSXRuntime` (dev JSX uses `react/jsx-dev-runtime`).
