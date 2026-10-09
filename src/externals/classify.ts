import fs from 'node:fs';
import path from 'node:path';
import type { EntryFormat, ExternalsOptions } from '../options.js';
import { WPViteError } from '../errors.js';
import {
  BUNDLED_PACKAGES,
  DEFAULT_MODULES,
  MODULE_ONLY,
  STATIC_ONLY_MODULES,
  WORDPRESS_NAMESPACE,
  defaultRequestToExternal,
  defaultRequestToHandle,
} from './table.js';

export type Classification =
  | { kind: 'global'; request: string; global: string[]; handle: string }
  | { kind: 'module'; request: string; id: string; staticOnly: boolean }
  | { kind: 'bundle'; request: string };

export type Classify = (request: string, format: EntryFormat) => Classification;

interface PackageInfo {
  script: boolean;
  module: boolean;
}

export function createClassifier(options: ExternalsOptions, root: string): Classify {
  const cache = new Map<string, Classification>();
  const packages = new Map<string, PackageInfo | null>();
  const bundled = new Set([...BUNDLED_PACKAGES, ...(options.bundled ?? [])]);

  const toHandle = (request: string) => options.requestToHandle?.(request) ?? defaultRequestToHandle(request);

  const global = (request: string, global: string[]): Classification => ({
    kind: 'global',
    request,
    global,
    handle: toHandle(request),
  });

  const module = (request: string, id = request): Classification => ({
    kind: 'module',
    request,
    id,
    staticOnly: STATIC_ONLY_MODULES.includes(id),
  });

  const bundle = (request: string): Classification => ({ kind: 'bundle', request });

  const packageInfo = (request: string): PackageInfo | null => {
    const name = packageName(request);
    if (!name) return null;
    let info = packages.get(name);
    if (info === undefined) {
      info = readPackageInfo(root, name, request);
      packages.set(name, info);
    }
    return info;
  };

  const resolve = (request: string, format: EntryFormat): Classification => {
    if (isRelativeOrAbsolute(request) || path.extname(request) !== '') return bundle(request);

    const userModule = options.requestToExternalModule?.(request);
    if (userModule === false) return bundle(request);
    if (typeof userModule === 'string' && format === 'es') return module(request, userModule);

    const userGlobal = options.requestToExternal?.(request);
    if (userGlobal === false) return bundle(request);
    if (userGlobal !== undefined) return global(request, toGlobalPath(userGlobal));

    if (bundled.has(request)) return bundle(request);

    const info = packageInfo(request);
    const isModule = DEFAULT_MODULES.includes(request) || info?.module === true;
    if (isModule) {
      if (format === 'es') return module(request);
      const alsoScript = info ? info.script : !MODULE_ONLY.includes(request);
      if (!alsoScript) {
        throw new WPViteError(`${request} is a script module and cannot be imported from a classic script`);
      }
    }

    const defaults = defaultRequestToExternal(request);
    if (defaults) return global(request, defaults);
    return bundle(request);
  };

  return (request, format) => {
    const key = `${format}:${request}`;
    let result = cache.get(key);
    if (!result) {
      result = resolve(request, format);
      cache.set(key, result);
    }
    return result;
  };
}

function toGlobalPath(value: string | string[]): string[] {
  return Array.isArray(value) ? value : value.split('.');
}

function isRelativeOrAbsolute(request: string): boolean {
  return request.startsWith('.') || request.startsWith('/') || request.startsWith('\0') || /^[a-z]+:/i.test(request);
}

function packageName(request: string): string | undefined {
  if (!request.startsWith(WORDPRESS_NAMESPACE)) return undefined;
  const [scope, name] = request.split('/');
  return name ? `${scope}/${name}` : undefined;
}

function readPackageInfo(root: string, name: string, request: string): PackageInfo | null {
  const file = path.join(root, 'node_modules', name, 'package.json');
  let json: { wpScript?: unknown; wpScriptModuleExports?: Record<string, unknown> };
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const subpath = '.' + request.slice(name.length);
  const exports = json.wpScriptModuleExports;
  return {
    script: json.wpScript === true,
    module: typeof exports === 'object' && exports !== null && subpath in exports,
  };
}
