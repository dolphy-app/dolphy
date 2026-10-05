/**
 * Системные уведомления в main и в хосте движка (спека extension-api-breadth-1,
 * R11): `Notification` подменён, ОС не вызывается.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHostPlatform } from '../electron/host/platform.ts';
import {
  createPlatformServices,
  notificationLogOf,
} from '../electron/main/platform-services.ts';
import type {
  NotificationLike,
  NotificationOptionsLike,
  PlatformServicesDeps,
} from '../electron/main/platform-services.ts';
import type { PlatformRequest, PlatformResponse } from '../shared/platform.ts';

const logger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/** `Notification` с журналом: что создано, показано и какие обработчики повешены. */
const fakeNotifications = (supported = true) => {
  const created: NotificationOptionsLike[] = [];
  const shown: NotificationOptionsLike[] = [];
  const listeners: Record<string, () => void>[] = [];
  return {
    created,
    shown,
    listeners,
    api: {
      isSupported: () => supported,
      create: (options: NotificationOptionsLike): NotificationLike => {
        created.push(options);
        const own: Record<string, () => void> = {};
        listeners.push(own);
        return {
          on: (event, listener) => void (own[event] = listener),
          show: () => void shown.push(options),
        };
      },
    },
  };
};

const handler = (patch: Partial<PlatformServicesDeps> = {}) =>
  createPlatformServices({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text),
      decryptString: (data) => data.toString(),
    },
    isReady: () => true,
    platform: 'darwin',
    logger: logger(),
    ...patch,
  });

const notify = (
  target: ReturnType<typeof handler>,
  body: Record<string, unknown> = {},
): Promise<PlatformResponse | null> =>
  target.handle({
    type: 'platform-request',
    id: 'n1',
    op: 'notify',
    source: 'Acme',
    title: 'Title',
    body: 'Body',
    ...body,
  });

describe('main: операция notify', () => {
  it('macOS: имя расширения — подзаголовок, звука нет; ответ true', async () => {
    const fake = fakeNotifications();
    const response = await notify(handler({ notifications: fake.api }));
    expect(response).toEqual({
      type: 'platform-response',
      id: 'n1',
      ok: true,
      result: true,
    });
    expect(fake.shown).toEqual([
      { title: 'Title', body: 'Body', subtitle: 'Acme', silent: true },
    ]);
  });

  it('Windows и Linux: имя расширения — последней строкой текста, пустой текст — только имя', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const fake = fakeNotifications();
      const target = handler({ notifications: fake.api, platform });
      await notify(target);
      await notify(target, { body: '' });
      expect(fake.shown).toEqual([
        { title: 'Title', body: 'Body\nAcme', silent: true },
        { title: 'Title', body: 'Acme', silent: true },
      ]);
    }
  });

  it('клик по уведомлению показывает окно приложения', async () => {
    const fake = fakeNotifications();
    const showWindow = vi.fn();
    await notify(handler({ notifications: fake.api, showWindow }));
    expect(showWindow).not.toHaveBeenCalled();
    fake.listeners[0]!.click!();
    expect(showWindow).toHaveBeenCalledTimes(1);
  });

  it('ОС уведомления не поддерживает или Notification нет — ответ true не выдаётся, ничего не создаётся', async () => {
    const off = fakeNotifications(false);
    expect(await notify(handler({ notifications: off.api }))).toMatchObject({
      ok: true,
      result: false,
    });
    expect(off.created).toEqual([]);
    expect(await notify(handler())).toMatchObject({ ok: true, result: false });
  });

  it('уведомления работают и без хранилища ключей, и до готовности хранилища', async () => {
    const fake = fakeNotifications();
    const response = await notify(
      handler({
        notifications: fake.api,
        fake: 'unavailable',
        isReady: () => false,
      }),
    );
    expect(response).toMatchObject({ ok: true, result: true });
  });

  it('сбой показа — UNAVAILABLE без текста в журнале; запрос неверной формы — INVALID', async () => {
    const log = logger();
    const failing = handler({
      logger: log,
      notifications: {
        isSupported: () => true,
        create: () => {
          throw new Error('secret-title leaked');
        },
      },
    });
    expect(await notify(failing, { title: 'secret-title' })).toMatchObject({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('secret-title');
    expect(await notify(failing, { title: 5 })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await notify(failing, { source: undefined })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
  });

  it('журнал e2e заменяет вызов ОС и получает запись как есть', async () => {
    const fake = fakeNotifications();
    const entries: unknown[] = [];
    const response = await notify(
      handler({
        notifications: fake.api,
        notificationLog: (entry) => void entries.push(entry),
      }),
    );
    expect(response).toMatchObject({ ok: true, result: true });
    expect(entries).toEqual([
      { source: 'Acme', title: 'Title', body: 'Body' },
    ]);
    expect(fake.created).toEqual([]);
  });
});

describe('DOLPHY_NOTIFICATION_LOG', () => {
  it('действует только в несобранном приложении и только с путём', () => {
    expect(notificationLogOf({ DOLPHY_NOTIFICATION_LOG: '/tmp/n' }, false)).toBe(
      '/tmp/n',
    );
    expect(
      notificationLogOf({ DOLPHY_NOTIFICATION_LOG: '/tmp/n' }, true),
    ).toBeUndefined();
    expect(notificationLogOf({ DOLPHY_NOTIFICATION_LOG: '' }, false)).toBe(
      undefined,
    );
    expect(notificationLogOf({}, false)).toBeUndefined();
  });
});

describe('хост движка: порт notifier', () => {
  const wired = (deps: Partial<PlatformServicesDeps> = {}) => {
    const target = handler(deps);
    const sent: PlatformRequest[] = [];
    const host = createHostPlatform({
      timeoutMs: 100,
      post: (message) => {
        sent.push(message);
        void target.handle(message).then((response) => {
          if (response !== null) host.handleMessage(response);
        });
      },
    });
    return { host, sent };
  };

  it('уведомление доходит до Notification в main, ответ — true', async () => {
    const fake = fakeNotifications();
    const { host, sent } = wired({ notifications: fake.api });
    expect(
      await host.services.notifier.show({
        source: 'Acme',
        title: 'T',
        body: 'B',
      }),
    ).toBe(true);
    expect(sent).toMatchObject([
      { op: 'notify', source: 'Acme', title: 'T', body: 'B' },
    ]);
    expect(fake.shown).toHaveLength(1);
  });

  it('ОС без уведомлений, отказ main, нет ответа и закрытый хост — false, а не исключение', async () => {
    const note = { source: 'Acme', title: 'T', body: 'B' };
    expect(
      await wired({ notifications: fakeNotifications(false).api }).host.services.notifier.show(
        note,
      ),
    ).toBe(false);
    const broken = wired({
      notifications: {
        isSupported: () => true,
        create: () => {
          throw new Error('boom');
        },
      },
    });
    expect(await broken.host.services.notifier.show(note)).toBe(false);
    const silent = createHostPlatform({ timeoutMs: 20, post: () => undefined });
    expect(await silent.services.notifier.show(note)).toBe(false);
    silent.close();
    expect(await silent.services.notifier.show(note)).toBe(false);
  });
});
