import type { Precision } from './types.ts';

/**
 * Константы `PowerLawScorer` Trane v0.34.1 (`exercise_scorer.rs:28-128`) в том
 * виде, как записаны в Rust (литералы f32). В режиме `f32` каждая округляется
 * `Math.fround`.
 */
const RAW = {
  /** Показатель степенной кривой забывания процедурных упражнений. */
  PROCEDURAL_CURVE_DECAY: -0.2,
  /** Показатель кривой для декларативных упражнений. */
  DECLARATIVE_CURVE_DECAY: -0.4,
  /** `S' = S * (1 + COEF * P * E * spacing_gain)`. */
  STABILITY_COEFFICIENT: 2.5,
  /** Масштаб поправки сложности за попытку. */
  DIFFICULTY_GRADE_ADJUSTMENT_SCALE: 1.05,
  /** Возврат динамической сложности к базовой после каждого повтора. */
  DIFFICULTY_REVERSION_WEIGHT: 0.16,
  /** Убывание веса на неделю (по времени) и на позицию в экспоненциальном среднем. */
  PERFORMANCE_WEIGHT_DECAY: 0.95,
  /** Вес эффекта интервала при удачных повторах. */
  SPACING_EFFECT_WEIGHT: 0.65,
  /** Минимальная взвешенная оценка для пола «старое и хорошее». */
  OLD_GOOD_MIN_SCORE: 4.0,
  /** Минимальный возраст (дни) для пола «старое и хорошее». */
  OLD_GOOD_MIN_AGE: 50.0,
  /** Минимальная извлекаемость старых упражнений с сильной историей. */
  OLD_GOOD_FLOOR: 0.75,
  /** Извлекаемость при `t = stability`; калибрует множитель кривой. */
  TARGET_RETRIEVABILITY_AT_STABILITY: 0.9,
  MIN_STABILITY: 0.5,
  MAX_STABILITY: 730.0,
  DEFAULT_STABILITY: 1.0,
  MIN_DIFFICULTY: 1.0,
  MAX_DIFFICULTY: 10.0,
  BASE_DIFFICULTY: 5.0,
  /** `E = (11 - D) / 5`. */
  EASE_NUMERATOR_OFFSET: 11.0,
  EASE_DENOMINATOR: 5.0,
  /** Оценки ниже считаются провалом. */
  PERFORMANCE_BASELINE_SCORE: 3.0,
  /** Минимальный вес попытки: очень старые не исчезают совсем. */
  PERFORMANCE_WEIGHT_MIN: 0.1,
  GRADE_MIN: 1.0,
  GRADE_MAX: 5.0,
  SECONDS_PER_DAY: 86400.0,
  /** Доли среднего по времени и по позиции (литералы 0.8 / 0.2). */
  WEIGHTED_AVG_TIME_SHARE: 0.8,
  WEIGHTED_AVG_POSITION_SHARE: 0.2,
} as const;

export type Constants = Readonly<
  Record<keyof typeof RAW | 'GRADE_RANGE', number>
>;

/** `OLD_GOOD_MIN_SCORES: usize = 2` — целое, не f32. */
export const OLD_GOOD_MIN_SCORES = 2;

/** `f32::EPSILON` (2^-23); смысловой порог, одинаков в обоих режимах. */
export const F32_EPSILON = 2 ** -23;

export const MS_PER_DAY = 86_400_000;

type Rounding = (x: number) => number;

const buildConstants = (round: Rounding): Constants => {
  const rounded = {} as Record<keyof typeof RAW, number>;
  for (const key of Object.keys(RAW) as Array<keyof typeof RAW>) {
    rounded[key] = round(RAW[key]);
  }
  const gradeRange = round(rounded.GRADE_MAX - rounded.GRADE_MIN);
  return Object.freeze({ ...rounded, GRADE_RANGE: gradeRange });
};

const CONSTANTS: Record<Precision, Constants> = {
  f64: buildConstants((x) => x),
  f32: buildConstants(Math.fround),
};

export const constantsFor = (precision: Precision): Constants =>
  CONSTANTS[precision];

/** Значения для `parametersHash`: константы f64 в порядке объявления. */
export const constantEntries = (): string =>
  Object.entries(CONSTANTS.f64)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
