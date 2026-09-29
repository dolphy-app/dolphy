/**
 * Тесты `FsrsScorer` (вариант H): порт 12 тестов Rust-адаптера
 * `engine-ts/reference/fsrs-scorer` (`lib.rs`, `mod tests`), кроме проверки
 * длины параметров (её владеет `MemoryModel`), плюс T-06 и формула H.
 */
import { describe, expect, it } from 'vitest';
import type { ExerciseType } from '../../src/domain/manifest.ts';
import type { MemoryModel } from '../../src/ports/index.ts';
import {
  type ExerciseDelta,
  type ExerciseScore,
  type ExerciseTrial,
  NonFiniteScoreError,
  RATING_MAPS,
  type RatingMapName,
  createFsrsScorer,
  ratingOf,
} from '../../src/scoring/index.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const NOW = 1_700_000_000_000;
const D: ExerciseType = 'Declarative';
const P: ExerciseType = 'Procedural';

const memory: MemoryModel = createTsFsrsMemoryModel();
const RATING_MAP_NAMES: RatingMapName[] = ['runner', 'anki'];
const scorers = RATING_MAP_NAMES.map((ratingMap) => ({
  ratingMap,
  scorer: createFsrsScorer({ memory, ratingMap }),
}));

const trial = (score: number, timestamp: number): ExerciseTrial => ({
  score,
  timestamp,
});

const expectValid = (score: ExerciseScore) => {
  expect(Number.isFinite(score.value)).toBe(true);
  expect(score.value).toBeGreaterThanOrEqual(0);
  expect(score.value).toBeLessThanOrEqual(5);
  expect(Number.isFinite(score.urgency)).toBe(true);
  expect(score.urgency).toBeGreaterThanOrEqual(0);
  expect(score.urgency).toBeLessThanOrEqual(1);
  if (score.velocity !== null)
    expect(Number.isFinite(score.velocity)).toBe(true);
};

describe('RatingMap', () => {
  it('rating_maps: runner and anki tables', () => {
    const grades = [1, 2, 3, 4, 5];
    expect(grades.map((grade) => ratingOf('anki', grade))).toEqual([
      1, 1, 2, 3, 4,
    ]);
    expect(grades.map((grade) => ratingOf('runner', grade))).toEqual([
      1, 1, 2, 2, 3,
    ]);
    expect(ratingOf('anki', 3.6)).toBe(3);
    expect(RATING_MAPS.runner).toEqual([1, 1, 2, 2, 3]);
  });

  it('clamps out-of-range scores and rejects non-finite ones', () => {
    expect(ratingOf('anki', -3)).toBe(1);
    expect(ratingOf('anki', 1e30)).toBe(4);
    expect(() => ratingOf('anki', Number.NaN)).toThrow(NonFiniteScoreError);
    expect(() => ratingOf('runner', Infinity)).toThrow(
      'non-finite trial score',
    );
  });
});

