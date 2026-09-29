/**
 * T-41 (контракт Verifier) и T-42 (kill и watchdog): `createSqlVerifier` над
 * пулом настоящих дочерних процессов. Границы по времени — односторонние,
 * с запасом: тесты гоняются рядом с другими пакетами.
 */
import { fileURLToPath } from 'node:url';
import { silentLogger } from '@lms/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPoolSize } from '../../src/pool.ts';
import { createSqlVerifier } from '../../src/verifier.ts';
import {
  HAS_BETTER_SQLITE3,
  HAS_FULL_PROFILE,
} from '../helpers/capabilities.ts';
import {
  EXPECTED_PATH,
  FIXTURE_PATH,
  INFINITE_CTE,
  createTestVerifiers,
  defaultFiles,
  detailOf,
  exitOf,
  isAlive,
  logText,
  recordSpawns,
  sqlExercise,
  sqlRequest,
  waitFor,
} from '../helpers/verifier.ts';
import { createFilesSource } from '../helpers/files-source.ts';

const HANG_WORKER = fileURLToPath(
  new URL('../helpers/hang-worker.ts', import.meta.url),
);
const CRASH_WORKER = fileURLToPath(
  new URL('../helpers/crash-worker.ts', import.meta.url),
);

const verifiers = createTestVerifiers();
afterEach(() => verifiers.closeAll());

