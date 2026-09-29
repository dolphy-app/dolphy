/**
 * Порт 31 `#[test]` из `mod test` Trane v0.34.1 `src/exercise_scorer.rs`
 * (строки 501-1723); имена тестов — имена функций Rust. Каждый тест идёт в
 * обеих числовых моделях: `f64` и двойник `f32` (`Math.fround`).
 *
 * Отступления: `Utc::now()` заменён фиксированным `NOW`, время в мс,
 * `i64::MAX/MIN` секунд — это ±2^63 с в мс.
 */
import { describe, expect, it } from 'vitest';
import type { ExerciseType } from '../../src/domain/manifest.ts';
import {
  type ExerciseDelta,
  type ExerciseTrial,
  F32_EPSILON,
  type Precision,
  TrialsNotSortedError,
  createPowerLawScorer,
} from '../../src/scoring/index.ts';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

/** Rust `generate_timestamp(num_days)`: метка `numDays` назад. */
const ts = (numDays: number) => NOW - numDays * DAY_MS;
const trials = (
  ...pairs: Array<[score: number, days: number]>
): ExerciseTrial[] =>
  pairs.map(([score, days]) => ({ score, timestamp: ts(days) }));
const deltas = (
  ...pairs: Array<[delta: number, days: number]>
): ExerciseDelta[] =>
  pairs.map(([delta, days]) => ({ delta, timestamp: ts(days) }));

