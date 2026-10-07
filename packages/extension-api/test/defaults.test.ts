import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIN, DEFAULT_RENDERER } from '../src/index.ts';

describe('default paths', () => {
  it('match the extension directory convention', () => {
    expect(DEFAULT_MAIN).toBe('./main.mjs');
    expect(DEFAULT_RENDERER).toBe('./view.mjs');
  });
});
