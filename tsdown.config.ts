import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // One config so the CLI shares the plugin's chunks (and so its WPViteError class) with index.js.
    entry: { index: 'src/index.ts', 'cli/index': 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: { neverBundle: ['vite'] },
  },
  {
    entry: { 'client/index': 'src/client/index.ts' },
    format: 'esm',
    platform: 'browser',
    fixedExtension: false,
    dts: true,
    clean: false,
  },
]);
