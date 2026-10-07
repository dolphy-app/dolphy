import { describe, expect, it } from 'vitest';
import { ANCHOR_ATTRIBUTE, anchorSelector } from '../src/index.ts';

describe('anchorSelector', () => {
  it('selects the element the app marks with the anchor attribute', () => {
    expect(anchorSelector('dailyPlan')).toBe(
      `[${ANCHOR_ATTRIBUTE}="dailyPlan"]`,
    );
  });

  it('escapes quotes and backslashes so an id cannot leave the attribute value', () => {
    expect(anchorSelector('a"]b\\c')).toBe('[data-ext-anchor="a\\"]b\\\\c"]');
  });
});