describe('вердикты через порт Verifier', () => {
  it('passed: результат совпал', async () => {
    const { verifier } = verifiers.make();
    const verdict = await verifier.check(
      sqlRequest('SELECT count(*) AS n FROM emp'),
    );
    expect(verdict).toMatchObject({ outcome: 'passed', rowCount: 1 });
  });

  it('failed/mismatch — вина ученика; ожидаемых значений в вердикте нет', async () => {
    const { verifier } = verifiers.make();
    const verdict = await verifier.check(sqlRequest('SELECT 7 AS n'));
    expect(verdict).toMatchObject({ outcome: 'failed', reason: 'mismatch' });
    expect(JSON.stringify(verdict)).not.toContain('"6"');
    expect(verdict).not.toHaveProperty('detail');
  });

  it('failed/sql_error и failed/forbidden без текстов SQLite', async () => {
    const { verifier } = verifiers.make();
    const syntax = await verifier.check(sqlRequest('SELEC 1'));
    expect(syntax).toMatchObject({ outcome: 'failed', reason: 'sql_error' });
    expect(JSON.stringify(syntax)).not.toMatch(/syntax error|near/iu);
    const drop = await verifier.check(sqlRequest('DROP TABLE emp'));
    expect(drop).toMatchObject({ outcome: 'failed', reason: 'forbidden' });
  });

  it('кап строк и байт берётся из verification и потолков раннера', async () => {
    const { verifier } = verifiers.make();
    const rows =
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 1000) SELECT x AS n FROM c';
    const capped = await verifier.check(
      sqlRequest(rows, { exercise: sqlExercise({ maxRows: 10 }) }),
    );
    expect(capped).toMatchObject({ outcome: 'failed', reason: 'row_limit' });
    const bytes = await verifier.check(
      sqlRequest('SELECT hex(randomblob(2000)) AS n', {
        exercise: sqlExercise({ maxBytes: 1000 }),
      }),
    );
    expect(bytes).toMatchObject({ outcome: 'failed', reason: 'byte_limit' });
  });

  it('правила сравнения из verification: orderSensitive, columnOrder, tolerance', async () => {
    const files = {
      ...defaultFiles(),
      'checks/order.csv': 'name\nAnn\nBob\n',
    };
    const { verifier } = verifiers.make(files);
    const sql = 'SELECT name FROM emp WHERE id <= 2 ORDER BY name DESC';
    const unordered = await verifier.check(
      sqlRequest(sql, {
        exercise: sqlExercise({ expected: 'checks/order.csv' }),
      }),
    );
    expect(unordered.outcome).toBe('passed');
    const ordered = await verifier.check(
      sqlRequest(sql, {
        exercise: sqlExercise({
          expected: 'checks/order.csv',
          orderSensitive: true,
        }),
      }),
    );
    expect(ordered).toMatchObject({ outcome: 'failed', reason: 'mismatch' });
  });

  it('режим автора: в detail ожидаемые строки и текст SQLite, в feedback — причины error', async () => {
    const { verifier } = verifiers.make();
    const mismatch = await verifier.check(
      sqlRequest('SELECT 7 AS n', { authorMode: true }),
    );
    expect(mismatch).toMatchObject({ outcome: 'failed', reason: 'mismatch' });
    expect(detailOf(mismatch)).toContain('expected');
    const sqlError = await verifier.check(
      sqlRequest('SELECT * FROM nope', { authorMode: true }),
    );
    expect(detailOf(sqlError)).toMatch(/no such table/u);
    const { verifier: broken } = verifiers.make({});
    const fixture = await broken.check(
      sqlRequest('SELECT 1', { authorMode: true }),
    );
    expect(fixture).toMatchObject({
      outcome: 'error',
      reason: 'fixture_error',
    });
    expect(fixture.feedback).toContain(FIXTURE_PATH);
    const learner = await broken.check(sqlRequest('SELECT 1'));
    expect(learner).not.toHaveProperty('feedback');
  });

  it('ошибки курса — error, не вина ученика: нет фикстуры, нет ожидаемого, битый CSV, битый блок', async () => {
    const noFixture = verifiers.make({ [EXPECTED_PATH]: 'n\n6\n' });
    expect(
      await noFixture.verifier.check(sqlRequest('SELECT 1')),
    ).toMatchObject({
      outcome: 'error',
      reason: 'fixture_error',
    });
    const noExpected = verifiers.make({
      [FIXTURE_PATH]: defaultFiles()[FIXTURE_PATH] as string,
    });
    expect(
      await noExpected.verifier.check(sqlRequest('SELECT 1')),
    ).toMatchObject({
      outcome: 'error',
      reason: 'expected_error',
    });
    const badCsv = verifiers.make({
      ...defaultFiles(),
      [EXPECTED_PATH]: 'a,b\n1',
    });
    expect(await badCsv.verifier.check(sqlRequest('SELECT 1'))).toMatchObject({
      outcome: 'error',
      reason: 'expected_error',
    });
    const badFixture = verifiers.make({
      ...defaultFiles(),
      [FIXTURE_PATH]: 'CREATE TABL x',
    });
    expect(
      await badFixture.verifier.check(sqlRequest('SELECT 1')),
    ).toMatchObject({
      outcome: 'error',
      reason: 'fixture_error',
    });
    const { verifier } = verifiers.make();
    const badBlock = await verifier.check(
      sqlRequest('SELECT 1', {
        exercise: sqlExercise({ orderSensitive: 'yes' }),
      }),
    );
    expect(badBlock).toMatchObject({
      outcome: 'error',
      reason: 'expected_error',
    });
  });

  it('чужой раннер и не-SQL ответ — error/internal (баг вызывающего)', async () => {
    const { verifier } = verifiers.make();
    const foreign = await verifier.check(
      sqlRequest('SELECT 1', {
        exercise: sqlExercise({ runner: 'json' }),
      }),
    );
    expect(foreign).toMatchObject({ outcome: 'error', reason: 'internal' });
    const text = await verifier.check(
      sqlRequest('', { submission: { kind: 'text', text: 'SELECT 1' } }),
    );
    expect(text).toMatchObject({ outcome: 'error', reason: 'internal' });
  });

  it('SQL длиннее MAX_SQL_CHARS отвергается в хосте до IPC: процесс даже не порождён', async () => {
    const { verifier } = verifiers.make();
    const verdict = await verifier.check(
      sqlRequest(`SELECT 1 AS n${' '.repeat(100_001)}`),
    );
    expect(verdict).toMatchObject({
      outcome: 'failed',
      reason: 'sqlite_limit',
    });
    expect(verifier.stats()).toMatchObject({ spawned: 0, checks: 0 });
  });

  it('фикстура и ожидаемый CSV читаются один раз; правка файла подхватывается', async () => {
    const { verifier, source } = verifiers.make();
    await verifier.check(sqlRequest('SELECT count(*) AS n FROM emp'));
    await verifier.check(sqlRequest('SELECT count(*) AS n FROM emp'));
    expect(source.reads).toEqual([FIXTURE_PATH, EXPECTED_PATH]);
    source.set(EXPECTED_PATH, 'n\n7\n');
    const verdict = await verifier.check(
      sqlRequest('SELECT count(*) AS n FROM emp'),
    );
    expect(verdict).toMatchObject({ outcome: 'failed', reason: 'mismatch' });
  });

  it('info(): драйвер и профиль раннера', async () => {
    const { verifier } = verifiers.make();
    const info = await verifier.info();
    expect(['node-sqlite', 'better-sqlite3']).toContain(info.driver);
    expect(info.profile).toBe(
      info.driver === 'node-sqlite' && HAS_FULL_PROFILE ? 'full' : 'fallback',
    );
  });

  it.skipIf(!HAS_BETTER_SQLITE3)(
    'better-sqlite3 выбирается явно: запасной профиль и те же вердикты',
    async () => {
      const { verifier } = verifiers.make(defaultFiles(), {
        driver: 'better-sqlite3',
      });
      expect(await verifier.info()).toEqual({
        driver: 'better-sqlite3',
        profile: 'fallback',
      });
      expect(
        await verifier.check(sqlRequest('SELECT count(*) AS n FROM emp')),
      ).toMatchObject({ outcome: 'passed' });
    },
  );
});

