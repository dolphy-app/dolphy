/**
 * `Rng`-обёртка со счётчиком обращений над `createSeededRng`: тесты порядка
 * и числа обращений к ГСЧ (engine-ts-testing.md §8) сверяют счётчики, а не
 * значения. Считаются только вызовы методов обёртки; вызовы `random()` внутри
 * `shuffle`/`sample*` базового генератора в счётчик `random` не попадают.
 */
import { createSeededRng } from '@lms/testkit';
import type { Rng } from '../../../src/ports/index.ts';

export interface RngCalls {
  random: number;
  range: number;
  shuffle: number;
  sample: number;
  sampleWeighted: number;
}

export interface CountingRng {
  readonly rng: Rng;
  readonly calls: RngCalls;
  total(): number;
}

export const createCountingRng = (seed = 1): CountingRng => {
  const inner = createSeededRng(seed);
  const calls: RngCalls = {
    random: 0,
    range: 0,
    shuffle: 0,
    sample: 0,
    sampleWeighted: 0,
  };
  const rng: Rng = {
    random: () => {
      calls.random += 1;
      return inner.random();
    },
    range: (lo, hi) => {
      calls.range += 1;
      return inner.range(lo, hi);
    },
    shuffle: (items) => {
      calls.shuffle += 1;
      inner.shuffle(items);
    },
    sample: (items, amount) => {
      calls.sample += 1;
      return inner.sample(items, amount);
    },
    sampleWeighted: (items, amount, weight) => {
      calls.sampleWeighted += 1;
      return inner.sampleWeighted(items, amount, weight);
    },
  };
  const total = () =>
    calls.random +
    calls.range +
    calls.shuffle +
    calls.sample +
    calls.sampleWeighted;
  return { rng, calls, total };
};
