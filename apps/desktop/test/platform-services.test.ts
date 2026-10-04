import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostPlatform } from '../electron/host/platform.ts';
import { createLogFile } from '../electron/main/log-file.ts';
import type { LogFileSystem } from '../electron/main/log-file.ts';
import { createMainLogger } from '../electron/main/logger.ts';
import {
  createPlatformServices,
  fakeSafeStorageOf,
} from '../electron/main/platform-services.ts';
import type {
  PlatformServicesDeps,
  SafeStorageLike,
} from '../electron/main/platform-services.ts';
import type {
  PlatformRequest,
  PlatformResponse,
} from '../shared/platform.ts';

const SECRET = 'сек-ret-9f3a';

afterEach(() => vi.useRealTimers());

/** `safeStorage` с обратимым шифром, который не равен открытому тексту. */
const mockSafeStorage = (
  state: { available?: boolean; backend?: string; failDecrypt?: boolean } = {},
): SafeStorageLike => ({
  isEncryptionAvailable: () => state.available ?? true,
  encryptString: (text) =>
    Buffer.from(Buffer.from(text).map((byte) => byte ^ 0x21)),
  decryptString: (data) => {
    if (state.failDecrypt) throw new Error('keychain changed');
    return Buffer.from(data.map((byte) => byte ^ 0x21)).toString();
  },
  ...(state.backend !== undefined && {
    getSelectedStorageBackend: () => state.backend!,
  }),
});

const logger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const handler = (patch: Partial<PlatformServicesDeps> = {}) =>
  createPlatformServices({
    safeStorage: mockSafeStorage(),
    isReady: () => true,
    platform: 'darwin',
    logger: logger(),
    ...patch,
  });

let counter = 0;
const ask = async (
  target: ReturnType<typeof handler>,
  body: Record<string, unknown>,
): Promise<PlatformResponse> => {
  counter += 1;
  const response = await target.handle({
    type: 'platform-request',
    id: `p${counter}`,
    ...body,
  });
  if (response === null) throw new Error('no response');
  return response;
};

const result = (response: PlatformResponse): boolean | string => {
  if (!response.ok) throw new Error(`failed: ${response.code}`);
  return response.result;
};