describe('kill и watchdog (T-42)', () => {
  it('(а) бесконечный CTE → error/timeout, процесс убит SIGKILL, следующая проверка на новом процессе', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      spawnWorker: spawns.spawnWorker,
      killGraceMs: 100,
    });
    const first = await verifier.check(
      sqlRequest('SELECT count(*) AS n FROM emp'),
    );
    expect(first.outcome).toBe('passed');
    const [victim] = spawns.children;
    const started = performance.now();
    const verdict = await verifier.check(
      sqlRequest(INFINITE_CTE, { timeoutMs: 500 }),
    );
    const elapsed = performance.now() - started;
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'timeout' });
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(6000);
    expect(victim?.signalCode).toBe('SIGKILL');
    expect(verifier.stats().kills).toBe(1);
    const next = await verifier.check(
      sqlRequest('SELECT count(*) AS n FROM emp'),
    );
    expect(next.outcome).toBe('passed');
    expect(spawns.children.length).toBeGreaterThanOrEqual(2);
    expect(spawns.children.at(-1)).not.toBe(victim);
  });

  it('пул респавнит убитые процессы в фоне до полного размера', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      size: 2,
      spawnWorker: spawns.spawnWorker,
    });
    await verifier.warm();
    expect(verifier.pids()).toHaveLength(2);
    const verdict = await verifier.check(
      sqlRequest(INFINITE_CTE, { timeoutMs: 300 }),
    );
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'timeout' });
    const victim = spawns.children.find(
      ({ signalCode }) => signalCode === 'SIGKILL',
    );
    expect(victim?.pid).toBeDefined();
    await waitFor(() => verifier.pids().length === 2);
    expect(verifier.pids()).not.toContain(victim?.pid);
  });

  it('(в) процесс умер сам посреди проверки → error/worker_crash, пул восстанавливается', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      spawnWorker: spawns.spawnWorker,
    });
    await verifier.warm();
    const pending = verifier.check(
      sqlRequest(INFINITE_CTE, { timeoutMs: 10_000 }),
    );
    await waitFor(() => verifier.stats().checks === 1);
    spawns.children[0]?.kill('SIGKILL');
    const verdict = await pending;
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'worker_crash' });
    expect(verifier.stats().crashes).toBe(1);
    const next = await verifier.check(
      sqlRequest('SELECT count(*) AS n FROM emp'),
    );
    expect(next.outcome).toBe('passed');
  });

  it('(в) молчание дольше timeoutMs + grace → kill и error/timeout', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      workerPath: HANG_WORKER,
      spawnWorker: spawns.spawnWorker,
      killGraceMs: 50,
    });
    const started = performance.now();
    const verdict = await verifier.check(
      sqlRequest('SELECT 1 AS n', { timeoutMs: 200 }),
    );
    const elapsed = performance.now() - started;
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'timeout' });
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(6000);
    const [child] = spawns.children;
    expect(await exitOf(child as NonNullable<typeof child>)).toMatchObject({
      signal: 'SIGKILL',
    });
  });

  it('процесс не поднялся → error/worker_crash со stderr в логе; warm() отказывает', async () => {
    const { verifier } = verifiers.make(defaultFiles(), {
      workerPath: CRASH_WORKER,
    });
    const verdict = await verifier.check(sqlRequest('SELECT 1 AS n'));
    expect(verdict).toMatchObject({ outcome: 'error', reason: 'worker_crash' });
    expect(logText(verifiers.logs)).toContain('boom at startup');
    await expect(verifier.warm()).rejects.toThrow(/failed to start/u);
  });

  it('(г) close() во время бесконечного запроса возвращается быстро, сирот нет', async () => {
    const { verifier } = verifiers.make(defaultFiles(), { size: 2 });
    await verifier.warm();
    const pids = verifier.pids();
    expect(pids).toHaveLength(2);
    const pending = verifier.check(
      sqlRequest(INFINITE_CTE, { timeoutMs: 30_000 }),
    );
    await waitFor(() => verifier.stats().checks === 1);
    const started = performance.now();
    await verifier.close();
    expect(performance.now() - started).toBeLessThan(6000);
    expect(await pending).toMatchObject({
      outcome: 'error',
      reason: 'internal',
    });
    for (const pid of pids) expect(isAlive(pid), `pid ${pid}`).toBe(false);
    expect(await verifier.check(sqlRequest('SELECT 1 AS n'))).toMatchObject({
      outcome: 'error',
      reason: 'internal',
    });
  });

  it('наблюдатель RSS убивает процесс по порогу (подставной счётчик памяти)', async () => {
    let polls = 0;
    const { verifier } = verifiers.make(defaultFiles(), {
      readRssKb: async () => {
        polls++;
        return 900 * 1024;
      },
      maxRssKb: 400 * 1024,
      rssPollMs: 20,
    });
    const started = performance.now();
    const verdict = await verifier.check(
      sqlRequest(INFINITE_CTE, { timeoutMs: 10_000 }),
    );
    expect(verdict).toMatchObject({
      outcome: 'error',
      reason: 'resource_kill',
    });
    expect(performance.now() - started).toBeLessThan(6000);
    expect(polls).toBeGreaterThan(0);
    expect(verifier.stats().kills).toBe(1);
  });

  it.skipIf(!HAS_BETTER_SQLITE3)(
    '(б) запасной профиль: удвоение строки убивается по порогу RSS настоящим ps',
    async () => {
      const { verifier } = verifiers.make(defaultFiles(), {
        driver: 'better-sqlite3',
        maxRssKb: 250 * 1024,
        rssPollMs: 20,
      });
      const started = performance.now();
      const verdict = await verifier.check(
        sqlRequest(
          "WITH RECURSIVE d(s, k) AS (SELECT 'x', 0 UNION ALL SELECT s||s, k+1 FROM d WHERE k < 30) SELECT max(length(s)) AS n FROM d",
          { timeoutMs: 10_000 },
        ),
      );
      expect(verdict).toMatchObject({
        outcome: 'error',
        reason: 'resource_kill',
      });
      expect(performance.now() - started).toBeLessThan(15_000);
      const next = await verifier.check(
        sqlRequest('SELECT count(*) AS n FROM emp'),
      );
      expect(next.outcome).toBe('passed');
    },
  );

  it.skipIf(!HAS_FULL_PROFILE)(
    '(б) профиль full: db.limits.length отсекает те же запросы без kill и без роста RSS',
    async () => {
      const { verifier } = verifiers.make(defaultFiles(), {
        driver: 'node-sqlite',
      });
      for (const sql of [
        'SELECT length(randomblob(1000000000)) AS n',
        'SELECT length(zeroblob(1000000000)) AS n',
        "WITH RECURSIVE d(s, k) AS (SELECT 'x', 0 UNION ALL SELECT s||s, k+1 FROM d WHERE k < 30) SELECT max(length(s)) AS n FROM d",
      ]) {
        expect(await verifier.check(sqlRequest(sql)), sql).toMatchObject({
          outcome: 'failed',
          reason: 'sqlite_limit',
        });
      }
      expect(verifier.stats().kills).toBe(0);
    },
  );
  it('счётчик памяти недоступен (-1) — наблюдатель молчит, проверка не убивается', async () => {
    let polls = 0;
    const { verifier } = verifiers.make(
      { ...defaultFiles(), 'checks/big.csv': 'n\n1500000\n' },
      {
        readRssKb: async () => {
          polls++;
          return -1;
        },
        rssPollMs: 10,
      },
    );
    const verdict = await verifier.check(
      sqlRequest(
        'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 1500000) SELECT count(*) AS n FROM c',
        {
          exercise: sqlExercise({ expected: 'checks/big.csv' }),
          timeoutMs: 20_000,
        },
      ),
    );
    expect(verdict.outcome).toBe('passed');
    expect(polls).toBeGreaterThan(0);
    expect(verifier.stats().kills).toBe(0);
  });

  it('дочерний процесс завершается при обрыве IPC (хост умер)', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      spawnWorker: spawns.spawnWorker,
    });
    await verifier.warm();
    const [child] = spawns.children;
    child?.disconnect();
    expect(await exitOf(child as NonNullable<typeof child>)).toMatchObject({
      code: 0,
    });
  });
});

