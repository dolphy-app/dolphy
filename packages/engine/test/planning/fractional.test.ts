/**
 * T-53: свойства дробного шага (порт `spike/fire-plan/test/fractional.test.ts`,
 * seed 20260929, 3000 прогонов). Оракул — реальный обзор `stepper.review`
 * и `MemoryModel.step`.
 */
import fc from 'fast-check';
import { computeDecayFactor, default_w as defaultWeights } from 'ts-fsrs';
import { describe, expect, test } from 'vitest';
import type { MemoryModel } from '../../src/ports/index.ts';
import { MS_PER_DAY } from '../../src/scoring/constants.ts';
import {
  FSRS_CURVE,
  createFractionalStepper,
} from '../../src/planning/fractional.ts';
import type { FireState, Rating } from '../../src/planning/fractional.ts';
import { memoryModel } from './helpers.ts';

const NOW = 1_800_000_000_000;
const SEED = 20260929;
const stepper = createFractionalStepper(memoryModel);

const stability = fc
  .double({ min: Math.log(0.001), max: Math.log(36_500), noNaN: true })
  .map(Math.exp);
const difficulty = fc.double({ min: 1, max: 10, noNaN: true });
const rating = fc.constantFrom<Rating>(1, 2, 3, 4);
const weight = fc.double({ min: 0, max: 1, noNaN: true });
// сутки с прошлого обзора: обычные, крошечные, огромные и отрицательные (now < lastAt)
const elapsed = fc.oneof(
  fc.double({ min: 0, max: 400, noNaN: true }),
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: 400, max: 1e7, noNaN: true }),
  fc.double({ min: -30, max: 0, noNaN: true }),
);
const stateArb = fc
  .record({ stability, difficulty, days: elapsed })
  .map(({ stability: s, difficulty: d, days }): FireState => ({
    stability: s,
    difficulty: d,
    lastAt: NOW - days * MS_PER_DAY,
  }));
const run = { seed: SEED, numRuns: 3000 } as const;

const isFinite = (state: FireState) =>
  Number.isFinite(state.stability) &&
  Number.isFinite(state.difficulty) &&
  Number.isFinite(state.lastAt);

const fractionalOf = (
  state: FireState,
  r: Rating,
  w: number,
  options?: { updateDifficulty?: boolean },
) => stepper.fractional(state, NOW, r, w, options) as FireState;

/** Разрыв между обзорами усекается 100 годами, как в `FsrsScorer`. */
const MAX_DELTA_DAYS = 36_500;
const wholeDays = (state: FireState) =>
  Math.min(
    Math.floor(Math.max(0, NOW - state.lastAt) / MS_PER_DAY),
    MAX_DELTA_DAYS,
  );

describe('forgetting curve constants', () => {
  test('FSRS_CURVE equals computeDecayFactor(default_w): decay = -w[20], R(S) = 0.9', () => {
    expect(FSRS_CURVE).toEqual(computeDecayFactor(defaultWeights));
    expect(FSRS_CURVE.decay).toBe(-(defaultWeights[20] as number));
    expect(
      Math.abs(0.9 ** (1 / FSRS_CURVE.decay) - 1 - FSRS_CURVE.factor),
    ).toBeLessThan(1e-8);
    expect(
      memoryModel.retrievability({ stability: 5, difficulty: 5 }, 5),
    ).toBeCloseTo(0.9, 8);
  });
});

