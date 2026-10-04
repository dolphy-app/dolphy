import { MAX_LOG_ENTRIES } from '@dolphy-app/engine-contract';
import type { ExtensionLogEntryDto } from '@dolphy-app/engine-contract';
import { createFakeLogReader } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { UNQUEUED } from '../../src/app/index.ts';
import { createTestEngine } from '../helpers/engine.ts';

const entry = (
  at: number,
  overrides: Partial<ExtensionLogEntryDto> = {},
): ExtensionLogEntryDto => ({
  at,
  level: 'info',
  source: 'ext-host',
  message: `m${at}`,
  extensionId: null,
  details: null,
  ...overrides,
});

describe('extensions.readLogs', () => {
  it('отдаёт читателю фильтры и предел; без параметров — все уровни и потолок записей', async () => {
    const reader = createFakeLogReader();
    const { engine } = await createTestEngine({ logReader: reader });

    await engine.extensions.readLogs();
    await engine.extensions.readLogs({
      extensionId: 'acme.a',
      minLevel: 'warn',
      limit: 10,
    });

    expect(reader.queries).toEqual([
      { limit: MAX_LOG_ENTRIES },
      { extensionId: 'acme.a', minLevel: 'warn', limit: 10 },
    ]);
  });

  it('последние записи по фильтру: расширение и уровень, самые новые последними', async () => {
    const reader = createFakeLogReader([
      entry(1, { extensionId: 'acme.a', level: 'debug' }),
      entry(2, { extensionId: 'acme.b', level: 'error' }),
      entry(3, { extensionId: 'acme.a', level: 'warn' }),
      entry(4, { extensionId: 'acme.a', level: 'error' }),
    ]);
    const { engine } = await createTestEngine({ logReader: reader });

    const only = await engine.extensions.readLogs({
      extensionId: 'acme.a',
      minLevel: 'warn',
    });
    expect(only.map(({ at }) => at)).toEqual([3, 4]);
    expect(
      (await engine.extensions.readLogs({ limit: 2 })).map(({ at }) => at),
    ).toEqual([3, 4]);
  });

  it.each([
    ['limit 0', { limit: 0 }, 'limit'],
    ['limit above the cap', { limit: MAX_LOG_ENTRIES + 1 }, 'limit'],
    ['fractional limit', { limit: 1.5 }, 'limit'],
    ['unknown level', { minLevel: 'trace' }, 'minLevel'],
  ])(
    '%s is INVALID_ARGUMENT and nothing is read',
    async (_name, options, field) => {
      const reader = createFakeLogReader();
      const { engine } = await createTestEngine({ logReader: reader });

      await expect(
        engine.extensions.readLogs(options as never),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        details: { field },
      });
      expect(reader.queries).toEqual([]);
    },
  );

  it('extensionId не вида id расширения — INVALID_ARGUMENT', async () => {
    const { engine } = await createTestEngine({
      logReader: createFakeLogReader(),
    });
    await expect(
      engine.extensions.readLogs({ extensionId: '../etc' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('без читателя журнала (каталог не задан) записей нет', async () => {
    const { engine } = await createTestEngine();
    expect(await engine.extensions.readLogs()).toEqual([]);
  });

  it('идёт вне очереди команд', () => {
    expect(UNQUEUED.has('extensions.readLogs')).toBe(true);
  });
});
