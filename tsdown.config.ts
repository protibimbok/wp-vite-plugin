import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: { neverBundle: ['vite'] },
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    dts: false,
    clean: false,
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
