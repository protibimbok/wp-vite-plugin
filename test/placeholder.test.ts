import { describe, expect, it } from 'vitest';
import { wpVite } from '../src/index.js';

describe('wpVite', () => {
  it('returns a plugin array', () => {
    expect(Array.isArray(wpVite())).toBe(true);
  });
});
