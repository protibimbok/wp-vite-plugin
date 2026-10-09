export const WORDPRESS_NAMESPACE = '@wordpress/';

export const BUNDLED_PACKAGES = [
  '@wordpress/admin-ui',
  '@wordpress/dataviews',
  '@wordpress/dataviews/wp',
  '@wordpress/fields',
  '@wordpress/global-styles-engine',
  '@wordpress/global-styles-ui',
  '@wordpress/grid',
  '@wordpress/icons',
  '@wordpress/interface',
  '@wordpress/kebab-case',
  '@wordpress/react-inert-value',
  '@wordpress/style-runtime',
  '@wordpress/sync',
  '@wordpress/ui',
  '@wordpress/undo-manager',
  '@wordpress/views',
];

export const STATIC_ONLY_MODULES = ['@wordpress/interactivity'];
export const MODULE_ONLY = ['@wordpress/interactivity', '@wordpress/interactivity-router'];
export const DEFAULT_MODULES = ['@wordpress/interactivity', '@wordpress/interactivity-router', '@wordpress/a11y'];

const GLOBALS: Record<string, string[]> = {
  moment: ['moment'],
  '@babel/runtime/regenerator': ['regeneratorRuntime'],
  lodash: ['lodash'],
  'lodash-es': ['lodash'],
  jquery: ['jQuery'],
  react: ['React'],
  'react-dom': ['ReactDOM'],
  'react-dom/client': ['ReactDOM'],
  'react/jsx-runtime': ['ReactJSXRuntime'],
  'react/jsx-dev-runtime': ['ReactJSXRuntime'],
};

const HANDLES: Record<string, string> = {
  '@babel/runtime/regenerator': 'regenerator-runtime',
  'lodash-es': 'lodash',
  'react-dom/client': 'react-dom',
  'react/jsx-runtime': 'react-jsx-runtime',
  'react/jsx-dev-runtime': 'react-jsx-runtime',
};

export function camelCaseDash(input: string): string {
  return input.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function defaultRequestToExternal(request: string): string[] | undefined {
  if (GLOBALS[request]) return GLOBALS[request];
  if (request.includes('react-refresh/runtime')) return ['ReactRefreshRuntime'];
  if (BUNDLED_PACKAGES.includes(request)) return undefined;
  if (request.startsWith(WORDPRESS_NAMESPACE)) {
    return ['wp', camelCaseDash(request.slice(WORDPRESS_NAMESPACE.length))];
  }
  return undefined;
}

export function defaultRequestToHandle(request: string): string {
  if (HANDLES[request]) return HANDLES[request];
  if (request.includes('react-refresh/runtime')) return 'wp-react-refresh-runtime';
  if (request.startsWith(WORDPRESS_NAMESPACE)) return 'wp-' + request.slice(WORDPRESS_NAMESPACE.length);
  return request;
}
