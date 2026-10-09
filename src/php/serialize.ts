export type PhpValue = string | number | boolean | null | undefined | PhpValue[] | { [key: string]: PhpValue };

export function toPhp(value: PhpValue, pretty = false): string {
  return serialize(value, pretty ? 0 : -1);
}

export function phpFile(value: PhpValue, pretty = false): string {
  if (!pretty) return `<?php return ${toPhp(value)};\n`;
  return `<?php\n// This file is generated. Do not modify it manually.\nreturn ${toPhp(value, true)};\n`;
}

// depth < 0 means single-line output.
function serialize(value: PhpValue, depth: number): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot serialise ${value} to PHP`);
    return String(value);
  }
  if (typeof value === 'string') return phpString(value);
  const next = depth < 0 ? -1 : depth + 1;
  if (Array.isArray(value)) return list(value.map((item) => serialize(item, next)), depth);
  const pairs = Object.entries(value).map(([key, item]) => `${phpString(key)} => ${serialize(item, next)}`);
  return list(pairs, depth);
}

function list(items: string[], depth: number): string {
  if (items.length === 0) return 'array()';
  if (depth < 0) return `array(${items.join(', ')})`;
  const inner = '\t'.repeat(depth + 1);
  return `array(\n${items.map((item) => `${inner}${item},\n`).join('')}${'\t'.repeat(depth)})`;
}

function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
