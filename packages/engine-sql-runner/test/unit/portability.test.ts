/**
 * T-40: переносимость. 41 проба (float, порядок без ORDER BY, оконные рамки,
 * деление и округление, COLLATE, JSON, даты, математика) на каждом
 * доступном драйвере; значения сравниваются как JS-значения (float
 * форматируется в JS, не в SQLite). 38 проб идентичны на
 * `node:sqlite`/better-sqlite3 × Node 22/24 (снимок спайка); три различаются
 * версией SQLite и проверяются пробой возможности, не версией.
 */
import { describe, expect, it } from 'vitest';
import { openSandbox } from '../../src/sandbox.ts';
import {
  AVAILABLE_DRIVERS,
  NO_HARDENING,
  driverHasFunction,
} from '../helpers/capabilities.ts';
import { EMP_FIXTURE } from '../helpers/checks.ts';
import expected from '../fixtures/portability-expected.json' with { type: 'json' };
import type { DriverId } from '../../src/types.ts';

const cellText = (cell: unknown): string => {
  if (typeof cell === 'bigint') return `i:${cell}`;
  if (typeof cell === 'number') {
    return `r:${Object.is(cell, -0) ? '-0' : String(cell)}`;
  }
  if (cell === null) return 'NULL';
  if (cell instanceof Uint8Array)
    return `b:${Buffer.from(cell).toString('hex')}`;
  return `t:${String(cell)}`;
};

/** Результат пробы одной строкой; текст ошибки SQLite не входит в сравнение. */
const probe = (driver: DriverId, sql: string): string => {
  const sandbox = openSandbox(driver, EMP_FIXTURE, NO_HARDENING);
  try {
    const statement = sandbox.prepare(sql);
    const columns = statement.columns();
    const rows = [...statement.iterate()].map((row) =>
      row.map(cellText).join(' | '),
    );
    return `[${columns.join(',')}] ${rows.join(' / ')}`;
  } catch {
    return 'ERROR';
  } finally {
    sandbox.close();
  }
};

describe('переносимость (T-40)', () => {
  it('снимок: 41 проба, 38 стабильных и 3 расходящихся', () => {
    expect(Object.keys(expected.stable)).toHaveLength(38);
    expect(expected.volatile).toHaveLength(3);
  });

  describe.each(AVAILABLE_DRIVERS)('%s', (driver) => {
    for (const [sql, want] of Object.entries(expected.stable)) {
      it(`стабильная проба: ${sql.slice(0, 70)}`, () => {
        expect(probe(driver, sql)).toBe(want);
      });
    }

    it('sqlite_version() — версия 3.x (само значение не сравнивается)', () => {
      expect(probe(driver, 'SELECT sqlite_version()')).toMatch(
        /t:3\.\d+\.\d+$/u,
      );
    });

    for (const name of ['median', 'percentile']) {
      const sql = expected.volatile.find((s) => s.includes(name));
      it(`${name}: результат только там, где функция есть в сборке (проба pragma_function_list)`, () => {
        if (sql === undefined) throw new Error(`нет пробы ${name}`);
        const result = probe(driver, sql);
        if (driverHasFunction(driver, name)) {
          expect(result).not.toBe('ERROR');
        } else expect(result).toBe('ERROR');
      });
    }
  });
});
