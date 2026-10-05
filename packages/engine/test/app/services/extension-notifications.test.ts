/**
 * Системные уведомления расширений на стороне движка (спека
 * extension-api-breadth-1, R11, R14): разрешение, очистка текста, пределы,
 * частота, переключатель «Уведомления».
 */
import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import {
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakePlatform,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { EXTENSION_NOTIFICATION_LIMITS } from '../../../src/domain/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const A = 'acme.notify';
const B = 'acme.other';
const PLAIN = 'acme.plain';

const info = (
  id: string,
  permissions: string[],
  overrides: Partial<ExtensionInfoDto> = {},
): ExtensionInfoDto => ({
  id,
  version: '1.0.0',
  state: 'loaded',
  origin: 'user',
  contributes: {
    exerciseTypes: [],
    themes: [],
    markdownRenderers: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    widgets: [],
    schedules: [],
    panels: [],
    importers: [],
    exporters: [],
  },
  diagnostics: [],
  permissions,
  isolation: 'isolated',
  toggleable: true,
  name: null,
  description: null,
  author: null,
  installed: null,
  icon: null,
  titles: {},
  messages: {},
  tags: [],
  removable: true,
  revoked: null,
  deprecated: null,
  ...overrides,
});

const open = async (infos?: ExtensionInfoDto[]) => {
  const platform = createFakePlatform();
  const t = await createTestEngine({
    platform,
    extensionRegistry: createFakeExtensionRegistry(
      infos ?? [
        info(A, ['notifications'], { name: 'Notifier' }),
        info(B, ['notifications']),
        info(PLAIN, []),
      ],
    ),
    extensionPolicy: createFakeExtensionPolicy(),
  });
  return { t, platform, notifications: t.engine.extensionHost.notifications };
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('разрешение', () => {
  it('без notifications — INVALID_ARGUMENT reason permission, уведомление не показано', async () => {
    const { platform, notifications } = await open();
    await expect(notifications.show(PLAIN, 'T', 'B')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: {
        reason: 'permission',
        permission: 'notifications',
        extensionId: PLAIN,
      },
    });
    expect(platform.notifications()).toEqual([]);
  });

  it('неизвестное расширение — NOT_FOUND', async () => {
    const { notifications } = await open();
    await expect(
      notifications.show('acme.none', 'T', 'B'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('показ', () => {
  it('передаёт платформе название расширения, название и текст и разрешается true', async () => {
    const { platform, notifications } = await open();
    expect(await notifications.show(A, 'Streak', 'Keep going')).toBe(true);
    expect(platform.notifications()).toEqual([
      { source: 'Notifier', title: 'Streak', body: 'Keep going' },
    ]);
  });

  it('расширение без названия называется своим id; %ключ% — текстом en', async () => {
    const { platform, notifications } = await open([
      info(A, ['notifications']),
      info(B, ['notifications'], {
        name: '%ext.name%',
        messages: {
          en: { 'ext.name': 'Localized' },
          ru: { 'ext.name': 'Имя' },
        },
      }),
    ]);
    await notifications.show(A, 'T', '');
    await notifications.show(B, 'T', '');
    expect(platform.notifications().map((item) => item.source)).toEqual([
      A,
      'Localized',
    ]);
  });

  it('платформа без уведомлений — false', async () => {
    const { platform, notifications } = await open();
    platform.setNotificationsSupported(false);
    expect(await notifications.show(A, 'T', 'B')).toBe(false);
    expect(platform.notifications()).toEqual([]);
  });

  it('управляющие символы и символы направления удаляются, название — одна строка', async () => {
    const { platform, notifications } = await open();
    await notifications.show(
      A,
      '  Hi\u0000\n\u202Ethere\u0007  ',
      'one\r\ntwo\u0085\tthree\u200E',
    );
    expect(platform.notifications()).toEqual([
      { source: 'Notifier', title: 'Hi there', body: 'one\ntwo three' },
    ]);
  });
});

describe('пределы текста', () => {
  const { titleLength, bodyLength } = EXTENSION_NOTIFICATION_LIMITS;

  it('ровно предельная длина принимается, на символ больше — INVALID_ARGUMENT с полем', async () => {
    const { platform, notifications } = await open();
    expect(
      await notifications.show(
        A,
        'a'.repeat(titleLength),
        'b'.repeat(bodyLength),
      ),
    ).toBe(true);
    await expect(
      notifications.show(A, 'a'.repeat(titleLength + 1), ''),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'title', max: titleLength },
    });
    await expect(
      notifications.show(A, 'T', 'b'.repeat(bodyLength + 1)),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'body', max: bodyLength },
    });
    expect(platform.notifications()).toHaveLength(1);
  });

  it('длина считается в символах, а не в кодовых единицах UTF-16', async () => {
    const { notifications } = await open();
    expect(await notifications.show(A, '😀'.repeat(titleLength), '')).toBe(
      true,
    );
  });

  it('пустое после очистки название и не строка — INVALID_ARGUMENT', async () => {
    const { notifications } = await open();
    await expect(notifications.show(A, ' \u0000 ', 'b')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'title' },
    });
    await expect(
      notifications.show(A, 'T', 7 as unknown as string),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'body' },
    });
  });
});

