import { describe, expect, it } from 'vitest';
import { phpFile, toPhp } from '../src/php/serialize.js';

describe('toPhp', () => {
  it('serialises scalars', () => {
    expect(toPhp(null)).toBe('null');
    expect(toPhp(undefined)).toBe('null');
    expect(toPhp(true)).toBe('true');
    expect(toPhp(12)).toBe('12');
    expect(toPhp("it's \\ here")).toBe("'it\\'s \\\\ here'");
  });

  it('serialises lists and maps as array()', () => {
    expect(toPhp([])).toBe('array()');
    expect(toPhp(['a', 1])).toBe("array('a', 1)");
    expect(toPhp({ dependencies: ['wp-blocks'], version: 'abc', nested: { ok: false } })).toBe(
      "array('dependencies' => array('wp-blocks'), 'version' => 'abc', 'nested' => array('ok' => false))",
    );
  });

  it('rejects non-finite numbers', () => {
    expect(() => toPhp(Number.NaN)).toThrow(TypeError);
  });

  it('wraps a value in a returning PHP file', () => {
    expect(phpFile({ version: '1' })).toBe("<?php return array('version' => '1');\n");
  });

  it('pretty prints with tabs and trailing commas', () => {
    expect(toPhp({ a: [1, { b: [] }], c: 'x' }, true)).toBe("array(\n\t'a' => array(\n\t\t1,\n\t\tarray(\n\t\t\t'b' => array(),\n\t\t),\n\t),\n\t'c' => 'x',\n)");
    expect(phpFile([], true)).toBe('<?php\n// This file is generated. Do not modify it manually.\nreturn array();\n');
  });
});