describe.each(['f64', 'f32'] as Precision[])(
  'PowerLawScorer (%s)',
  (precision) => {
    const scorer = createPowerLawScorer({ precision });
    const { constants: c, internals } = scorer;
    const D: ExerciseType = 'Declarative';
    const P: ExerciseType = 'Procedural';
    const score = (
      type: ExerciseType,
      history: readonly ExerciseTrial[],
      pastDeltas: readonly ExerciseDelta[] = [],
      now = NOW,
    ) => scorer.score(type, history, pastDeltas, now);

    it('estimate_difficulty', () => {
      expect(internals.estimateDifficulty([])).toBe(c.BASE_DIFFICULTY);
      const easy = internals.estimateDifficulty(trials([5, 0], [4, 1], [5, 2]));
      expect(easy).toBeLessThan(3.0);
      const hard = internals.estimateDifficulty(trials([1, 0], [2, 1], [1, 2]));
      expect(hard).toBeGreaterThan(8.0);
      const medium = internals.estimateDifficulty(
        trials([3, 0], [4, 1], [2, 2]),
      );
      expect(medium).toBeGreaterThanOrEqual(4.0);
      expect(medium).toBeLessThan(7.0);
      const mixed = internals.estimateDifficulty(
        trials([3, 0], [1, 1], [2, 2], [5, 3], [5, 4]),
      );
      expect(mixed).toBeGreaterThan(4.0);
      expect(mixed).toBeLessThan(6.0);
    });

    it('no_previous_trials', () => {
      const result = score(D, [], []);
      expect(result.value).toBe(0.0);
      expect(result.urgency).toBe(1.0);
      expect(result.velocity).toBeNull();
    });

    it('score_trials', () => {
      const result = score(D, trials([3, 1], [4, 2], [5, 3]));
      expect(result.value).toBeGreaterThan(0.0);
      expect(result.value).toBeLessThanOrEqual(5.0);
      expect(result.value).toBeGreaterThan(2.0); // неплохо: свежие оценки хорошие
      expect(result.urgency).toBeGreaterThanOrEqual(0.0);
      expect(result.urgency).toBeLessThanOrEqual(1.0);
      expect(result.velocity as number).toBeLessThan(0.0);
    });

    it('invalid_timestamp', () => {
      const result = score(D, [{ score: 5.0, timestamp: ts(1e10) }]);
      expect(result.value).toBeGreaterThanOrEqual(0.0);
      expect(result.value).toBeLessThan(1.0); // низкая из-за долгого перерыва
      expect(result.urgency).toBeGreaterThanOrEqual(0.0);
      expect(result.urgency).toBeLessThanOrEqual(1.0);
    });

    it('extreme_timestamp_gap_does_not_overflow', () => {
      const i64Seconds = 2 ** 63; // i64::MAX/MIN не представимы в double
      const result = score(D, [
        { score: 5.0, timestamp: i64Seconds * 1000 },
        { score: 1.0, timestamp: -i64Seconds * 1000 },
      ]);
      expect(result.value).toBeGreaterThanOrEqual(0.0);
      expect(result.value).toBeLessThanOrEqual(5.0);
      expect(result.urgency).toBeGreaterThanOrEqual(0.0);
      expect(result.urgency).toBeLessThanOrEqual(1.0);
    });

    it('compute_stability', () => {
      // Как в Rust, список идёт от старых к новым (вопреки контракту скорера):
      // `computeStability` порядок не проверяет и зажимает отрицательные
      // интервалы в 0 дней, поэтому проверяется только разумный диапазон.
      const history = trials([1, 3], [5, 2], [3, 1]);
      const stability = internals.computeStability(
        D,
        history,
        c.BASE_DIFFICULTY,
      );
      expect(stability).toBeGreaterThan(0.0);
      expect(stability).toBeLessThan(2.0);
    });

    it('compute_stability_spacing_effect', () => {
      const short = trials([4, 1], [4, 2], [4, 3]);
      const long = trials([4, 1], [4, 10], [4, 30]);
      const shortSpacing = internals.computeStability(
        D,
        short,
        c.BASE_DIFFICULTY,
      );
      const longSpacing = internals.computeStability(
        D,
        long,
        c.BASE_DIFFICULTY,
      );
      expect(longSpacing).toBeGreaterThan(shortSpacing);
    });

    it('bad_score_reduces_stability', () => {
      const good = trials([3, 1], [3, 2], [3, 3]);
      const lapsed = trials([1, 1], [3, 2], [3, 3]);
      const success = internals.computeStability(D, good, c.BASE_DIFFICULTY);
      const lapse = internals.computeStability(D, lapsed, c.BASE_DIFFICULTY);
      expect(success).toBeGreaterThan(c.MIN_STABILITY);
      expect(lapse).toBeLessThan(success);
      expect(lapse).toBeGreaterThanOrEqual(c.MIN_STABILITY);
    });

    it('multiple_lapses_bounded', () => {
      const history = trials([1, 3], [1, 2], [1, 1]);
      const stability = internals.computeStability(
        D,
        history,
        c.BASE_DIFFICULTY,
      );
      expect(stability).toBeGreaterThanOrEqual(c.MIN_STABILITY);
      expect(stability).toBeLessThanOrEqual(c.DEFAULT_STABILITY);
    });

    it('high_stability_does_not_explode', () => {
      // Rust считает это в f32: `r` повторяет округление в прогоне f32 и
      // тождественна в f64.
      const r = precision === 'f32' ? Math.fround : (x: number) => x;
      const p = r(r(r(5.0 - c.GRADE_MIN) / c.GRADE_RANGE) - 0.5);
      const e = r(
        r(c.EASE_NUMERATOR_OFFSET - c.BASE_DIFFICULTY) / c.EASE_DENOMINATOR,
      );
      const gain = internals.computeSpacingGain(D, 0.0, c.MIN_STABILITY, p);
      const growth = r(r(r(c.STABILITY_COEFFICIENT * p) * e) * gain);

      let stability = c.MIN_STABILITY;
      for (let i = 0; i < 25; i++) {
        const grown = r(stability * r(1.0 + growth));
        const next = Math.min(
          Math.max(grown, c.MIN_STABILITY),
          c.MAX_STABILITY,
        );
        const relativeGain = r(r(next - stability) / stability);
        expect(relativeGain).toBeGreaterThanOrEqual(0.0);
        expect(relativeGain).toBeLessThanOrEqual(r(growth + F32_EPSILON));
        stability = next;
      }
      expect(stability).toBeLessThanOrEqual(c.MAX_STABILITY);
      expect(stability).toBeGreaterThanOrEqual(c.MIN_STABILITY);
    });

    it('compute_retrievability', () => {
      const s = c.DEFAULT_STABILITY;
      const recentD = internals.computeRetrievability(D, 0.01, s);
      const recentP = internals.computeRetrievability(P, 0.01, s);
      expect(recentD).toBeGreaterThan(0.9);
      expect(recentD).toBeGreaterThan(recentP);

      const oldD = internals.computeRetrievability(D, 10.0, s);
      const oldP = internals.computeRetrievability(P, 10.0, s);
      expect(oldD).toBeLessThan(0.6);
      expect(oldD).toBeGreaterThan(0.4);
      expect(oldD).toBeLessThan(oldP);

      const veryOldD = internals.computeRetrievability(D, 100.0, s);
      const veryOldP = internals.computeRetrievability(P, 100.0, s);
      expect(veryOldD).toBeLessThan(0.26);
      expect(veryOldD).toBeLessThan(veryOldP);
    });

    it('retrievability_at_stability_is_ninety_percent', () => {
      const s = c.DEFAULT_STABILITY;
      const target = c.TARGET_RETRIEVABILITY_AT_STABILITY;
      const declarative = internals.computeRetrievability(D, s, s);
      const procedural = internals.computeRetrievability(P, s, s);
      expect(Math.abs(declarative - target)).toBeLessThan(1e-6);
      expect(Math.abs(procedural - target)).toBeLessThan(1e-6);
    });

    it('compute_spacing_gain', () => {
      const s = c.DEFAULT_STABILITY;
      const shortGain = internals.computeSpacingGain(D, 0.0, s, 0.25);
      const longGain = internals.computeSpacingGain(D, 10.0, s, 0.25);
      const neutralGain = internals.computeSpacingGain(D, 10.0, s, 0.0);
      const failureGain = internals.computeSpacingGain(D, 10.0, s, -0.5);
      expect(shortGain).toBeGreaterThanOrEqual(1.0);
      expect(shortGain).toBeLessThanOrEqual(1.0 + c.SPACING_EFFECT_WEIGHT);
      expect(longGain).toBeGreaterThan(shortGain);
      expect(neutralGain).toBe(1.0);
      expect(failureGain).toBe(1.0);
    });

    it('intra_day_damping', () => {
      const at = (days: number) =>
        internals.applyStabilityTransition(
          D,
          c.DEFAULT_STABILITY,
          c.BASE_DIFFICULTY,
          5.0,
          days,
        );
      const halfDay = at(0.5);
      const oneDay = at(1.0);
      const twoDays = at(2.0);
      expect(halfDay).toBeGreaterThan(c.DEFAULT_STABILITY);
      expect(oneDay).toBeGreaterThan(c.DEFAULT_STABILITY);
      expect(twoDays).toBeGreaterThan(c.DEFAULT_STABILITY);
      expect(halfDay).toBeLessThan(oneDay);
    });

    it('compute_weighted_avg', () => {
      const average = (history: ExerciseTrial[]) =>
        internals.computeWeightedAvg(history, (trial) => trial.score);
      expect(average([])).toBe(0.0);
      expect(Math.abs(average(trials([5, 0])) - 5.0)).toBeLessThan(1e-6);
      // [5, 4, 3] при таком затухании даёт около 4.017.
      const three = average(trials([5, 0], [4, 1], [3, 2]));
      expect(Math.abs(three - 4.017)).toBeLessThan(0.01);
      // Неравномерные интервалы сильнее приглушают далёкие провалы.
      const dense = average(trials([5, 0], [1, 1], [1, 2]));
      const sparse = average(trials([5, 0], [1, 1], [1, 30]));
      expect(sparse).toBeGreaterThan(dense);
      // Очень старая история имеет минимальный вес, но заметна.
      const compact = average(trials([5, 0], [4, 1]));
      const withAncient = average(trials([5, 0], [4, 1], [1, 365]));
      expect(withAncient).toBeLessThan(compact);
      expect(withAncient).toBeGreaterThan(4.0);
    });

    it('apply_old_good_retrievability_floor', () => {
      const floor = (r: number, w: number, days: number, n: number) =>
        internals.applyOldGoodRetrievabilityFloor(r, w, days, n);
      expect(floor(0.2, 4.0, 80.0, 3)).toBe(c.OLD_GOOD_FLOOR);
      expect(floor(0.95, 4.0, 80.0, 3)).toBe(0.95);
      expect(floor(0.2, 3.4, 80.0, 3)).toBe(0.2);
      expect(floor(0.2, 4.0, 49.0, 3)).toBe(0.2);
      expect(floor(0.2, 4.0, 80.0, 1)).toBe(0.2);
    });

    it('score_bad_recent', () => {
      const history = trials([1, 3], [3, 7], [2, 10], [1, 13]);
      expect(score(D, history).value).toBeLessThan(2.0);
    });

    it('score_mixed_performance', () => {
      const history = trials(
        [3, 1],
        [4, 4],
        [2, 5],
        [5, 6],
        [3, 7],
        [4, 10],
        [2, 14],
        [3, 18],
        [4, 21],
        [3, 25],
      );
      const result = score(D, history);
      expect(result.value).toBeGreaterThan(1.0);
      expect(result.value).toBeLessThan(4.0);
    });

    it('score_unsorted_trials', () => {
      const unsorted = trials([3, 2], [4, 1]);
      expect(() => score(D, unsorted)).toThrow(TrialsNotSortedError);
      expect(() => score(D, unsorted)).toThrow(
        'Exercise trials not sorted in descending order by timestamp',
      );
    });

    it('score_old_timestamp', () => {
      expect(score(D, trials([5, 100])).value).toBeLessThan(3.0);
    });

    it('score_multiple_good', () => {
      const history = trials(
        [5, 0],
        [4, 1],
        [5, 2],
        [5, 3],
        [4, 4],
        [5, 5],
        [5, 6],
        [4, 7],
      );
      expect(score(D, history).value).toBeGreaterThan(4.0);
    });

    it('score_multiple_bad', () => {
      const history = trials(
        [1, 0],
        [2, 2],
        [1, 4],
        [4, 6],
        [2, 9],
        [1, 15],
        [1, 16],
        [2, 27],
      );
      expect(score(D, history).value).toBeLessThan(2.0);
    });

    it('score_old_good_trials', () => {
      const history = trials(
        [5, 200],
        [4, 210],
        [5, 213],
        [5, 248],
        [4, 256],
        [4, 270],
      );
      expect(score(P, history).value).toBeGreaterThanOrEqual(3.5);
      expect(score(D, history).value).toBeGreaterThanOrEqual(3.5);
    });

    it('score_very_good_old_trials', () => {
      const history = trials(
        [5, 400],
        [4, 410],
        [5, 411],
        [5, 420],
        [5, 430],
        [4, 431],
      );
      expect(score(P, history).value).toBeGreaterThanOrEqual(3.5);
      expect(score(D, history).value).toBeGreaterThanOrEqual(3.5);
    });

    it('urgency_increases_with_elapsed_time', () => {
      const recent = score(D, trials([5, 1]));
      const old = score(D, trials([5, 30]));
      expect(old.urgency).toBeGreaterThan(recent.urgency);
    });

    it('velocity_empty_trials', () => {
      expect(internals.velocity([])).toBeNull();
      expect(internals.velocity(trials([3, 0]))).toBeNull();
    });

    it('velocity_improving_scores', () => {
      // От новых к старым [5, 4, 3, 2, 1]: оценки со временем растут.
      const history = trials([5, 0], [4, 1], [3, 2], [2, 3], [1, 4]);
      expect(internals.velocity(history) as number).toBeGreaterThan(0.0);
    });

    it('velocity_worsening_scores', () => {
      const history = trials([1, 0], [2, 1], [3, 2], [4, 3], [5, 4]);
      expect(internals.velocity(history) as number).toBeLessThan(0.0);
    });

    it('velocity_constant_scores', () => {
      const history = trials([3, 0], [3, 1], [3, 2]);
      expect(Math.abs(internals.velocity(history) as number)).toBeLessThan(
        1e-6,
      );
    });

    it('score_with_positive_deltas', () => {
      const history = trials([3, 0], [4, 1], [4, 2]);
      const base = score(D, history, []);
      const boosted = score(D, history, deltas([0.5, 1], [1.2, 2]));
      expect(boosted.value).toBeGreaterThan(base.value);
    });

    it('score_with_negative_deltas', () => {
      const history = trials([3, 0], [4, 1], [4, 2]);
      const base = score(D, history, []);
      const reduced = score(D, history, deltas([-0.5, 1], [-0.8, 2]));
      expect(reduced.value).toBeLessThan(base.value);
    });
  },
);
