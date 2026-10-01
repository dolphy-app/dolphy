/** Префильтр — удобство и сокращение поверхности, но не защита. */
import { describe, expect, it } from 'vitest';
import { prefilter } from '../../src/prefilter.ts';
import { MAX_SQL_CHARS } from '../../src/types.ts';

const check = (sql: string) => prefilter(sql, MAX_SQL_CHARS);

describe('prefilter', () => {
  it('принимает SELECT/WITH/VALUES, скобки, комментарии и хвостовую точку с запятой', () => {
    for (const sql of [
      'SELECT 1',
      'select 1;',
      '/* c */ SELECT 1;  ',
      '(SELECT 1)',
      'WITH c AS (SELECT 1) SELECT * FROM c',
      'VALUES (1)',
      "SELECT ';' -- ; x",
      'SELECT 1 AS [a;b]',
      'SELECT 1 AS `a;b`',
      'SELECT 1; -- done',
    ]) {
      expect(check(sql), sql).toEqual({ ok: true });
    }
  });

  it('отвергает второй оператор, спрятанный за комментарием или пробелами', () => {
    for (const sql of [
      'SELECT 1 /* ; */ ; DROP TABLE t',
      'SELECT 1; DROP TABLE t',
      'SELECT 1 /* \n */ ; DROP TABLE t',
    ]) {
      expect(check(sql), sql).toMatchObject({ ok: false, code: 'forbidden' });
    }
  });

  it('глаголы записи — forbidden, прочее не-SELECT — sql_error', () => {
    expect(check('DROP TABLE t')).toMatchObject({ code: 'forbidden' });
    expect(check("ATTACH DATABASE ':memory:' AS m")).toMatchObject({
      code: 'forbidden',
    });
    expect(check('/* x */ DROP TABLE t')).toMatchObject({ code: 'forbidden' });
    expect(check('hello')).toMatchObject({ code: 'sql_error' });
    expect(check('   ')).toMatchObject({ code: 'sql_error' });
  });

  it('NUL в тексте отвергается: SQLite обрезает текст по NUL', () => {
    expect(check('SELECT 1\0; DROP TABLE t')).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });

  it('кап длины до сканирования', () => {
    const outcome = prefilter('SELECT 1'.padEnd(200, ' '), 100);
    expect(outcome).toMatchObject({ ok: false, code: 'sql_too_long' });
  });

  it('WITH … DELETE префильтр пропускает: защита обязана быть в драйвере', () => {
    expect(check('WITH c AS (SELECT 1) DELETE FROM emp').ok).toBe(true);
  });

  it('50 МБ пробелов не раздувают память: отказ по длине, а не по сканированию', () => {
    const started = performance.now();
    const outcome = check(' '.repeat(50_000_000));
    expect(outcome).toMatchObject({ code: 'sql_too_long' });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
