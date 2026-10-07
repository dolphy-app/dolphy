import { describe, expect, it } from 'vitest';
import { DEFAULT_CLIENT, DEFAULT_MAIN } from '../src/index.ts';

describe('default paths', () => {
  it('match the extension directory convention', () => {
    expect(DEFAULT_MAIN).toBe('./main.mjs');
    expect(DEFAULT_CLIENT).toBe('./client.mjs');
  });
});
