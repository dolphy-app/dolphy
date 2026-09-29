/**
 * Общие замеры бенчмарков T-57: медиана и p95 из серии запусков, печать
 * таблицы и предупреждение о регрессе более чем вдвое (engine-ts-testing.md
 * §7.1: бенчи советуют, а не блокируют; блокирует только T-44 и NF1).
 */

/** Не меньше пяти запусков на измерение (§7.1). */
export const RUNS = 5;

export const WARN_FACTOR = 2;

export interface Stats {
  runs: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

const percentile = (sorted: readonly number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
  0;

export const summarize = (samples: readonly number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return {
    runs: sorted.length,
    median,
    p95: percentile(sorted, 0.95),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};

export const timed = (run: () => unknown): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

export const timedAsync = async (run: () => Promise<unknown>) => {
  const start = performance.now();
  await run();
  return performance.now() - start;
};

const fixed = (value: number) =>
  value >= 100 ? value.toFixed(0) : value.toFixed(value >= 1 ? 2 : 3);

/** Строка отчёта: `[bench] заголовок: медиана … p95 … (мин … макс …, N запусков) единица`. */
export const report = (title: string, stats: Stats, unit = 'мс') => {
  console.log(
    `[bench] ${title}: медиана ${fixed(stats.median)} ${unit}, p95 ${fixed(stats.p95)} ${unit} ` +
      `(мин ${fixed(stats.min)}, макс ${fixed(stats.max)}; замеров ${stats.runs})`,
  );
};

/** Регресс относительно числа, зафиксированного в документе: предупреждение, не падение. */
export const warnOnRegression = (
  title: string,
  median: number,
  baseline: number,
  unit = 'мс',
) => {
  if (median > baseline * WARN_FACTOR) {
    console.warn(
      `[bench][warn] ${title}: медиана ${fixed(median)} ${unit} более чем в ${WARN_FACTOR}× выше базы ${fixed(baseline)} ${unit}`,
    );
  }
};
