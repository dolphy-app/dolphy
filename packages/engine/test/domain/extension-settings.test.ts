import { describe, expect, it } from 'vitest';
import { decodeExtensionSettings } from '../../src/domain/extension-settings.ts';

describe('decodeExtensionSettings', () => {
  it.each([
    [null],
    [undefined],
    ['x'],
    [{}],
    [{ disabled: ['a.b'] }],
    [{ disabled: 'a.b', trusted: [] }],
    [{ disabled: [1], trusted: [] }],
    [{ disabled: [], trusted: ['Not An Id'] }],
  ])('неверная форма %j — пустые списки', (raw) => {
    expect(decodeExtensionSettings(raw)).toEqual({
      disabled: [],
      trusted: [],
    });
  });

  it('сортирует и убирает повторы', () => {
    expect(
      decodeExtensionSettings({
        disabled: ['b.x', 'a.y', 'b.x'],
        trusted: ['c.z'],
        extra: 1,
      }),
    ).toEqual({ disabled: ['a.y', 'b.x'], trusted: ['c.z'] });
  });
});