describe('main: обработчик запросов платформы', () => {
  it('шифрует и расшифровывает через safeStorage; шифртекст — base64 и не содержит открытого значения', async () => {
    const h = handler();
    const encrypted = result(
      await ask(h, { op: 'cipher.encrypt', plaintext: SECRET }),
    ) as string;
    expect(Buffer.from(encrypted, 'base64').toString('base64')).toBe(encrypted);
    expect(encrypted).not.toContain(SECRET);
    expect(
      result(await ask(h, { op: 'cipher.decrypt', ciphertext: encrypted })),
    ).toBe(SECRET);
  });

  it('ответ несёт идентификатор запроса', async () => {
    const response = await handler().handle({
      type: 'platform-request',
      id: 'abc',
      op: 'cipher.available',
    });
    expect(response).toEqual({
      type: 'platform-response',
      id: 'abc',
      ok: true,
      result: true,
    });
  });

  it.each([
    ['хранилища ключей нет', { available: false }, 'darwin', true, false],
    ['приложение не готово', {}, 'darwin', false, false],
    ['Linux, basic_text', { backend: 'basic_text' }, 'linux', true, false],
    ['Linux, менеджер секретов', { backend: 'gnome_libsecret' }, 'linux', true, true],
    ['macOS', {}, 'darwin', true, true],
    ['Windows', {}, 'win32', true, true],
    // basic_text опасен только на Linux: на других системах бэкенд не спрашивают
    ['macOS, basic_text в ответе', { backend: 'basic_text' }, 'darwin', true, true],
  ] as const)('доступность: %s', async (_, state, platform, ready, expected) => {
    const h = handler({
      safeStorage: mockSafeStorage(state),
      platform,
      isReady: () => ready,
    });
    expect(result(await ask(h, { op: 'cipher.available' }))).toBe(expected);
  });

  it('при недоступном хранилище encrypt и decrypt отказывают UNAVAILABLE, а не шифруют слабым шифром', async () => {
    const h = handler({
      safeStorage: mockSafeStorage({ backend: 'basic_text' }),
      platform: 'linux',
    });
    for (const body of [
      { op: 'cipher.encrypt', plaintext: SECRET },
      { op: 'cipher.decrypt', ciphertext: 'AAAA' },
    ]) {
      expect(await ask(h, body)).toMatchObject({
        ok: false,
        code: 'UNAVAILABLE',
      });
    }
  });

  it('значение, которое safeStorage не расшифровал, — UNAVAILABLE', async () => {
    const state = { failDecrypt: false };
    const h = handler({ safeStorage: mockSafeStorage(state) });
    const encrypted = result(
      await ask(h, { op: 'cipher.encrypt', plaintext: SECRET }),
    ) as string;
    state.failDecrypt = true;
    expect(
      await ask(h, { op: 'cipher.decrypt', ciphertext: encrypted }),
    ).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('запрос неверной формы — INVALID с id; не запрос платформы — без ответа', async () => {
    const h = handler();
    for (const body of [
      { op: 'cipher.encrypt' },
      { op: 'cipher.decrypt', ciphertext: 7 },
      { op: 'cipher.wipe' },
      {},
    ]) {
      expect(await ask(h, body)).toMatchObject({ ok: false, code: 'INVALID' });
    }
    expect(await h.handle({ type: 'ready' })).toBeNull();
    expect(await h.handle(null)).toBeNull();
    expect(
      await h.handle({ type: 'platform-request', op: 'cipher.available' }),
    ).toBeNull();
  });
});

describe('подменное хранилище ключей (DOLPHY_FAKE_SAFE_STORAGE)', () => {
  it('действует только в несобранном приложении и только с известным значением', () => {
    expect(fakeSafeStorageOf({ DOLPHY_FAKE_SAFE_STORAGE: '1' }, false)).toBe(
      'cipher',
    );
    expect(
      fakeSafeStorageOf({ DOLPHY_FAKE_SAFE_STORAGE: 'unavailable' }, false),
    ).toBe('unavailable');
    expect(
      fakeSafeStorageOf({ DOLPHY_FAKE_SAFE_STORAGE: '1' }, true),
    ).toBeUndefined();
    expect(
      fakeSafeStorageOf({ DOLPHY_FAKE_SAFE_STORAGE: 'yes' }, false),
    ).toBeUndefined();
    expect(fakeSafeStorageOf({}, false)).toBeUndefined();
  });

  it('обратимый шифр не обращается к safeStorage, не оставляет открытого текста и не принимает чужой шифртекст', async () => {
    const safeStorage = mockSafeStorage();
    const spy = vi.spyOn(safeStorage, 'encryptString');
    const h = handler({ safeStorage, fake: 'cipher' });
    const encrypted = result(
      await ask(h, { op: 'cipher.encrypt', plaintext: SECRET }),
    ) as string;
    expect(spy).not.toHaveBeenCalled();
    expect(encrypted).not.toContain(SECRET);
    expect(Buffer.from(encrypted, 'base64').toString()).not.toContain(SECRET);
    expect(
      result(await ask(h, { op: 'cipher.decrypt', ciphertext: encrypted })),
    ).toBe(SECRET);
    expect(
      await ask(h, {
        op: 'cipher.decrypt',
        ciphertext: Buffer.from('plain').toString('base64'),
      }),
    ).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  });

  it('режим unavailable: хранилища нет; до готовности приложения подмена тоже недоступна', async () => {
    const down = handler({ fake: 'unavailable' });
    expect(result(await ask(down, { op: 'cipher.available' }))).toBe(false);
    expect(
      await ask(down, { op: 'cipher.encrypt', plaintext: 'x' }),
    ).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    const early = handler({ fake: 'cipher', isReady: () => false });
    expect(result(await ask(early, { op: 'cipher.available' }))).toBe(false);
  });
});

/** Хост движка, соединённый с обработчиком main напрямую (как `parentPort`). */
const wired = (deps: Partial<PlatformServicesDeps> = {}, timeoutMs = 5000) => {
  const target = handler(deps);
  const sent: PlatformRequest[] = [];
  const host = createHostPlatform({
    timeoutMs,
    post: (message) => {
      sent.push(message);
      void target.handle(message).then((response) => {
        if (response !== null) host.handleMessage(response);
      });
    },
  });
  return { host, sent };
};

describe('хост движка: адаптер порта PlatformServices', () => {
  it('шифр работает через канал к main целиком', async () => {
    const { host, sent } = wired();
    const { cipher } = host.services;
    expect(await cipher.available()).toBe(true);
    const encrypted = await cipher.encrypt(SECRET);
    expect(encrypted).not.toContain(SECRET);
    expect(await cipher.decrypt(encrypted)).toBe(SECRET);
    expect(sent.map(({ op }) => op)).toEqual([
      'cipher.available',
      'cipher.encrypt',
      'cipher.decrypt',
    ]);
    expect(new Set(sent.map(({ id }) => id)).size).toBe(3);
  });

  it('отказ main — SECRETS_UNAVAILABLE без текста платформы', async () => {
    const { host } = wired({ safeStorage: mockSafeStorage({ available: false }) });
    expect(await host.services.cipher.available()).toBe(false);
    await expect(host.services.cipher.encrypt(SECRET)).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
  });

  it('нет ответа за срок — SECRETS_UNAVAILABLE, поздний ответ игнорируется', async () => {
    vi.useFakeTimers();
    const sent: PlatformRequest[] = [];
    const host = createHostPlatform({
      post: (message) => void sent.push(message),
    });
    const pending = host.services.cipher.encrypt(SECRET);
    const failure = expect(pending).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
      details: { reason: 'timeout' },
    });
    await vi.advanceTimersByTimeAsync(5000);
    await failure;
    expect(
      host.handleMessage({
        type: 'platform-response',
        id: sent[0]!.id,
        ok: true,
        result: 'late',
      }),
    ).toBe(true);
  });

  it('закрытие хоста отклоняет ожидающие запросы и новые', async () => {
    const host = createHostPlatform({ post: () => undefined });
    const pending = host.services.cipher.decrypt('AAAA');
    const failure = expect(pending).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
    host.close();
    await failure;
    await expect(host.services.cipher.available()).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
  });

  it('сбой отправки (канал закрыт) — SECRETS_UNAVAILABLE; чужие сообщения не поглощаются', async () => {
    const host = createHostPlatform({
      post: () => {
        throw new Error('port closed');
      },
    });
    await expect(host.services.cipher.available()).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
    expect(host.handleMessage({ type: 'connect' })).toBe(false);
    expect(host.handleMessage(null)).toBe(false);
  });

  it('ответ неверного вида на encrypt (не строка) — SECRETS_UNAVAILABLE', async () => {
    const host = createHostPlatform({
      post: (message) =>
        queueMicrotask(() =>
          host.handleMessage({
            type: 'platform-response',
            id: message.id,
            ok: true,
            result: true,
          }),
        ),
    });
    await expect(host.services.cipher.encrypt('x')).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
  });
});

