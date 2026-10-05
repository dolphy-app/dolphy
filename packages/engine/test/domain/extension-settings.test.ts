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
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
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

  it.each([
    [{ disabled: [], trusted: [] }, false],
    [{ disabled: [], trusted: [], safeMode: true }, true],
    [{ disabled: [], trusted: [], safeMode: false }, false],
    [{ disabled: [], trusted: [], safeMode: 'yes' }, false],
    [{ disabled: [], trusted: [], safeMode: 1 }, false],
    // безопасный режим не теряется из-за испорченных списков: запуск остаётся безопасным
    [{ disabled: 1, trusted: [], safeMode: true }, true],
  ])('safeMode в %j — %s: включает только явное true', (raw, expected) => {
    expect(decodeExtensionSettings(raw).safeMode).toBe(expected);
  });

  it('notificationsOff: нет значения — пусто (запись до появления поля), список сохраняется даже рядом с испорченным списком', () => {
    expect(
      decodeExtensionSettings({ disabled: [], trusted: [] }).notificationsOff,
    ).toEqual([]);
    expect(
      decodeExtensionSettings({
        disabled: [],
        trusted: [],
        notificationsOff: ['b.x', 'a.y', 'b.x'],
        catalogUrl: null,
      }).notificationsOff,
    ).toEqual(['a.y', 'b.x']);
    expect(
      decodeExtensionSettings({
        disabled: [],
        trusted: [],
        notificationsOff: ['Not An Id'],
        catalogUrl: null,
      }),
    ).toEqual({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
  });

  it('schedulesOff: нет значения — пусто (запись до появления поля), список сохраняется и сортируется, испорченный список сбрасывается вместе с остальными', () => {
    expect(
      decodeExtensionSettings({ disabled: ['a.x'], trusted: [] }).schedulesOff,
    ).toEqual([]);
    expect(
      decodeExtensionSettings({
        disabled: [],
        trusted: [],
        notificationsOff: ['n.x'],
        schedulesOff: ['b.x', 'a.y', 'b.x'],
      }),
    ).toEqual({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: ['n.x'],
      catalogUrl: null,
      schedulesOff: ['a.y', 'b.x'],
    });
    expect(
      decodeExtensionSettings({
        disabled: ['a.x'],
        trusted: [],
        schedulesOff: ['Not An Id'],
      }),
    ).toEqual({
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
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
      safeMode: false,
      notificationsOff: [],
      catalogUrl: null,
      schedulesOff: [],
    });
  });

  it.each([
    ['https://example.test/index.json', 'https://example.test/index.json'],
    ['http://127.0.0.1:4010/index.json', 'http://127.0.0.1:4010/index.json'],
    ['javascript:alert(1)', null],
    ['file:///etc/passwd', null],
    ['not a url', null],
    [42, null],
    [undefined, null],
  ])('reads the catalog address %j as %j', (raw, expected) => {
    expect(
      decodeExtensionSettings({ disabled: [], trusted: [], catalogUrl: raw })
        .catalogUrl,
    ).toBe(expected);
  });

  it('keeps the catalog address when the id lists are unreadable', () => {
    expect(
      decodeExtensionSettings({
        disabled: 'x',
        trusted: [],
        catalogUrl: 'https://example.test/index.json',
      }).catalogUrl,
    ).toBe('https://example.test/index.json');
  });
});
