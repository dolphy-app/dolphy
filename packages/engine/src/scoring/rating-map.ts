import type { ScorerInfoDto } from '@spirula/engine-contract';
import { NonFiniteScoreError } from './errors.ts';

export type RatingMapName = ScorerInfoDto['ratingMap'];

/** Рейтинг FSRS: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type FsrsRating = 1 | 2 | 3 | 4;

const GRADE_MIN = 1;
const GRADE_MAX = 5;

/**
 * Оценка 1–5 → рейтинг FSRS; индекс — `grade - 1`.
 * `runner` (по умолчанию): 1–2 → Again, 3–4 → Hard, 5 → Good — результат
 * раннера почти не даёт Easy. `anki`: 1–2 → Again, 3 → Hard, 4 → Good,
 * 5 → Easy — для самооценки (`InverseM0` и `RunnerMap` Rust-адаптера).
 */
export const RATING_MAPS: Readonly<
  Record<RatingMapName, readonly FsrsRating[]>
> = Object.freeze({
  runner: Object.freeze<FsrsRating[]>([1, 1, 2, 2, 3]),
  anki: Object.freeze<FsrsRating[]>([1, 1, 2, 3, 4]),
});

/**
 * Округляет оценку до целой, зажимает в 1..=5 и отображает в рейтинг;
 * нечисловая оценка — `NonFiniteScoreError` (как `Err` Rust-адаптера).
 */
export const ratingOf = (ratingMap: RatingMapName, score: number) => {
  if (!Number.isFinite(score)) throw new NonFiniteScoreError(score);
  const grade = Math.min(Math.max(Math.round(score), GRADE_MIN), GRADE_MAX);
  return RATING_MAPS[ratingMap][grade - 1] as FsrsRating;
};
