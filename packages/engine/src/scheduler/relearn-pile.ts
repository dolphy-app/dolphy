import type { Grade, SchedulerOptionsDto, UnitId } from '@lms/engine-contract';
import type { Rng } from '../ports/index.ts';
import type { Precision } from '../scoring/types.ts';
import { roundOf } from './precision.ts';
import { type Candidate, createCandidate } from './types.ts';

/** Оценки 1 и 2 — провал: упражнение уходит в пул повторов. */
const FAILING_GRADE_MAX = 2;

export interface RelearnPileDeps {
  /** Единый источник опций: `batchSize` и `relearnFraction` читаются на каждый выбор. */
  options(): Pick<SchedulerOptionsDto, 'batchSize' | 'relearnFraction'>;
  readonly rng: Rng;
  readonly precision?: Precision;
}

/**
 * Пул недавних провалов (`relearn_pile.rs`): их стоит показать снова
 * вскоре после ошибки. Только в памяти; чистится `startSession`.
 */
export interface RelearnPile {
  /** Оценка 1–2 добавляет упражнение, 3–5 убирает. */
  update(exerciseId: UnitId, grade: Grade): void;
  /**
   * Чистит пул от упражнений внутри blacklist и берёт случайные
   * `trunc(batchSize × relearnFraction)`; пул не уменьшается.
   */
  selectExercises(
    insideBlacklisted: (exerciseId: UnitId) => boolean,
  ): Candidate[];
  has(exerciseId: UnitId): boolean;
  entries(): UnitId[];
  readonly size: number;
  clear(): void;
}

export const createRelearnPile = ({
  options,
  rng,
  precision = 'f64',
}: RelearnPileDeps): RelearnPile => {
  const round = roundOf(precision);
  const pile = new Set<UnitId>();

  const update = (exerciseId: UnitId, grade: Grade) => {
    if (grade <= FAILING_GRADE_MAX) pile.add(exerciseId);
    else pile.delete(exerciseId);
  };

  const selectExercises = (insideBlacklisted: (id: UnitId) => boolean) => {
    for (const exerciseId of pile) {
      if (insideBlacklisted(exerciseId)) pile.delete(exerciseId);
    }
    const { batchSize, relearnFraction } = options();
    const amount = Math.trunc(round(round(batchSize) * round(relearnFraction)));
    return rng
      .sample(pile, amount)
      .map((exerciseId) => createCandidate({ exerciseId }));
  };

  return {
    update,
    selectExercises,
    has: (exerciseId) => pile.has(exerciseId),
    entries: () => [...pile],
    get size() {
      return pile.size;
    },
    clear: () => pile.clear(),
  };
};
