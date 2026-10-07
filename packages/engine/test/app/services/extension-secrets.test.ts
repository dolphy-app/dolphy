/**
 * Секреты расширений на стороне движка (спека extension-api-breadth-1, R6):
 * шифр платформы, потолки, недоступность хранилища ключей, жизненный цикл данных.
 */
import type { ExtensionInfoDto } from '@dolphy-app/engine-contract';
import {
  createFakeExtensionPolicy,
  createFakeExtensionRegistry,
  createFakePlatform,
} from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { EXTENSION_SECRET_LIMITS } from '../../../src/domain/index.ts';
import { createTestEngine } from '../../helpers/engine.ts';

const A = 'acme.user';
const B = 'acme.other';
const SECRET = 'сек-ret-1234';

const info = (id: string): ExtensionInfoDto => ({
  id,
  version: '1.0.0',
  state: 'loaded',
  origin: 'user',
  contributes: {
    exerciseTypes: [],
    gradePolicies: [],
    settings: [],
    events: [],
    commands: [],
    schedules: [],
    importers: [],
    exporters: [],
  },
  diagnostics: [],
  toggleable: true,
  name: null,
  description: null,
  author: null,
  dependencies: [],
  installed: null,
  icon: null,
  tags: [],
  removable: true,
  revoked: null,
  deprecated: null,
});

const open = async (platform = createFakePlatform()) => {
  const t = await createTestEngine({
    platform,
    extensionRegistry: createFakeExtensionRegistry([info(A), info(B)]),
    extensionPolicy: createFakeExtensionPolicy(),
  });
  return { t, platform, secrets: t.engine.extensionHost.secrets };
};

