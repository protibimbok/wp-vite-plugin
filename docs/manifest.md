# Build output and manifests

Everything below lands in `outDir` (default `build/`). Paths are POSIX and relative to `outDir`
unless stated otherwise.

## Files

| File | Source |
|---|---|
| `<entry>.js` | One per entry. `<entry>` is the source path relative to `srcDir` without extension (`blocks/basic/index`, `admin/index`). IIFE for block.json `editorScript`/`script`/`viewScript`, ESM otherwise. |
| `<entry>.asset.php` | wp-scripts compatible `array('dependencies' => ..., 'version' => ...)`; ESM entries add `'type' => 'module'` and list module ids as `array('id' => ..., 'import' => 'static'|'dynamic')`. |
| `<entry>.css`, `style-<base>.css` | Non-`style.*` CSS imported by the entry, and CSS from `style(.module).*` sources. Shared-chunk CSS goes to `chunks/`. |
| `*-rtl.css` | `rtlcss` output for every CSS file, unless `rtl: false`. |
| `chunks/<name>-<hash>.js` | Shared or dynamically imported chunks of ESM entries. |
| `images/`, `fonts/`, `assets/` | Hashed static assets. |
| `<block dir>/block.json` | Copied from `srcDir`; see below. |
| `<block dir>/render.php`, `variations.php` | PHP files referenced by `file:` in `render` / `variations`. With `copyPhp: true` every `**/*.php` under `srcDir` is copied instead. |
| `blocks-manifest.php` | All built `block.json` files keyed by block directory name (`blocksManifest`, default on). |
| `wp-vite.php`, `wp-vite.json` | The build manifest below (`manifest.php`, `manifest.json`, default both on). |

### Copied `block.json`

Script fields (`editorScript`, `script`, `viewScript`, `viewScriptModule`) that use `file:` are
rewritten to the built `.js` (`file:./index.tsx` becomes `file:./index.js`; a missing extension is
added). Because the output tree mirrors `srcDir`, the relative path stays valid even when it points
outside the block directory. Style fields are not touched: like wp-scripts, they must already name
the built file (`file:./style-index.css`). Everything else is copied verbatim.

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