describe('политика пула', () => {
  it('размер по умолчанию: min(4, cores − 1), не меньше 1', () => {
    expect([1, 2, 3, 4, 5, 8, 64].map(defaultPoolSize)).toEqual([
      1, 1, 2, 3, 4, 4, 4,
    ]);
  });

  it('процессов не больше size, лишние проверки ждут в очереди и проходят', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      size: 2,
      spawnWorker: spawns.spawnWorker,
    });
    const verdicts = await Promise.all(
      Array.from({ length: 8 }, () =>
        verifier.check(sqlRequest('SELECT count(*) AS n FROM emp')),
      ),
    );
    expect(verdicts.map(({ outcome }) => outcome)).toEqual(
      Array(8).fill('passed'),
    );
    expect(spawns.children).toHaveLength(2);
    expect(verifier.stats()).toMatchObject({ checks: 8, spawned: 2, kills: 0 });
  });

  it('recycleAfter: процесс заменяется после N проверок', async () => {
    const spawns = recordSpawns();
    const { verifier } = verifiers.make(defaultFiles(), {
      recycleAfter: 3,
      spawnWorker: spawns.spawnWorker,
    });
    for (let i = 0; i < 7; i++) {
      const verdict = await verifier.check(
        sqlRequest('SELECT count(*) AS n FROM emp'),
      );
      expect(verdict.outcome).toBe('passed');
    }
    expect(spawns.children).toHaveLength(3);
    expect(verifier.stats().recycled).toBe(2);
    expect(spawns.children[0]?.signalCode).toBe('SIGKILL');
  });

  it('RSS-наблюдатель обязателен: maxRssKb ≤ 0 — RangeError', () => {
    expect(() =>
      createSqlVerifier({
        source: createFilesSource({}),
        logger: silentLogger,
        maxRssKb: 0,
      }),
    ).toThrow(RangeError);
  });
});
