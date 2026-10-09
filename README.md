# wp-vite-plugin

Vite plugin and `wp-vite` CLI for WordPress plugin development: everything `wp-scripts build/start` does (block.json discovery, `*.asset.php`, `wp.*` externals, `style-index.css` split, copied PHP, blocks manifest) plus Vite's dev server with React Fast Refresh.

Pairs with the `protibimbok/wp-vite` Composer package, which enqueues the output through WordPress's Script Modules API.

See `docs/` for design notes.
