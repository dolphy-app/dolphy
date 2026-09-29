import type { Rng } from '../ports/index.ts';

const TWO_POW_53 = 2 ** 53;

/**
 * Собирает `Rng` из источника равномерных f64 в [0, 1): все операции
 * выводятся из `random`, поэтому детерминированный и системный генераторы
 * отличаются только источником.
 */
export const createRng = (random: () => number): Rng => {
  const range = (lo: number, hi: number) =>
    lo + Math.floor(random() * (hi - lo));

  // Фишер — Йейтс на месте
  const shuffle = <T>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = range(0, i + 1);
      const held = items[i] as T;
      items[i] = items[j] as T;
      items[j] = held;
    }
  };

  const sample = <T>(items: Iterable<T>, amount: number) => {
    const pool = [...items];
    shuffle(pool);
    return pool.slice(0, Math.max(0, amount));
  };

  // Эфраимидис — Спиракис (A-Res, лог-ключи): выбор без возвращения,
  // распределение Плакетта — Льюса. Вес <= 0 не выбирается; NaN — ошибка.
  const sampleWeighted = <T>(
    items: readonly T[],
    amount: number,
    weight: (item: T) => number,
  ) => {
    const keyed: Array<{ item: T; key: number }> = [];
    for (const item of items) {
      const w = weight(item);
      if (Number.isNaN(w) || w < 0) {
        throw new RangeError(`Invalid weight: ${w}`);
      }
      if (w > 0) keyed.push({ item, key: Math.log(random()) / w });
    }
    keyed.sort((a, b) => b.key - a.key);
    return keyed.slice(0, Math.max(0, amount)).map(({ item }) => item);
  };

  return { random, range, shuffle, sample, sampleWeighted };
};

/** f64 в [0, 1) из двух 32-битных слов: 21 + 32 = 53 бита мантиссы. */
export const f64FromWords = (high: number, low: number) =>
  ((high >>> 11) * 2 ** 32 + (low >>> 0)) / TWO_POW_53;
