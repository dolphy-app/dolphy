import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DETAILS_CHARS,
  createFileLogReader,
} from '../../src/node/log-reader.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'dolphy-logs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (
  at: number,
  fields: Record<string, unknown> = {},
  level = 'info',
): string =>
  JSON.stringify({
    level,
    source: 'ext-host',
    message: `m${at}`,
    at,
    ...fields,
  });

const file = (name: string, lines: string[]): Promise<void> =>
  writeFile(path.join(dir, name), `${lines.join('\n')}\n`);

const ats = async (
  query: Parameters<ReturnType<typeof createFileLogReader>['read']>[0],
) => (await createFileLogReader(dir).read(query)).map(({ at }) => at);

describe('файловый читатель журнала', () => {
  it('каталога нет — записей нет', async () => {
    const reader = createFileLogReader(path.join(dir, 'missing'));
    expect(await reader.read({ limit: 10 })).toEqual([]);
  });

  it('читает все файлы от новых к старым, отдаёт последние записи, самые новые внизу', async () => {
    await file('dolphy-2026-10-01.log', [line(1), line(2)]);
    await file('dolphy-2026-10-02.log', [line(3), line(4)]);
    await file('dolphy-2026-10-02.1.log', [line(5), line(6)]);
    await file('dolphy-2026-10-02.10.log', [line(7)]);
    await file('dolphy-2026-10-02.2.log', [line(8)]);

    // 02.10 новее 02.2 по номеру, а не по строке
    expect(await ats({ limit: 500 })).toEqual([1, 2, 3, 4, 5, 6, 8, 7]);
    expect(await ats({ limit: 3 })).toEqual([6, 8, 7]);
  });

  it('нечитаемые строки и чужие файлы пропускаются', async () => {
    await file('dolphy-2026-10-01.log', [
      line(1),
      '{broken',
      'plain text from a crash',
      '[]',
      '"string"',
      JSON.stringify({ level: 'info', message: 'no at' }),
      JSON.stringify({ level: 'loud', message: 'bad level', at: 2 }),
      JSON.stringify({ level: 'info', message: 7, at: 3 }),
      '',
      line(4),
    ]);
    await file('notes.txt', [line(99)]);
    await file('dolphy-2026-10-01.log.bak', [line(98)]);
    await mkdir(path.join(dir, 'dolphy-2026-10-05.log'));

    expect(await ats({ limit: 500 })).toEqual([1, 4]);
  });

  it('фильтр по расширению и минимальному уровню действует до предела', async () => {
    await file('dolphy-2026-10-01.log', [
      line(1, { extensionId: 'acme.a' }, 'debug'),
      line(2, { extensionId: 'acme.a' }, 'warn'),
      line(3, { extensionId: 'acme.b' }, 'error'),
      line(4, {}, 'error'),
    ]);
    await file('dolphy-2026-10-02.log', [
      line(5, { extensionId: 'acme.a' }, 'error'),
      line(6, { extensionId: 'acme.b' }, 'info'),
    ]);

    expect(await ats({ limit: 500, extensionId: 'acme.a' })).toEqual([1, 2, 5]);
    expect(
      await ats({ limit: 500, extensionId: 'acme.a', minLevel: 'warn' }),
    ).toEqual([2, 5]);
    expect(await ats({ limit: 1, extensionId: 'acme.a' })).toEqual([5]);
    expect(await ats({ limit: 500, minLevel: 'error' })).toEqual([3, 4, 5]);
  });

  it('запись: источник, расширение и остальные поля одной строкой', async () => {
    await file('dolphy-2026-10-01.log', [
      line(1, { extensionId: 'acme.a', stream: 'stderr', n: 2 }),
      JSON.stringify({ level: 'info', message: '', at: 2 }),
    ]);

    expect(await createFileLogReader(dir).read({ limit: 10 })).toEqual([
      {
        at: 1,
        level: 'info',
        source: 'ext-host',
        message: 'm1',
        extensionId: 'acme.a',
        details: '{"stream":"stderr","n":2}',
      },
      {
        at: 2,
        level: 'info',
        source: 'unknown',
        message: '',
        extensionId: null,
        details: null,
      },
    ]);
  });

  it('длинные сообщение и поля обрезаются', async () => {
    await file('dolphy-2026-10-01.log', [
      line(1, { message: 'x'.repeat(10_000), blob: 'y'.repeat(10_000) }),
    ]);
    const [entry] = await createFileLogReader(dir).read({ limit: 1 });
    expect(entry?.message.length).toBeLessThanOrEqual(4097);
    expect(entry?.message.endsWith('…')).toBe(true);
    expect(entry?.details?.length).toBe(MAX_DETAILS_CHARS + 1);
  });
});