describe.each(scorers)('FsrsScorer ($ratingMap)', ({ ratingMap, scorer }) => {
  it('empty_history', () => {
    expect(scorer.score(D, [], [], NOW)).toEqual({
      value: 0,
      urgency: 1,
      velocity: null,
    });
    expect(scorer.replay([])).toBeNull();
  });

  it('equal_and_out_of_order_timestamps', () => {
    const histories = [
      [trial(4, NOW), trial(4, NOW), trial(1, NOW)],
      [
        trial(1, NOW - 5 * DAY_MS),
        trial(5, NOW - DAY_MS),
        trial(4, NOW - 3 * DAY_MS),
      ],
    ];
    for (const history of histories) {
      expectValid(scorer.score(P, history, [], NOW));
    }
  });

  it('accepts ascending input: same result as the sorted history', () => {
    const newestFirst = [
      trial(5, NOW - DAY_MS),
      trial(3, NOW - 4 * DAY_MS),
      trial(1, NOW - 9 * DAY_MS),
    ];
    const oldestFirst = [...newestFirst].reverse();
    expect(scorer.score(D, oldestFirst, [], NOW)).toEqual(
      scorer.score(D, newestFirst, [], NOW),
    );
  });

  it('now_before_last_trial', () => {
    const score = scorer.score(D, [trial(5, NOW)], [], NOW - 10 * DAY_MS);
    expectValid(score);
    expect(score.urgency).toBe(
      scorer.score(D, [trial(5, NOW)], [], NOW).urgency,
    );
    expect(score.urgency).toBeLessThan(1e-4);
  });

  it('invalid_timestamp', () => {
    const score = scorer.score(
      D,
      [trial(5, NOW - 10_000_000_000 * DAY_MS)],
      [],
      NOW,
    );
    expectValid(score);
    expect(score.value).toBeLessThan(1);
  });

  it('extreme_timestamp_gap_does_not_overflow', () => {
    const i64Ms = 2 ** 63 * 1000;
    for (const now of [NOW, i64Ms, -i64Ms]) {
      const history = [trial(5, i64Ms), trial(1, -i64Ms)];
      expectValid(scorer.score(D, history, [], now));
    }
    expectValid(scorer.score(D, [trial(5, -i64Ms)], [], i64Ms));
    expectValid(scorer.score(D, [trial(5, i64Ms)], [], -i64Ms));
  });

  it('bad_scores_do_not_panic', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(() => scorer.score(P, [trial(bad, NOW)], [], NOW)).toThrow(
        NonFiniteScoreError,
      );
    }
    for (const outOfRange of [-3, 0, 7.5, 1e30, -1e30]) {
      expectValid(scorer.score(P, [trial(outOfRange, NOW)], [], NOW + DAY_MS));
    }
  });

  it('long_histories_stay_finite', () => {
    const history = Array.from({ length: 200 }, (_, i) =>
      trial(i % 3 === 0 ? 1 : 5, NOW - i * HOUR_MS),
    );
    expectValid(scorer.score(P, history, [], NOW));
  });

  it('failure_lowers_value_and_time_lowers_value', () => {
    const good = scorer.score(P, [trial(5, NOW)], [], NOW + DAY_MS);
    const bad = scorer.score(P, [trial(1, NOW)], [], NOW + DAY_MS);
    const later = scorer.score(P, [trial(5, NOW)], [], NOW + 90 * DAY_MS);
    expect(good.value).toBeGreaterThan(bad.value);
    expect(good.value).toBeGreaterThan(later.value);
    expect(later.urgency).toBeGreaterThan(good.urgency);
  });

  it('matches the hand replay through MemoryModel (t = whole days)', () => {
    const history = [trial(4, NOW + 3 * DAY_MS + 100_000), trial(4, NOW)];
    const rating = ratingOf(ratingMap, 4);
    const expected = memory.step(memory.step(null, 0, rating), 3, rating);
    const replayed = scorer.replay(history);
    expect(replayed?.state).toEqual(expected);
    expect(replayed?.lastAt).toBe(NOW + 3 * DAY_MS + 100_000);
  });

  it('variant H: value = R × performance, urgency = 1 − R', () => {
    // Одна попытка: performance — сама оценка (взвешенное среднее одного
    // элемента), R — по состоянию после первого повтора.
    const now = NOW + 2.5 * DAY_MS;
    const state = memory.step(null, 0, ratingOf(ratingMap, 5));
    const retrievability = memory.retrievability(state, 2.5);
    const score = scorer.score(D, [trial(5, NOW)], [], now);
    expect(score.value).toBeCloseTo(5 * retrievability, 9);
    expect(score.urgency).toBeCloseTo(1 - retrievability, 9);
    expect(score.velocity).toBeNull();
  });

  it('velocity is the OLS slope of the scores (points per day)', () => {
    const rising = [
      trial(5, NOW),
      trial(4, NOW - DAY_MS),
      trial(3, NOW - 2 * DAY_MS),
    ];
    expect(scorer.score(D, rising, [], NOW).velocity).toBeCloseTo(1, 9);
  });

  it('deltas shift the performance part', () => {
    const history = [
      trial(3, NOW),
      trial(4, NOW - DAY_MS),
      trial(4, NOW - 2 * DAY_MS),
    ];
    const pastDeltas = (delta: number): ExerciseDelta[] => [
      { delta, timestamp: NOW - DAY_MS },
      { delta, timestamp: NOW - 2 * DAY_MS },
    ];
    const base = scorer.score(D, history, [], NOW).value;
    expect(
      scorer.score(D, history, pastDeltas(1.2), NOW).value,
    ).toBeGreaterThan(base);
    expect(scorer.score(D, history, pastDeltas(-1.2), NOW).value).toBeLessThan(
      base,
    );
  });

  it('does not mutate its input', () => {
    const history = Object.freeze([
      Object.freeze(trial(3, NOW - DAY_MS)),
      Object.freeze(trial(5, NOW)),
    ]);
    expect(() => scorer.score(D, history, [], NOW)).not.toThrow();
    expect(history.map(({ score }) => score)).toEqual([3, 5]);
  });

  it('T-06: a 14 h gap across midnight is the same short-term step as within a day', () => {
    // Календарная граница UTC не влияет: `next()` ts-fsrs дал бы t = 1.
    const atNight = Date.UTC(2026, 0, 10, 22, 0, 0);
    const acrossMidnight = atNight + 14 * HOUR_MS;
    const sameDay = Date.UTC(2026, 0, 10, 1, 0, 0) + 14 * HOUR_MS;
    const gap = (first: number, second: number) =>
      scorer.replay([trial(4, second), trial(4, first)]);
    const crossing = gap(atNight, acrossMidnight);
    const within = gap(sameDay - 14 * HOUR_MS, sameDay);
    expect(crossing?.state).toEqual(within?.state);
    const rating = ratingOf(ratingMap, 4);
    expect(crossing?.state).toEqual(
      memory.step(memory.step(null, 0, rating), 0, rating),
    );
  });
});

describe('FsrsScorer info', () => {
  it('describes the scorer for settings.getScorer', () => {
    const [runner, anki] = scorers.map(({ scorer }) => scorer.info);
    expect(runner).toMatchObject({
      kind: 'fsrs-hybrid',
      memoryModelId: memory.id,
      ratingMap: 'runner',
    });
    expect(runner?.parametersHash).toMatch(/^[0-9a-f]{8}$/);
    expect(anki?.ratingMap).toBe('anki');
    expect(anki?.parametersHash).not.toBe(runner?.parametersHash);
  });

  it('uses the runner map by default', () => {
    expect(createFsrsScorer({ memory }).ratingMap).toBe('runner');
  });
});