describe('частота', () => {
  const { perMinute, perHour } = EXTENSION_NOTIFICATION_LIMITS;

  it('четвёртое уведомление за минуту отклоняется, через минуту окно освобождается', async () => {
    const { t, platform, notifications } = await open();
    for (let i = 0; i < perMinute; i += 1) {
      expect(await notifications.show(A, `n${i}`, '')).toBe(true);
    }
    await expect(notifications.show(A, 'over', '')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'rate-limit', window: 'minute', limit: perMinute },
    });
    expect(platform.notifications()).toHaveLength(perMinute);
    t.clock.advance(MINUTE);
    expect(await notifications.show(A, 'again', '')).toBe(true);
  });

  it('предел часа: 30 уведомлений с паузами проходят, 31-е — нет', async () => {
    const { t, notifications } = await open();
    for (let i = 0; i < perHour; i += 1) {
      expect(await notifications.show(A, `n${i}`, '')).toBe(true);
      t.clock.advance(MINUTE + 1_000);
    }
    await expect(notifications.show(A, 'over', '')).rejects.toMatchObject({
      details: { reason: 'rate-limit', window: 'hour', limit: perHour },
    });
    t.clock.advance(HOUR);
    expect(await notifications.show(A, 'later', '')).toBe(true);
  });

  it('счётчик у каждого расширения свой', async () => {
    const { notifications } = await open();
    for (let i = 0; i < perMinute; i += 1) {
      await notifications.show(A, `n${i}`, '');
    }
    expect(await notifications.show(B, 'mine', '')).toBe(true);
  });

  it('отклонённые по тексту и по переключателю вызовы лимит не расходуют', async () => {
    const { t, platform, notifications } = await open();
    for (let i = 0; i < perMinute * 2; i += 1) {
      await notifications.show(A, '', '').catch(() => undefined);
    }
    await t.engine.extensions.setNotificationsEnabled(A, false);
    for (let i = 0; i < perMinute * 2; i += 1) {
      expect(await notifications.show(A, 'quiet', '')).toBe(false);
    }
    await t.engine.extensions.setNotificationsEnabled(A, true);
    for (let i = 0; i < perMinute; i += 1) {
      expect(await notifications.show(A, `n${i}`, '')).toBe(true);
    }
    expect(platform.notifications()).toHaveLength(perMinute);
  });
});

describe('переключатель «Уведомления»', () => {
  it('выключенное расширение получает false без обращения к платформе; включение возвращает показ', async () => {
    const { t, platform, notifications } = await open();
    const off = await t.engine.extensions.setNotificationsEnabled(A, false);
    expect(off.notificationsOff).toEqual([A]);
    expect(await notifications.show(A, 'T', 'B')).toBe(false);
    expect(platform.notifications()).toEqual([]);
    expect(await notifications.show(B, 'T', 'B')).toBe(true);
    const on = await t.engine.extensions.setNotificationsEnabled(A, true);
    expect(on.notificationsOff).toEqual([]);
    expect(await notifications.show(A, 'T', 'B')).toBe(true);
  });

  it('значение хранится отсортированно без повторов и не перезапускает расширения', async () => {
    const { t } = await open();
    await t.engine.extensions.setNotificationsEnabled(B, false);
    await t.engine.extensions.setNotificationsEnabled(A, false);
    const again = await t.engine.extensions.setNotificationsEnabled(A, false);
    expect(again.notificationsOff).toEqual([A, B]);
    expect((await t.engine.extensions.getSettings()).notificationsOff).toEqual([
      A,
      B,
    ]);
  });

  it('неизвестное расширение — NOT_FOUND, расширение из поставки и не булево — INVALID_ARGUMENT', async () => {
    const { t } = await open([
      info(A, ['notifications']),
      info('dolphy.bundled', [], { origin: 'bundled', toggleable: false }),
    ]);
    const { extensions } = t.engine;
    await expect(
      extensions.setNotificationsEnabled('acme.none', false),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      extensions.setNotificationsEnabled('dolphy.bundled', false),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'bundled' },
    });
    await expect(
      extensions.setNotificationsEnabled(A, 'no' as never),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { field: 'enabled' },
    });
  });
});
