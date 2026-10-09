import path from 'node:path';

export const SCRIPT_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.mts'];

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function stripScriptExtension(p: string): string {
  const ext = path.extname(p);
  return SCRIPT_EXTENSIONS.includes(ext) ? p.slice(0, -ext.length) : p;
}

export function entryNameFor(file: string, srcDir: string): string {
  return toPosix(stripScriptExtension(path.relative(srcDir, file)));
}

export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
