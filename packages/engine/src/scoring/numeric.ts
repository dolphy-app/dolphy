import type { EpochMs } from '@lms/engine-contract';
import { type Constants, MS_PER_DAY, constantsFor } from './constants.ts';
import type { Precision } from './types.ts';

/** Граница `i64::saturating_sub` в мс: разность насыщается на 2^63 секунд. */
const I64_SATURATION_MS = 2 ** 63 * 1000;

/** Rust `f32::max`: при одном NaN возвращает другой операнд. */
export const rustMax = (a: number, b: number) => {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a > b ? a : b;
};

/** Rust `f32::min`: то же правило NaN. */
export const rustMin = (a: number, b: number) => {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return a < b ? a : b;
};

/** Rust `f32::clamp`: NaN на входе проходит без изменений. */
export const rustClamp = (x: number, low: number, high: number) => {
  if (x < low) return low;
  if (x > high) return high;
  return x;
};

export interface Numeric {
  readonly precision: Precision;
  readonly constants: Constants;
  /** Округление до эмулируемой точности: `Math.fround` или тождество. */
  readonly round: (x: number) => number;
  /** Дни между двумя метками мс (`newer - older`), без зажима. */
  elapsedDays(newerMs: EpochMs, olderMs: EpochMs): number;
  /** Rust `f32::powf`: по C99 `pow(1, y) == 1` при любом `y`. */
  powf(base: number, exponent: number): number;
}

const identity = (x: number) => x;

/**
 * Числовая модель Rust: в `f32` каждое значение, которое Rust держит как f32,
 * округляется `Math.fround` после каждой операции в том же порядке. Для
 * `+ - * /` результат в f64 с округлением равен нативному f32 (53 ≥ 2·24+2),
 * неточен только `powf`.
 */
export const createNumeric = (precision: Precision): Numeric => {
  const round = precision === 'f32' ? Math.fround : identity;
  const constants = constantsFor(precision);

  const elapsedDays = (newerMs: EpochMs, olderMs: EpochMs) => {
    const diffMs = rustClamp(
      newerMs - olderMs,
      -I64_SATURATION_MS,
      I64_SATURATION_MS,
    );
    if (precision === 'f64') return diffMs / MS_PER_DAY;
    return round(round(diffMs / 1000) / constants.SECONDS_PER_DAY);
  };

  const powf = (base: number, exponent: number) => {
    if (base === 1) return 1;
    return round(base ** exponent);
  };

  return { precision, constants, round, elapsedDays, powf };
};