describe('createFractionalStepper curve check', () => {
  const OTHER = { decay: -0.5, factor: 0.9 ** (1 / -0.5) - 1 };
  const otherModel: MemoryModel = {
    id: 'double/other-curve',
    step: memoryModel.step,
    retrievability: (state, days) =>
      (1 + (OTHER.factor * Math.max(0, days)) / state.stability) ** OTHER.decay,
  };

  test('rejects a model whose curve differs from the given one', () => {
    expect(() => createFractionalStepper(otherModel)).toThrow(RangeError);
    expect(() => createFractionalStepper(otherModel, FSRS_CURVE)).toThrow(
      /double\/other-curve/,
    );
    expect(() => createFractionalStepper(memoryModel, OTHER)).toThrow(
      RangeError,
    );
  });

  test('accepts the same double when the curve is passed explicitly', () => {
    const custom = createFractionalStepper(otherModel, OTHER);
    const state: FireState = { stability: 10, difficulty: 5, lastAt: NOW };
    const later = NOW + 20 * MS_PER_DAY;
    const before = custom.retrievability(state, later);
    const next = custom.fractional(state, later, 3, 0.5) as FireState;
    // R(now) = R0 + w(1 - R0) на кривой двойника
    expect(custom.retrievability(next, later)).toBeCloseTo(
      before + 0.5 * (1 - before),
      6,
    );
  });
});

describe('fractional step properties (fixed seed) (T-53)', () => {
  test('null state: no implicit step; review of null is the first review', () => {
    expect(stepper.fractional(null, NOW, 3, 0.5)).toBeNull();
    expect(stepper.retrievability(null, NOW)).toBe(0);
    const first = stepper.review(null, NOW, 3);
    expect(first.lastAt).toBe(NOW);
    expect(first).toEqual({
      ...memoryModel.step(null, 0, 3),
      lastAt: NOW,
    });
  });

  test('w = 1 equals a real review', () => {
    fc.assert(
      fc.property(stateArb, rating, (state, r) => {
        const result = fractionalOf(state, r, 1);
        expect(result).toEqual(stepper.review(state, NOW, r));
        expect(result.lastAt).toBe(NOW);
      }),
      run,
    );
  });

  test('w = 0 is an identity copy', () => {
    fc.assert(
      fc.property(stateArb, rating, (state, r) => {
        const result = fractionalOf(state, r, 0);
        expect(result).toEqual(state);
        expect(result).not.toBe(state);
      }),
      run,
    );
  });

  test('R never decreases (1e-8: forgetting_curve rounds) and R(now) == R0 + w(1 - R0)', () => {
    fc.assert(
      fc.property(stateArb, rating, weight, (state, r, w) => {
        const r0 = stepper.retrievability(state, NOW);
        const result = fractionalOf(state, r, w);
        const after = stepper.retrievability(result, NOW);
        expect(after).toBeGreaterThanOrEqual(r0 - 1e-8);
        expect(Math.abs(after - (r0 + w * (1 - r0)))).toBeLessThanOrEqual(2e-8);
      }),
      run,
    );
  });

  test("rating >= 2: S <= S' <= S+ and D' between D and D+", () => {
    fc.assert(
      fc.property(
        stateArb,
        fc.constantFrom<Rating>(2, 3, 4),
        weight,
        (state, r, w) => {
          const plus = memoryModel.step(state, wholeDays(state), r);
          const result = fractionalOf(state, r, w);
          // step() округляет S до 8 знаков: S+ может оказаться чуть ниже S
          const eps = 1e-7 * Math.max(1, plus.stability);
          expect(result.stability).toBeGreaterThanOrEqual(
            state.stability - eps,
          );
          expect(result.stability).toBeLessThanOrEqual(plus.stability + eps);
          expect(result.difficulty).toBeGreaterThanOrEqual(
            Math.min(state.difficulty, plus.difficulty) - 1e-9,
          );
          expect(result.difficulty).toBeLessThanOrEqual(
            Math.max(state.difficulty, plus.difficulty) + 1e-9,
          );
        },
      ),
      run,
    );
  });

  test("continuous and monotone in w (R(now) and S')", () => {
    fc.assert(
      fc.property(
        stateArb,
        rating,
        weight,
        fc.double({ min: 0, max: 1e-6, noNaN: true }),
        (state, r, w, dw) => {
          const w2 = Math.min(1, w + dw);
          const a = fractionalOf(state, r, w);
          const b = fractionalOf(state, r, w2);
          expect(
            Math.abs(
              stepper.retrievability(a, NOW) - stepper.retrievability(b, NOW),
            ),
          ).toBeLessThanOrEqual(1e-5);
          const plusS = memoryModel.step(state, wholeDays(state), r).stability;
          // наклон S по w равен S+ − S
          expect(Math.abs(a.stability - b.stability)).toBeLessThanOrEqual(
            Math.abs(plusS - state.stability) * (w2 - w) +
              1e-9 * Math.max(1, a.stability),
          );
          expect(stepper.retrievability(b, NOW)).toBeGreaterThanOrEqual(
            stepper.retrievability(a, NOW) - 2e-8,
          );
        },
      ),
      run,
    );
  });

  test('never NaN/Infinity, also for extreme S, t, w', () => {
    fc.assert(
      fc.property(
        stateArb,
        rating,
        fc.oneof(weight, fc.constantFrom(Number.MIN_VALUE, 1e-300, 1e-12, 1)),
        (state, r, w) => {
          const result = fractionalOf(state, r, w);
          expect(isFinite(result)).toBe(true);
          const retrievability = stepper.retrievability(result, NOW);
          expect(retrievability).toBeGreaterThanOrEqual(0);
          expect(retrievability).toBeLessThanOrEqual(1);
          expect(
            Number.isNaN(
              stepper.retrievability(result, NOW + 1e12 * MS_PER_DAY),
            ),
          ).toBe(false);
        },
      ),
      run,
    );
    for (const s of [0.001, 36_500]) {
      for (const d of [1, 10]) {
        for (const days of [-5, 0, 1e-9, 0.5, 1, 1e9]) {
          for (const w of [1e-300, 1e-9, 0.2, 1]) {
            for (const r of [1, 2, 3, 4] as const) {
              const result = fractionalOf(
                {
                  stability: s,
                  difficulty: d,
                  lastAt: NOW - days * MS_PER_DAY,
                },
                r,
                w,
              );
              expect(isFinite(result)).toBe(true);
              expect(result.stability).toBeGreaterThanOrEqual(0.001);
              expect(result.stability).toBeLessThanOrEqual(36_500);
              expect(result.difficulty).toBeGreaterThanOrEqual(1);
              expect(result.difficulty).toBeLessThanOrEqual(10);
            }
          }
        }
      }
    }
  });

  test('now < lastAt: treated as t = 0 (R0 = 1), lastAt moves to now', () => {
    const state: FireState = {
      stability: 10,
      difficulty: 5,
      lastAt: NOW + 3 * MS_PER_DAY,
    };
    const result = fractionalOf(state, 3, 0.5);
    expect(result.lastAt).toBe(NOW);
    expect(stepper.retrievability(result, NOW)).toBe(1);
  });
});

