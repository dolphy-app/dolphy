import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MemoryModel, MemoryState } from '../../src/ports/index.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';

const DAY_SEC = 86_400;
// Измеренный максимум на 600 историях: 1.4e-7 (stability, относительная),
// 7.4e-8 (difficulty), 7.2e-9 (R) — прогон `fsrs-check`.
const STABILITY_RTOL = 1e-6;
const DIFFICULTY_ATOL = 1e-6;
const R_ATOL = 1e-7;

interface ReferenceItem {
  times: number[]; // epoch, секунды
  grades: Array<1 | 2 | 3 | 4>;
  queries: number[]; // epoch, секунды
  trace: Array<[stability: number, difficulty: number]>;
  r_frac: number[];
}

const reference = JSON.parse(
  readFileSync(new URL('../fixtures/reference.json', import.meta.url), 'utf8'),
) as { pyfsrs_version: string; items: ReferenceItem[] };

const adapters: Array<[string, () => MemoryModel]> = [
  ['ts-fsrs', createTsFsrsMemoryModel],
];

describe.each(adapters)('MemoryModel contract: %s', (_name, create) => {
  const model = create();

  it('has a versioned id', () => {
    expect(model.id).toMatch(/^fsrs-6\/ts-fsrs@\d+\.\d+\.\d+\/w:[0-9a-f]{8}$/);
  });

  it('first review starts from a null state with valid difficulty', () => {
    for (const rating of [1, 2, 3, 4] as const) {
      const state = model.step(null, 0, rating);
      expect(state.stability).toBeGreaterThan(0);
      expect(state.difficulty).toBeGreaterThanOrEqual(1);
      expect(state.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('better first rating gives higher stability', () => {
    const stabilities = ([1, 2, 3, 4] as const).map(
      (rating) => model.step(null, 0, rating).stability,
    );
    expect(stabilities).toEqual([...stabilities].sort((a, b) => a - b));
  });

  it('does not mutate the previous state', () => {
    const state = Object.freeze(model.step(null, 0, 3));
    const copy = { ...state };
    model.step(state, 5, 3);
    expect(state).toEqual(copy);
  });

  it('retrievability is 1 at once, 0.9 at t = S, and decreases', () => {
    const state = model.step(null, 0, 3);
    expect(model.retrievability(state, 0)).toBeCloseTo(1, 12);
    expect(model.retrievability(state, state.stability)).toBeCloseTo(0.9, 6);
    const curve = [0, 0.5, 1, 10, 100].map((days) =>
      model.retrievability(state, days),
    );
    expect(curve).toEqual([...curve].sort((a, b) => b - a));
  });

  it('clamps negative elapsed time to zero', () => {
    const state = model.step(null, 0, 3);
    expect(model.retrievability(state, -3)).toBe(
      model.retrievability(state, 0),
    );
  });

  it('rejects invalid input', () => {
    expect(() => model.step(null, 1.5, 3)).toThrow(RangeError);
    expect(() => model.step(null, -1, 3)).toThrow(RangeError);
    expect(() => model.step(null, 0, 5 as 4)).toThrow(RangeError);
  });

  describe(`py-fsrs ${reference.pyfsrs_version} reference (T-07)`, () => {
    it('replays all histories step by step', () => {
      expect(reference.items).toHaveLength(600);
      let steps = 0;
      for (const item of reference.items) {
        let state: MemoryState | null = null;
        for (const [i, time] of item.times.entries()) {
          const prev = item.times[i - 1] ?? time;
          const wholeDays = Math.floor((time - prev) / DAY_SEC);
          state = model.step(state, wholeDays, item.grades[i] as 1 | 2 | 3 | 4);
          const [stability, difficulty] = item.trace[i] as [number, number];
          const stabilityRel =
            Math.abs(state.stability - stability) / stability;
          expect(stabilityRel).toBeLessThan(STABILITY_RTOL);
          expect(Math.abs(state.difficulty - difficulty)).toBeLessThan(
            DIFFICULTY_ATOL,
          );
          steps++;
        }
      }
      expect(steps).toBe(18_564);
    });

    it('matches fractional-day retrievability of the final state', () => {
      let queries = 0;
      for (const item of reference.items) {
        let state: MemoryState | null = null;
        for (const [i, time] of item.times.entries()) {
          const prev = item.times[i - 1] ?? time;
          state = model.step(
            state,
            Math.floor((time - prev) / DAY_SEC),
            item.grades[i] as 1 | 2 | 3 | 4,
          );
        }
        const last = item.times.at(-1) as number;
        for (const [q, query] of item.queries.entries()) {
          const days = (query - last) / DAY_SEC;
          const expected = item.r_frac[q] as number;
          expect(
            Math.abs(
              model.retrievability(state as MemoryState, days) - expected,
            ),
          ).toBeLessThan(R_ATOL);
          queries++;
        }
      }
      expect(queries).toBe(1800);
    });
  });
});
