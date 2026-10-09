import type { Plugin } from 'vite';

/** Options for the wp-vite plugin. Filled in during later steps. */
export interface WpViteOptions {}

/** Vite plugin for WordPress plugin development. Returns an ordered set of sub-plugins. */
export function wpVite(_options: WpViteOptions = {}): Plugin[] {
  return [];
}
