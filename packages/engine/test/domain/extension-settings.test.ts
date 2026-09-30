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
      checkUpdates: true,
    });
  });

  it.each([
    [{ disabled: [], trusted: [] }, true],
    [{ disabled: [], trusted: [], checkUpdates: false }, false],
    [{ disabled: [], trusted: [], checkUpdates: 'no' }, true],
    [{ disabled: [], trusted: [], checkUpdates: 0 }, true],
    [{ disabled: 1, trusted: [], checkUpdates: false }, false],
  ])('checkUpdates в %j — %s', (raw, expected) => {
    expect(decodeExtensionSettings(raw).checkUpdates).toBe(expected);
  });

  it('сортирует и убирает повторы', () => {
    expect(
      decodeExtensionSettings({
        disabled: ['b.x', 'a.y', 'b.x'],
        trusted: ['c.z'],
        extra: 1,
      }),
    ).toEqual({
      disabled: ['a.y', 'b.x'],
      trusted: ['c.z'],
      checkUpdates: true,
    });
  });
});