describe('секрет не попадает в журналы', () => {
  it('ни файловый журнал main, ни stderr, ни текст ошибки для расширения не содержат открытого значения, даже если safeStorage выбросил его в сообщении', async () => {
    const lines: string[] = [];
    const memory: LogFileSystem = {
      mkdir: () => undefined,
      list: () => [],
      stat: () => ({ size: 0, mtimeMs: 0 }),
      append: (_, text) => void lines.push(text),
      remove: () => undefined,
    };
    const file = createLogFile({
      dir: '/logs',
      clock: { now: () => Date.now() },
      fs: memory,
    });
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hostile: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (text) => {
        throw new Error(`cannot encrypt ${text}`);
      },
      decryptString: () => {
        throw new Error(`cannot decrypt ${SECRET}`);
      },
    };
    const { host } = wired({
      safeStorage: hostile,
      logger: createMainLogger(file),
    });
    const errors = await Promise.all([
      host.services.cipher.encrypt(SECRET).catch((e: unknown) => e),
      host.services.cipher.decrypt('AAAA').catch((e: unknown) => e),
    ]);
    stderr.mockRestore();

    expect(lines.join('')).toContain('platform request failed');
    expect(lines.join('')).not.toContain(SECRET);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(SECRET);
    for (const error of errors) {
      expect(error).toMatchObject({ code: 'SECRETS_UNAVAILABLE' });
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(
        SECRET,
      );
    }
  });
});
