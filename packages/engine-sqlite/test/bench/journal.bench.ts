/**
 * T-57 (engine-ts-testing.md §7.1), журнал F-слоя на SQLite: чтение, вставка,
 * латентность коммита и обмен сегментами `FolderSync` на журнале 500k записей
 * (3 устройства, 730 дней, 85 % успехов). Запуск: `pnpm -F @dolphy-app/engine-sqlite
 * bench`. Проект отдельный: в `pnpm test` не входит. Бенчмарки советуют, не
 * блокируют: числа печатаются, регресс более чем вдвое от базы документа —
 * `console.warn`; падают только ошибки корректности (не то число записей,
 * нарушенный порядок).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createFakeClock } from '@dolphy-app/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LogEntry } from '@dolphy-app/engine';
import { createFolderSync } from '@dolphy-app/engine/node';
import type { FolderImportReport } from '@dolphy-app/engine/node';
import { createReplica } from '@dolphy-app/engine/sync';
import {
  RUNS,
  report,
  summarize,
  timed,
  timedAsync,
  warnOnRegression,
} from '../../../engine/test/bench/bench-stats.ts';
import {
  BENCH_DEVICES,
  BENCH_EVENTS,
  generateJournal,
} from '../../../engine/test/bench/journal-generator.ts';
import { openSqliteEventStore } from '../../src/index.ts';
import type { Durability, SqliteEventStore } from '../../src/index.ts';

const BATCH = 1_000;
const COMMITS = 200;
const ENTRIES_PER_SEGMENT = 1_000;
const IMPORTER_ID = 'device-import';

/** Числа документа (M4, engine-ts-testing.md §7.1): на них смотрит предупреждение о регрессе. */
const BASE_MS = {
  readMapped: 210,
  readRaw: 78,
  insert: 10_200,
  commitFull: 3,
  exportAll: 2_750,
  importAll: 827,
} as const;

