export type PhpValue = string | number | boolean | null | undefined | PhpValue[] | { [key: string]: PhpValue };

export function toPhp(value: PhpValue): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot serialise ${value} to PHP`);
    return String(value);
  }
  if (typeof value === 'string') return phpString(value);
  if (Array.isArray(value)) return `array(${value.map(toPhp).join(', ')})`;
  const pairs = Object.entries(value).map(([key, item]) => `${phpString(key)} => ${toPhp(item)}`);
  return `array(${pairs.join(', ')})`;
}

export function phpFile(value: PhpValue): string {
  return `<?php return ${toPhp(value)};\n`;
}

function phpString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
