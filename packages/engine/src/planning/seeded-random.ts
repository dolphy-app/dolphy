import { createRng } from '../domain/rng.ts';
import type { Rng } from '../ports/index.ts';

const UINT32_RANGE = 2 ** 32;

/**
 * mulberry32: поток равномерных f64 в [0, 1) из uint32-seed. Один seed — одна
 * последовательность; на нём построены детерминизм плана дня и диагностики.
 */
export const createMulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
};

/** `Rng` порта поверх mulberry32; `range(0, n)` совпадает с `int(n)` спайков. */
export const createSeededRng = (seed: number): Rng =>
  createRng(createMulberry32(seed));

/** uint32-seed для запросов без явного `seed`: берётся из `Rng` движка. */
export const drawSeed = (rng: Pick<Rng, 'range'>): number =>
  rng.range(0, UINT32_RANGE);

export const isUint32 = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < UINT32_RANGE;
