/**
 * T-41 (слой раннера): `passed`; `failed` — вина ученика; `error` — не вина.
 * Статус и код пинуются, текст `reason` — нет (`deep-subquery` даёт
 * `sqlite_limit` на одном драйвере и `sql_error` на другом; оба `failed`).
 */
import { describe, expect, it } from 'vitest';
import { runCheck } from '../../src/check.ts';
import type { CheckRequest } from '../../src/types.ts';
import { EMP_FIXTURE } from '../helpers/checks.ts';
import {
  AVAILABLE_DRIVERS,
  HAS_FULL_PROFILE,
} from '../helpers/capabilities.ts';

const base = (learnerSql: string): CheckRequest => ({
  fixtureSql: EMP_FIXTURE,
  learnerSql,
  expected: { csv: 'n\n6' },
});

describe.each(AVAILABLE_DRIVERS)('вердикты на %s (T-41)', (driver) => {
  it('синтаксическая ошибка и неизвестная таблица — failed/sql_error', () => {
    expect(runCheck(base('SELEC 1'), driver)).toMatchObject({
      status: 'failed',
      code: 'sql_error',
    });
    expect(
      runCheck(base('SELECT count(*) AS n FROM nope'), driver),
    ).toMatchObject({ status: 'failed', code: 'sql_error' });
  });

  it('запрещённое и не возвращающее данные — failed/forbidden', () => {
    for (const sql of [
      'DROP TABLE emp',
      "INSERT INTO emp VALUES (9,'z',1,1,1)",
      'SELECT 1; DROP TABLE emp',
      'WITH c AS (SELECT 1) DELETE FROM emp',
    ]) {
      expect(runCheck(base(sql), driver), sql).toMatchObject({
        status: 'failed',
        code: 'forbidden',
      });
    }
  });

  it('запрос без столбцов при выключенном префильтре — failed (драйвер, не префильтр)', () => {
    const request: CheckRequest = {
      ...base('WITH c AS (SELECT 1) DELETE FROM emp'),
      hardening: { prefilter: false },
    };
    expect(runCheck(request, driver).status).toBe('failed');
  });

  it('сломанная фикстура — error/fixture_error, не вина ученика', () => {
    const request = { ...base('SELECT 1'), fixtureSql: 'CREATE TABL x' };
    expect(runCheck(request, driver)).toMatchObject({
      status: 'error',
      code: 'fixture_error',
    });
  });

  it('сломанный ожидаемый CSV — error/expected_error', () => {
    const request = { ...base('SELECT 1'), expected: { csv: 'a,b\n1' } };
    expect(runCheck(request, driver)).toMatchObject({
      status: 'error',
      code: 'expected_error',
    });
  });

  it('кап строк — failed/row_limit', () => {
    const sql =
      'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 100000) SELECT x AS n FROM c';
    expect(
      runCheck({ ...base(sql), limits: { maxRows: 100 } }, driver),
    ).toMatchObject({ status: 'failed', code: 'row_limit' });
  });

  it('кап байт — failed/byte_limit', () => {
    const sql =
      'SELECT hex(randomblob(500)) AS n FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)';
    expect(
      runCheck({ ...base(sql), limits: { maxBytes: 1000 } }, driver),
    ).toMatchObject({ status: 'failed', code: 'byte_limit' });
  });

  it('ответ длиннее MAX_SQL_CHARS — failed/sqlite_limit до разбора и до фикстуры', () => {
    const request = {
      ...base(`SELECT 1 AS n${' '.repeat(200)}`),
      fixtureSql: 'CREATE TABL broken',
      limits: { maxSqlChars: 100 },
    };
    expect(runCheck(request, driver)).toMatchObject({
      status: 'failed',
      code: 'sqlite_limit',
    });
  });

  it('вложенные подзапросы глубже лимита SQLite — failed', () => {
    const depth = 5000;
    const sql = `SELECT ${'(SELECT '.repeat(depth)}1${')'.repeat(depth)} AS n`;
    expect(runCheck(base(sql), driver).status).toBe('failed');
  });

  it('ожидаемые строки и тексты SQLite скрыты, пока нет revealExpected', () => {
    const hidden = runCheck(base('SELECT 7 AS n'), driver);
    expect(hidden.detail).toBeUndefined();
    expect(hidden.reason).not.toContain('6');
    const revealed = runCheck(
      { ...base('SELECT 7 AS n'), revealExpected: true },
      driver,
    );
    expect(revealed.detail).toContain('expected');
    const sqlError = runCheck(
      { ...base('SELECT * FROM nope'), revealExpected: true },
      driver,
    );
    expect(sqlError.detail).toMatch(/no such table/u);
    expect(runCheck(base('SELECT * FROM nope'), driver).detail).toBeUndefined();
  });

  it('вердикт содержит rowCount и durationMs', () => {
    const verdict = runCheck(
      { ...base('SELECT count(*) AS n FROM emp') },
      driver,
    );
    expect(verdict).toMatchObject({ status: 'passed', rowCount: 1 });
    expect(verdict.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('профиль full: db.limits.length', () => {
  it.skipIf(!HAS_FULL_PROFILE)(
    'randomblob(1e9) и удвоение строки отсекаются за миллисекунды, без роста памяти',
    () => {
      const before = process.memoryUsage().rss;
      const started = performance.now();
      for (const sql of [
        'SELECT length(randomblob(1000000000)) AS n',
        'SELECT length(zeroblob(1000000000)) AS n',
        "WITH RECURSIVE d(s, k) AS (SELECT 'x', 0 UNION ALL SELECT s||s, k+1 FROM d WHERE k < 30) SELECT max(length(s)) AS n FROM d",
      ]) {
        expect(runCheck(base(sql), 'node-sqlite'), sql).toMatchObject({
          status: 'failed',
          code: 'sqlite_limit',
        });
      }
      expect(performance.now() - started).toBeLessThan(2000);
      expect(process.memoryUsage().rss - before).toBeLessThan(
        200 * 1024 * 1024,
      );
    },
  );
});
