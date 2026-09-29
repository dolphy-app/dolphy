/**
 * T-39: батарея угроз (30 случаев) по профилям. Профиль `full`
 * (`node:sqlite` + authorizer + limits) выбирается пробой возможностей, а не
 * версией Node: 0 случаев `X`, 27 заблокированы, 3 безвредны. Запасной
 * (`query_only` + read-only + префильтр): единственная допустимая `X` —
 * чтение скрытой таблицы самой фикстуры (фикстура публична). Матрица B/A/X
 * по случаям — снимок спайка (`fixtures/battery-expected.json`).
 */
import { mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { profileOf } from '../../src/drivers.ts';
import type { DriverId } from '../../src/types.ts';
import {
  AVAILABLE_DRIVERS,
  HAS_BETTER_SQLITE3,
  HAS_FULL_PROFILE,
} from '../helpers/capabilities.ts';
import { THREATS, createSecretDb, runThreat } from '../helpers/battery.ts';
import type { Outcome, ProfileName } from '../helpers/battery.ts';
import expected from '../fixtures/battery-expected.json' with { type: 'json' };
import { useTmpDir } from '../helpers/tmp.ts';

const tmp = useTmpDir();

type Matrix = Record<string, Outcome>;

const matrixOf = async (
  driver: DriverId,
  profile: ProfileName,
): Promise<Matrix> => {
  const matrix: Matrix = {};
  for (const threat of THREATS) {
    const dir = await tmp.make();
    mkdirSync(dir, { recursive: true });
    createSecretDb(dir);
    matrix[threat.id] = runThreat(driver, profile, threat, dir);
  }
  return matrix;
};

const count = (matrix: Matrix, outcome: Outcome) =>
  Object.values(matrix).filter((value) => value === outcome).length;

const effectsOf = (matrix: Matrix) =>
  Object.entries(matrix)
    .filter(([, value]) => value === 'X')
    .map(([id]) => id);

describe('батарея угроз', () => {
  it('30 случаев, снимок спайка полон', () => {
    expect(THREATS).toHaveLength(30);
    for (const key of ['full', 'fullNoPrefilter', 'fallback'] as const) {
      expect(Object.keys(expected[key]).sort()).toEqual(
        THREATS.map(({ id }) => id).sort(),
      );
    }
  });

  describe('профиль full: node:sqlite с authorizer, limits, defensive', () => {
    it.skipIf(!HAS_FULL_PROFILE)(
      '0 эффектов, матрица равна снимку (с префильтром)',
      async () => {
        const matrix = await matrixOf('node-sqlite', 'full');
        expect(effectsOf(matrix)).toEqual([]);
        expect(matrix).toEqual(expected.full);
      },
    );

    it.skipIf(!HAS_FULL_PROFILE)(
      'без префильтра: authorizer сам держит 27 из 30, 0 эффектов, 3 безвредны',
      async () => {
        const matrix = await matrixOf('node-sqlite', 'noPrefilter');
        expect(effectsOf(matrix)).toEqual([]);
        expect(count(matrix, 'B')).toBe(27);
        expect(count(matrix, 'A')).toBe(3);
        expect(matrix).toEqual(expected.fullNoPrefilter);
        // безвредные: интроспекция и «SELECT 1; …» (node:sqlite исполняет только первый оператор)
        expect(
          Object.entries(matrix)
            .filter(([, value]) => value === 'A')
            .map(([id]) => id)
            .sort(),
        ).toEqual(['dbstat', 'multi-stmt', 'sqlite_master']);
      },
    );
  });

  describe.each(AVAILABLE_DRIVERS)('запасной профиль на %s', (driver) => {
    const fallback = profileOf(driver) === 'fallback';

    it.skipIf(!fallback)(
      'единственная допустимая X — скрытая таблица самой фикстуры',
      async () => {
        const matrix = await matrixOf(driver, 'full');
        expect(effectsOf(matrix)).toEqual(['hidden-table']);
        expect(matrix).toEqual(expected.fallback);
      },
    );

    it.skipIf(!fallback || driver !== 'better-sqlite3')(
      'префильтр несущий: без него ATTACH чужой БД, VACUUM INTO и скрытая таблица дают X',
      async () => {
        const matrix = await matrixOf(driver, 'noPrefilter');
        expect(effectsOf(matrix).sort()).toEqual([
          'attach-read-other-db',
          'hidden-table',
          'vacuum-into',
        ]);
        expect(matrix).toEqual(expected.fallbackNoPrefilter);
      },
    );
  });

  it.skipIf(!HAS_BETTER_SQLITE3)(
    'запасной профиль на better-sqlite3 не зависит от Node: результат совпадает с эталоном при любом рантайме',
    async () => {
      const matrix = await matrixOf('better-sqlite3', 'full');
      expect(matrix).toEqual(expected.fallback);
    },
  );
});