describe('T-57 журнал 500k в SQLite (чтение, вставка, коммит, экспорт и импорт)', () => {
  const journal = generateJournal();
  let root = '';
  let slot = 0;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'engine-sqlite-bench-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const freshPath = () => join(root, `journal-${slot++}.db`);

  const dropDatabase = (path: string) => {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${path}${suffix}`, { force: true });
    }
  };

  /**
   * Пропускная способность (вставка, чтение, обмен сегментами) мерится при
   * `durability: 'normal'`, как в тестах пакета; `full` (на macOS с `fullfsync`,
   * умолчание продукции) — только латентность коммита.
   */
  const openStore = (
    path: string,
    deviceId: string,
    durability: Durability = 'normal',
  ) => openSqliteEventStore({ path, deviceId, durability });

  const insertAll = async (
    store: SqliteEventStore,
    entries: readonly LogEntry[],
  ) => {
    for (let from = 0; from < entries.length; from += BATCH) {
      const { appended } = await store.append(
        entries.slice(from, from + BATCH),
      );
      expect(appended.length).toBe(Math.min(BATCH, entries.length - from));
    }
  };

  it('генератор: 500k записей, seq по устройствам без пропусков, at строго растёт', () => {
    expect(journal.length).toBe(BENCH_EVENTS);
    const seqs = new Map<string, number>();
    let previousAt = -1;
    for (const entry of journal) {
      expect(entry.at).toBeGreaterThan(previousAt);
      previousAt = entry.at;
      const expected = (seqs.get(entry.deviceId) ?? 0) + 1;
      if (entry.seq !== expected) throw new Error(`seq gap at ${entry.id}`);
      seqs.set(entry.deviceId, expected);
    }
    expect([...seqs.keys()].sort()).toEqual([...BENCH_DEVICES]);
    const successes = journal.filter(({ grade }) => grade >= 3).length;
    expect(successes / journal.length).toBeGreaterThan(0.84);
    expect(successes / journal.length).toBeLessThan(0.86);
  });

  it('вставка 500k батчами по 1000 (append), записей/с', async () => {
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const path = freshPath();
      const store = openStore(path, 'device-a');
      samples.push(await timedAsync(() => insertAll(store, journal)));
      expect(store.entryCount()).toBe(BENCH_EVENTS);
      await store.close();
      dropDatabase(path);
    }
    const stats = summarize(samples);
    report('вставка 500k батчами по 1000', stats);
    report(
      'вставка 500k, записей/с',
      summarize(samples.map((ms) => (BENCH_EVENTS / ms) * 1_000)),
      'зап/с',
    );
    warnOnRegression('вставка 500k', stats.median, BASE_MS.insert);
  });

  it('чтение 500k ORDER BY at, device_id, seq: с маппингом в LogEntry и без него', async () => {
    const path = freshPath();
    const store = openStore(path, 'device-a');
    await insertAll(store, journal);
    expect(store.entryCount()).toBe(BENCH_EVENTS);

    const mapped: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      let count = 0;
      let previousAt = -1;
      const started = performance.now();
      for await (const entry of store.readAll()) {
        if (entry.at <= previousAt) throw new Error('readAll: order broken');
        previousAt = entry.at;
        count++;
      }
      mapped.push(performance.now() - started);
      expect(count).toBe(BENCH_EVENTS);
    }

    // без маппинга: тот же запрос на том же файле; строка — массив значений драйвера
    const raw = new Database(path, { readonly: true });
    const scan = raw
      .prepare('SELECT * FROM log_entry ORDER BY at, device_id, seq')
      .raw(true);
    const unmapped: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      let count = 0;
      unmapped.push(
        timed(() => {
          for (const row of scan.iterate()) {
            if (row !== undefined) count++;
          }
        }),
      );
      expect(count).toBe(BENCH_EVENTS);
    }
    // только работа SQLite: обход индекса `log_order` без строк на стороне JS
    const sqlOnly = raw.prepare(
      'SELECT count(*) AS total FROM (SELECT seq FROM log_entry ORDER BY at, device_id, seq LIMIT -1)',
    );
    const scanned: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      let total = 0;
      scanned.push(
        timed(() => {
          total = (sqlOnly.get() as { total: number }).total;
        }),
      );
      expect(total).toBe(BENCH_EVENTS);
    }
    raw.close();
    await store.close();
    dropDatabase(path);

    const mappedStats = summarize(mapped);
    const rawStats = summarize(unmapped);
    const scanStats = summarize(scanned);
    report('чтение 500k, readAll с маппингом в LogEntry', mappedStats);
    report(
      'чтение 500k, SELECT без маппинга (строки-массивы драйвера)',
      rawStats,
    );
    report(
      'чтение 500k, обход индекса в SQLite (count по ORDER BY)',
      scanStats,
    );
    warnOnRegression(
      'чтение 500k с маппингом',
      mappedStats.median,
      BASE_MS.readMapped,
    );
    warnOnRegression(
      'чтение 500k без маппинга',
      scanStats.median,
      BASE_MS.readRaw,
    );
  });

  it('латентность append на батче 1 при durability: full (fullfsync на macOS), 200 коммитов', async () => {
    const samples: number[] = [];
    const runMedians: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const path = freshPath();
      const store = openStore(path, 'device-a', 'full');
      const settings = store.inspect();
      expect(settings.synchronous).toBe('full');
      expect(settings.journalMode).toBe('wal');
      expect(settings.fullfsync).toBe(process.platform === 'darwin');
      const runSamples: number[] = [];
      for (const entry of journal.slice(0, COMMITS)) {
        runSamples.push(
          await timedAsync(async () => {
            const { appended } = await store.append([entry]);
            expect(appended.length).toBe(1);
          }),
        );
      }
      expect(store.entryCount()).toBe(COMMITS);
      await store.close();
      dropDatabase(path);
      samples.push(...runSamples);
      runMedians.push(summarize(runSamples).median);
    }
    const pooled = summarize(samples);
    report(`латентность append (батч 1, ${RUNS}×${COMMITS} коммитов)`, pooled);
    report('латентность append, медианы по запускам', summarize(runMedians));
    warnOnRegression('латентность append', pooled.median, BASE_MS.commitFull);
  });

  it('экспорт и импорт 500k при 1000 записей на сегмент через FolderSync', async () => {
    // три устройства, у каждого — только своя треть журнала (`export` публикует свой хвост)
    const sources = new Map<string, SqliteEventStore>();
    const sourcePaths: string[] = [];
    for (const deviceId of BENCH_DEVICES) {
      const path = freshPath();
      const store = openStore(path, deviceId);
      await insertAll(
        store,
        journal.filter((entry) => entry.deviceId === deviceId),
      );
      sources.set(deviceId, store);
      sourcePaths.push(path);
    }
    // часы получателя не раньше конца журнала: иначе записи «из будущего» уходят в карантин
    const clock = createFakeClock(journal.at(-1)?.at);
    const exported: number[] = [];
    const imported: number[] = [];
    let segments = 0;
    for (let run = 0; run < RUNS; run++) {
      const dir = join(root, `folder-${run}`);
      mkdirSync(dir);
      let publishedEntries = 0;
      let publishedSegments = 0;
      exported.push(
        await timedAsync(async () => {
          for (const store of sources.values()) {
            const published = await createFolderSync({
              dir,
              store,
              replica: createReplica({ store, clock }),
              entriesPerSegment: ENTRIES_PER_SEGMENT,
            }).export();
            publishedEntries += published.entries;
            publishedSegments += published.segments;
          }
        }),
      );
      expect(publishedEntries).toBe(BENCH_EVENTS);
      segments = publishedSegments;

      const path = freshPath();
      const importer = openStore(path, IMPORTER_ID);
      const folder = createFolderSync({
        dir,
        store: importer,
        replica: createReplica({ store: importer, clock }),
        entriesPerSegment: ENTRIES_PER_SEGMENT,
      });
      let result: FolderImportReport | undefined;
      imported.push(
        await timedAsync(async () => {
          result = await folder.import();
        }),
      );
      expect(result?.inserted).toBe(BENCH_EVENTS);
      expect(result?.rejected).toBe(0);
      expect(result?.corruptSegments).toEqual([]);
      expect(importer.entryCount()).toBe(BENCH_EVENTS);
      await importer.close();
      rmSync(dir, { recursive: true, force: true });
      dropDatabase(path);
    }
    for (const store of sources.values()) await store.close();
    for (const path of sourcePaths) dropDatabase(path);

    const exportStats = summarize(exported);
    const importStats = summarize(imported);
    report(`экспорт 500k (${segments} сегментов по 1000)`, exportStats);
    report('импорт 500k', importStats);
    warnOnRegression('экспорт 500k', exportStats.median, BASE_MS.exportAll);
    warnOnRegression('импорт 500k', importStats.median, BASE_MS.importAll);
  });
});
