import { createRng, f64FromWords } from '@dolphy-app/engine';
import type { Rng } from '@dolphy-app/engine';

export interface SeededRng extends Rng {
  readonly seed: number;
}

// splitmix32: развёртывание seed в состояние xoshiro128**
const createSplitmix32 = (seed: number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state ^ (state >>> 16);
    z = Math.imul(z, 0x21f0aaad);
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
};

const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k));

/**
 * Детерминированный `Rng`: xoshiro128**, инициализация splitmix32.
 * Один seed — один поток; порядок обращений тестируют по числу и местам
 * вызовов, а не по значениям (engine-ts-testing.md §8).
 */
export const createSeededRng = (seed: number): SeededRng => {
  const init = createSplitmix32(seed);
  let s0 = init();
  let s1 = init();
  let s2 = init();
  let s3 = init();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const nextWord = () => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };

  const random = () => f64FromWords(nextWord(), nextWord());
  return { seed, ...createRng(random) };
};
