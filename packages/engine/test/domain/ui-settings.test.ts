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

describe('decodeUiSettings: tours', () => {
  it('keeps valid outcomes', () => {
    expect(
      decodeUiSettings({ tours: { welcome: 'completed', session: 'skipped' } }),
    ).toEqual({
      theme: 'system',
      locale: 'system',
      tours: { welcome: 'completed', session: 'skipped' },
    });
  });

  it('drops a bad key or value without touching the rest', () => {
    expect(
      decodeUiSettings({
        tours: { welcome: 'completed', 'Bad Id': 'skipped', other: 'done' },
      }),
    ).toMatchObject({ tours: { welcome: 'completed' } });
  });

  it.each([
    { tours: {} },
    { tours: [] },
    { tours: 'welcome' },
    { tours: null },
  ])('reads %j as "no field"', (raw) => {
    expect(decodeUiSettings(raw)).toEqual({
      theme: 'system',
      locale: 'system',
    });
  });
});
