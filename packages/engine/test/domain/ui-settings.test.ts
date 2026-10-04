import { describe, expect, it } from 'vitest';
import { decodeUiSettings } from '../../src/domain/ui-settings.ts';

describe('decodeUiSettings: material panel', () => {
  it('keeps a valid width and the collapse flag', () => {
    expect(
      decodeUiSettings({ materialWidth: 420, materialCollapsed: true }),
    ).toEqual({
      theme: 'system',
      locale: 'system',
      materialWidth: 420,
      materialCollapsed: true,
    });
  });

  it.each([
    { materialWidth: 279 },
    { materialWidth: 801 },
    { materialWidth: 400.5 },
    { materialWidth: '400' },
    { materialCollapsed: false },
    { materialCollapsed: 'true' },
  ])('reads %j as "no field" instead of failing', (raw) => {
    expect(decodeUiSettings(raw)).toEqual({
      theme: 'system',
      locale: 'system',
    });
  });
});
