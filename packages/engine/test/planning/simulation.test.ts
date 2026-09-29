/**
 * T-56: симуляция обучения (порт `spike/fire-plan/src/sim.ts`): бюджет 40,
 * режимы none/trane/sparse, политики P0/P1/P2. Полный прогон — 6 seed × 90
 * дней (`ENGINE_FULL_SIM=1`); по умолчанию — облегчённый, те же проверки.
 * Утверждения — инварианты и неравенства, без точных чисел таблицы отчёта.
 */
import { describe, expect, test } from 'vitest';
import { meanOver, runSim, simParams } from './sim.ts';
import type { Policy, SimResult } from './sim.ts';
import type { Regime } from './helpers.ts';

const FULL = process.env['ENGINE_FULL_SIM'] === '1';
const SEEDS = FULL ? [1, 2, 3, 4, 5, 6] : [1, 2];
const DAYS = FULL ? 90 : 45;
const BUDGET = 40;

const cache = new Map<string, SimResult>();
const simulate = (
  regime: Regime,
  policy: Policy,
  seed: number,
  truthHasCredit = true,
  implicitEnabled?: boolean,
): SimResult => {
  const key = `${regime}/${policy}/${seed}/${truthHasCredit}/${implicitEnabled}`;
  let result = cache.get(key);
  if (result === undefined) {
    result = runSim(
      simParams({
        regime,
        policy,
        seed,
        budget: BUDGET,
        days: DAYS,
        truthHasCredit,
        ...(implicitEnabled === undefined ? {} : { implicitEnabled }),
      }),
    );
    cache.set(key, result);
  }
  return result;
};
const overSeeds = (
  regime: Regime,
  policy: Policy,
  truthHasCredit = true,
): SimResult[] =>
  SEEDS.map((seed) => simulate(regime, policy, seed, truthHasCredit));

describe(`study simulation (${SEEDS.length} seeds x ${DAYS} days, budget ${BUDGET}) (T-56)`, () => {
  test('plans respect the budget and the learner actually studies', () => {
    for (const policy of ['P0', 'P1', 'P2'] as const) {
      for (const seed of SEEDS) {
        const result = simulate('trane', policy, seed);
        expect(result.planSeries).toHaveLength(DAYS);
        for (const day of result.planSeries) {
          expect(day.length).toBeLessThanOrEqual(BUDGET);
          expect(new Set(day).size).toBe(day.length);
        }
        expect(result.donePerDay).toBeGreaterThan(BUDGET / 2);
        expect(result.exercisesIntroduced).toBeGreaterThan(0);
        expect(result.successRate).toBeGreaterThan(0.5);
      }
    }
  });

  test('(a) implicitCredit.enabled = false gives the P0 plan, with zero implicit updates', () => {
    for (const seed of SEEDS) {
      const baseline = simulate('trane', 'P0', seed);
      expect(baseline.implicitPerAttempt).toBe(0);
      for (const policy of ['P1', 'P2'] as const) {
        const disabled = simulate('trane', policy, seed, true, false);
        expect(disabled.implicitPerAttempt).toBe(0);
        expect(disabled.planSeries).toEqual(baseline.planSeries);
        expect(disabled).toEqual(baseline);
      }
      // с кредитом результат отличается: проверка не пуста
      const enabled = simulate('trane', 'P2', seed);
      expect(enabled.implicitPerAttempt).toBeGreaterThan(1);
      expect(enabled.planSeries).not.toEqual(baseline.planSeries);
    }
  });

  test('(b) without encompass edges (none) P0 = P1 = P2 bit for bit', () => {
    for (const seed of SEEDS) {
      const p0 = simulate('none', 'P0', seed);
      expect(simulate('none', 'P1', seed)).toEqual(p0);
      expect(simulate('none', 'P2', seed)).toEqual(p0);
      expect(p0.implicitPerAttempt).toBe(0);
    }
  });

  test('(c) two runs with one seed give one result; a different seed differs', () => {
    for (const policy of ['P0', 'P2'] as const) {
      const again = runSim(
        simParams({
          regime: 'sparse',
          policy,
          seed: SEEDS[0] as number,
          budget: BUDGET,
          days: DAYS,
        }),
      );
      expect(again).toEqual(simulate('sparse', policy, SEEDS[0] as number));
    }
    expect(simulate('trane', 'P0', 1).planSeries).not.toEqual(
      simulate('trane', 'P0', 2).planSeries,
    );
  });

  test('(d) without implicit repetition in the learner, credit policies P1 and P2 keep less R>=0.8 than P0 on every seed (trane)', () => {
    for (const seed of SEEDS) {
      const p0 = simulate('trane', 'P0', seed, false).shareR80;
      const p1 = simulate('trane', 'P1', seed, false).shareR80;
      const p2 = simulate('trane', 'P2', seed, false).shareR80;
      expect(p1, `seed ${seed}`).toBeLessThan(p0);
      expect(p2, `seed ${seed}`).toBeLessThan(p0);
    }
    const means = (['P0', 'P1', 'P2'] as const).map((policy) =>
      meanOver(overSeeds('trane', policy, false), 'shareR80'),
    );
    console.log(
      `robust trane R>=0.8: P0 ${means[0]?.toFixed(3)}, P1 ${means[1]?.toFixed(3)}, P2 ${means[2]?.toFixed(3)}`,
    );
  });

  test.each(['trane', 'sparse'] as const)(
    '(e) main table invariants when the learner also gets implicit credit (%s): the due queue shrinks, more lessons get introduced',
    (regime) => {
      const p0 = overSeeds(regime, 'P0');
      const p1 = overSeeds(regime, 'P1');
      const p2 = overSeeds(regime, 'P2');
      const backlog = (results: SimResult[]) =>
        meanOver(results, 'backlogMean');
      const lessons = (results: SimResult[]) =>
        meanOver(results, 'lessonsIntroduced');
      console.log(
        `${regime}: backlog P0 ${backlog(p0).toFixed(1)} P1 ${backlog(p1).toFixed(1)} P2 ${backlog(p2).toFixed(1)}; lessons P0 ${lessons(p0).toFixed(1)} P1 ${lessons(p1).toFixed(1)} P2 ${lessons(p2).toFixed(1)}`,
      );
      const factor = regime === 'trane' ? 0.5 : 0.9;
      expect(backlog(p1)).toBeLessThan(backlog(p0) * factor);
      expect(backlog(p2)).toBeLessThan(backlog(p0) * factor);
      expect(lessons(p2)).toBeGreaterThanOrEqual(lessons(p1));
      expect(lessons(p1)).toBeGreaterThanOrEqual(lessons(p0));
      expect(lessons(p2)).toBeGreaterThan(lessons(p0));
      // сжатие видно в плане: у P2 в среднем больше покрытий на повтор, чем у P1
      expect(meanOver(p2, 'coversPerReviewItem')).toBeGreaterThan(1);
      expect(meanOver(p1, 'coversPerReviewItem')).toBe(1);
      expect(meanOver(p0, 'coversPerReviewItem')).toBe(1);
    },
  );
});
