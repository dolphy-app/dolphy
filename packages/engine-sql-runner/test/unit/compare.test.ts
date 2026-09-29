/** T-43 (сравнение результатов) и диалект ожидаемого CSV. */
import { describe, expect, it } from 'vitest';
import { compareResults, parseCsv } from '../../src/compare.ts';
import type { Cell, ResultSet } from '../../src/types.ts';

const set = (columns: string[], ...rows: Cell[][]): ResultSet => ({
  columns,
  rows,
});

describe('диалект CSV', () => {
  it('пусто = NULL, "" = пустая строка, кавычки = TEXT, целое и десятичное типизируются', () => {
    const parsed = parseCsv('a,b,c,d\n1,2.5,,""\n"7","x,y",z,-3e2\n');
    expect(parsed.rows).toEqual([
      [1n, 2.5, null, ''],
      ['7', 'x,y', 'z', -300],
    ]);
  });

  it('целые за пределами 2^53 читаются без потерь (bigint)', () => {
    const { rows } = parseCsv('n\n9007199254740993\n');
    expect(rows).toEqual([[9007199254740993n]]);
  });

  it('CRLF и экранированная кавычка', () => {
    const { rows } = parseCsv('a\r\n"say ""hi"""\r\n');
    expect(rows).toEqual([['say "hi"']]);
  });

  it('битый CSV — исключение (раннер отдаст expected_error)', () => {
    expect(() => parseCsv('a,b\n1')).toThrow(/record 2/u);
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated/u);
    expect(() => parseCsv('')).toThrow(/no header/u);
  });
});

describe('правила сравнения', () => {
  it('мультимножество по умолчанию; порядок учитывается только по orderSensitive', () => {
    const actual = set(['x'], [2n], [1n], [3n]);
    const expected = set(['x'], [1n], [2n], [3n]);
    expect(compareResults(actual, expected).equal).toBe(true);
    const ordered = compareResults(actual, expected, { orderSensitive: true });
    expect(ordered).toMatchObject({ equal: false, reason: 'row 1 differs' });
  });

  it('дубликаты считаются: DISTINCT вместо повторов — расхождение', () => {
    const actual = set(['x'], [1n], [2n]);
    const expected = set(['x'], [1n], [1n], [2n]);
    expect(compareResults(actual, expected)).toMatchObject({
      equal: false,
      reason: 'expected 3 row(s), got 2',
    });
  });

  it('1 == 1.0, TEXT "1" ≠ INTEGER 1, NULL == NULL', () => {
    expect(compareResults(set(['x'], [1]), set(['x'], [1n])).equal).toBe(true);
    expect(compareResults(set(['x'], ['1']), set(['x'], [1n])).equal).toBe(
      false,
    );
    expect(compareResults(set(['x'], [null]), set(['x'], [null])).equal).toBe(
      true,
    );
    expect(compareResults(set(['x'], [null]), set(['x'], [0n])).equal).toBe(
      false,
    );
  });

  it('допуск |a−b| ≤ tol·max(1,|a|,|b|): 0.1+0.2 vs 0.3 проходит, при tol=0 нет', () => {
    const actual = set(['x'], [0.1 + 0.2]);
    const expected = set(['x'], [0.3]);
    expect(compareResults(actual, expected).equal).toBe(true);
    expect(
      compareResults(actual, expected, { numericTolerance: 0 }).equal,
    ).toBe(false);
    // допуск относительный при больших значениях
    expect(
      compareResults(set(['x'], [1e12 + 100]), set(['x'], [1e12])).equal,
    ).toBe(true);
    expect(
      compareResults(set(['x'], [1e12 + 1e5]), set(['x'], [1e12])).equal,
    ).toBe(false);
  });

  it('bigint сравнивается точно, без допуска', () => {
    const outcome = compareResults(
      set(['x'], [9007199254740993n]),
      set(['x'], [9007199254740992n]),
    );
    expect(outcome.equal).toBe(false);
  });

  it('blob — побайтно', () => {
    const blob = (...bytes: number[]) => new Uint8Array(bytes);
    expect(
      compareResults(set(['x'], [blob(1, 2)]), set(['x'], [blob(1, 2)])).equal,
    ).toBe(true);
    expect(
      compareResults(set(['x'], [blob(1, 2)]), set(['x'], [blob(1, 3)])).equal,
    ).toBe(false);
  });

  it('имена столбцов без учёта регистра; ignoreColumnNames сравнивает по позициям', () => {
    const actual = set(['TOTAL'], [1n]);
    expect(compareResults(actual, set(['total'], [1n])).equal).toBe(true);
    const renamed = compareResults(actual, set(['sum'], [1n]));
    expect(renamed).toMatchObject({ equal: false });
    expect(renamed.reason).toContain('column 1');
    expect(
      compareResults(actual, set(['sum'], [1n]), { ignoreColumnNames: true })
        .equal,
    ).toBe(true);
  });

  it('columnOrder any: перестановка по именам и по значениям столбцов', () => {
    const actual = set(['name', 'id'], ['Eng', 1n]);
    const expected = set(['id', 'name'], [1n, 'Eng']);
    expect(compareResults(actual, expected).equal).toBe(false);
    expect(compareResults(actual, expected, { columnOrder: 'any' }).equal).toBe(
      true,
    );
    expect(
      compareResults(actual, set(['a', 'b'], [1n, 'Eng']), {
        columnOrder: 'any',
        ignoreColumnNames: true,
      }).equal,
    ).toBe(true);
    expect(
      compareResults(actual, set(['id', 'nope'], [1n, 'Eng']), {
        columnOrder: 'any',
      }).reason,
    ).toContain('missing column');
  });

  it('число столбцов: причина без ожидаемых значений, они — в detail', () => {
    const outcome = compareResults(set(['a', 'b'], [1n, 2n]), set(['a'], [1n]));
    expect(outcome.equal).toBe(false);
    expect(outcome.reason).toBe('expected 1 column(s), got 2');
    expect(outcome.detail).toContain('expected columns [a]');
  });

  it('detail строки называет ожидаемое значение, reason — нет', () => {
    const outcome = compareResults(set(['x'], [7n]), set(['x'], [42n]));
    expect(outcome.reason).not.toContain('42');
    expect(outcome.detail).toContain('42');
  });
});