describe('секреты расширений: шифрование и изоляция', () => {
  it('значение возвращается как записано, а в хранилище лежит только шифртекст', async () => {
    const { t, secrets } = await open();
    await secrets.set(A, 'token', SECRET);
    expect(await secrets.get(A, 'token')).toBe(SECRET);
    const stored = await t.extensionDataStore.secrets.get(A, 'token');
    expect(typeof stored).toBe('string');
    expect(stored).not.toContain(SECRET);
    expect(
      JSON.stringify(await t.extensionDataStore.secrets.all(A)),
    ).not.toContain(SECRET);
  });

  it('у каждого расширения свои ключи; чужой ключ не виден, delete чужого — false', async () => {
    const { secrets } = await open();
    await secrets.set(A, 'token', 'a');
    await secrets.set(B, 'token', 'b');
    expect(await secrets.get(A, 'token')).toBe('a');
    expect(await secrets.get(B, 'token')).toBe('b');
    await secrets.set(A, 'only-a', 'x');
    expect(await secrets.get(B, 'only-a')).toBeUndefined();
    expect(await secrets.delete(B, 'only-a')).toBe(false);
    expect(await secrets.get(A, 'only-a')).toBe('x');
  });

  it('delete: true один раз, затем false; get после него — undefined', async () => {
    const { secrets } = await open();
    await secrets.set(A, 'k', 'v');
    expect(await secrets.delete(A, 'k')).toBe(true);
    expect(await secrets.delete(A, 'k')).toBe(false);
    expect(await secrets.get(A, 'k')).toBeUndefined();
  });

  it('пустая строка — допустимое значение, а не отсутствие ключа', async () => {
    const { secrets } = await open();
    await secrets.set(A, 'empty', '');
    expect(await secrets.get(A, 'empty')).toBe('');
  });

  it('неизвестное расширение — NOT_FOUND, не строка и пустой ключ — INVALID_ARGUMENT', async () => {
    const { secrets } = await open();
    await expect(secrets.get('acme.none', 'k')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      secrets.set(A, 'k', 42 as unknown as string),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(secrets.set(A, '', 'v')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(secrets.get(A, 1 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('секреты расширений: потолки', () => {
  const { keyLength, valueBytes, keys } = EXTENSION_SECRET_LIMITS;
  const quota = (kind: string, limit: number) => ({
    code: 'EXTENSION_STORAGE_QUOTA',
    retryable: false,
    details: { extensionId: A, kind, limit },
  });

  it('ключ: 128 допустимо, 129 — key-length; значение считается в байтах: 4096 допустимо, 4097 — value-size', async () => {
    const { secrets, platform } = await open();
    await secrets.set(A, 'k'.repeat(keyLength), 'v');
    await expect(
      secrets.set(A, 'k'.repeat(keyLength + 1), 'v'),
    ).rejects.toMatchObject(quota('key-length', keyLength));
    await secrets.set(A, 'big', 'я'.repeat(valueBytes / 2)); // 4096 байт, 2048 символов
    expect(await secrets.get(A, 'big')).toBe('я'.repeat(valueBytes / 2));
    await expect(
      secrets.set(A, 'big', 'я'.repeat(valueBytes / 2 + 1)),
    ).rejects.toMatchObject(quota('value-size', valueBytes));
    // отказ ничего не меняет и до шифра не доходит
    expect(await secrets.get(A, 'big')).toBe('я'.repeat(valueBytes / 2));
    expect(platform.calls().encrypt).toBe(2);
  });

  it('ключей: 32 допустимо, 33-й — key-count; перезапись существующего допустима', async () => {
    const { secrets } = await open();
    for (let i = 0; i < keys; i++) await secrets.set(A, `k${i}`, String(i));
    await expect(secrets.set(A, 'extra', 'x')).rejects.toMatchObject(
      quota('key-count', keys),
    );
    await secrets.set(A, 'k0', 'overwritten');
    expect(await secrets.get(A, 'k0')).toBe('overwritten');
    await secrets.set(B, 'k', 'x'); // чужой потолок не делится
  });

  it('значение потолка по-прежнему умещается в шифртекст хранилища', async () => {
    const { t, secrets } = await open();
    await secrets.set(
      A,
      'max',
      'я'.repeat(EXTENSION_SECRET_LIMITS.valueBytes / 2),
    );
    expect((await t.extensionDataStore.secrets.usage(A)).keys).toBe(1);
  });
});

describe('секреты расширений: хранилища ключей нет', () => {
  it('set и get существующего ключа — SECRETS_UNAVAILABLE, get отсутствующего — undefined, delete работает', async () => {
    const { t, secrets, platform } = await open();
    await secrets.set(A, 'token', SECRET);
    platform.setAvailable(false);

    await expect(secrets.set(A, 'new', 'v')).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
      retryable: false,
    });
    await expect(secrets.set(A, 'token', 'other')).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
    await expect(secrets.get(A, 'token')).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
    expect(await secrets.get(A, 'new')).toBeUndefined();
    expect(await t.extensionDataStore.secrets.keys(A)).toEqual(['token']);
    expect(await secrets.delete(A, 'token')).toBe(true);
    expect(await t.extensionDataStore.secrets.keys(A)).toEqual([]);

    platform.setAvailable(true);
    await secrets.set(A, 'token', 'again');
    expect(await secrets.get(A, 'token')).toBe('again');
  });

  it('значение, которое шифр не расшифровал (связка ключей сменилась), — SECRETS_UNAVAILABLE; delete и новая запись чинят ключ', async () => {
    const { secrets, platform } = await open();
    await secrets.set(A, 'token', SECRET);
    platform.breakDecryption();
    await expect(secrets.get(A, 'token')).rejects.toMatchObject({
      code: 'SECRETS_UNAVAILABLE',
    });
    expect(await secrets.delete(A, 'token')).toBe(true);
    expect(await secrets.get(A, 'token')).toBeUndefined();
  });

  it('платформа по умолчанию (CLI, тесты): хранилища ключей нет', async () => {
    const t = await createTestEngine({
      extensionRegistry: createFakeExtensionRegistry([info(A)]),
      extensionPolicy: createFakeExtensionPolicy(),
    });
    await expect(
      t.engine.extensionHost.secrets.set(A, 'k', 'v'),
    ).rejects.toMatchObject({ code: 'SECRETS_UNAVAILABLE' });
    expect(await t.engine.extensionHost.secrets.get(A, 'k')).toBeUndefined();
  });

  it('открытое значение не попадает в журнал движка ни при успехе, ни при отказе', async () => {
    const { t, secrets, platform } = await open();
    await secrets.set(A, 'token', SECRET);
    platform.setAvailable(false);
    await secrets.get(A, 'token').catch(() => undefined);
    await secrets.set(A, 'token', SECRET).catch(() => undefined);
    expect(JSON.stringify(t.logs)).not.toContain(SECRET);
  });
});

describe('секреты расширений: жизненный цикл данных', () => {
  it('dataUsage показывает число секретов; «Очистить данные» стирает их, чужие остаются', async () => {
    const { t, secrets } = await open();
    await secrets.set(A, 'a', '1');
    await secrets.set(A, 'b', '2');
    await secrets.set(B, 'a', '3');
    expect((await t.engine.extensions.dataUsage(A)).secrets.keys).toBe(2);
    expect(
      (await t.engine.extensions.dataUsage(A)).secrets.bytes,
    ).toBeGreaterThan(0);

    await t.engine.extensions.clearData(A);
    expect(await t.engine.extensions.dataUsage(A)).toMatchObject({
      secrets: { keys: 0, bytes: 0 },
    });
    expect(await secrets.get(A, 'a')).toBeUndefined();
    expect(await secrets.get(B, 'a')).toBe('3');
  });

  it('отключённое расширение секретов не отдаёт', async () => {
    const { t, secrets } = await open();
    await secrets.set(A, 'k', 'v');
    await t.engine.extensions.setEnabled(A, false);
    await expect(secrets.get(A, 'k')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'disabled' },
    });
    await t.engine.extensions.setEnabled(A, true);
    expect(await secrets.get(A, 'k')).toBe('v');
  });
});
