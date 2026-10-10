import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResolvedConfig } from 'vite';

export const WP_MODULE_PREFIX = '/@wp-vite/wp-module/';

const MODULE_ID_RE = /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/;

export function wpModuleShim(id: string): string {
  return `export * from ${JSON.stringify(id)};\n`;
}

// Serves `/@wp-vite/wp-module/<id>` as a module that re-exports the bare id, which the browser
// resolves through WordPress's import map. The response bypasses Vite's transform pipeline (import
// analysis would try to resolve the bare id), so it is registered ahead of Vite's middlewares and
// carries its own CORS header.
export function wpModuleMiddleware(config: ResolvedConfig) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = req.url ?? '';
    if (!url.startsWith(WP_MODULE_PREFIX)) return next();
    const id = decodeURIComponent(url.slice(WP_MODULE_PREFIX.length).split('?')[0]!);
    if (!MODULE_ID_RE.test(id)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const origin = allowedOrigin(config.server.cors, req.headers.origin);
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (origin !== '*') res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(wpModuleShim(id));
  };
}

function allowedOrigin(cors: ResolvedConfig['server']['cors'], requestOrigin: string | undefined): string | undefined {
  if (cors === false) return undefined;
  const allowed = cors === true ? '*' : (cors.origin ?? '*');
  if (allowed === true || allowed === '*') return '*';
  if (!requestOrigin || allowed === false) return undefined;
  const matches = (rule: string | RegExp | boolean) =>
    rule === true || (typeof rule === 'string' ? rule === requestOrigin : rule instanceof RegExp && rule.test(requestOrigin));
  if (typeof allowed === 'function') return undefined;
  const rules = Array.isArray(allowed) ? allowed : [allowed];
  return rules.some(matches) ? requestOrigin : undefined;
}