describe('updateDifficulty: false', () => {
  test('leaves D untouched; S and R(now) are the same as with the update', () => {
    fc.assert(
      fc.property(
        stateArb,
        rating,
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (state, r, w) => {
          const kept = fractionalOf(state, r, w, { updateDifficulty: false });
          const updated = fractionalOf(state, r, w);
          expect(kept.difficulty).toBe(state.difficulty);
          expect(kept.stability).toBe(updated.stability);
          expect(kept.lastAt).toBe(updated.lastAt);
        },
      ),
      run,
    );
  });

  test('w = 1 is a real review of S and lastAt but still keeps D', () => {
    fc.assert(
      fc.property(stateArb, rating, (state, r) => {
        const kept = fractionalOf(state, r, 1, { updateDifficulty: false });
        const real = stepper.review(state, NOW, r);
        expect(kept.difficulty).toBe(state.difficulty);
        expect(kept.stability).toBe(real.stability);
        expect(kept.lastAt).toBe(NOW);
      }),
      run,
    );
  });

  test('default is to update D (spike behaviour)', () => {
    const state: FireState = {
      stability: 12,
      difficulty: 5,
      lastAt: NOW - 20 * MS_PER_DAY,
    };
    const updated = fractionalOf(state, 3, 0.5);
    expect(updated.difficulty).not.toBe(state.difficulty);
    const plus = memoryModel.step(state, 20, 3);
    expect(updated.difficulty).toBeCloseTo(
      state.difficulty + 0.5 * (plus.difficulty - state.difficulty),
      12,
    );
  });
});
