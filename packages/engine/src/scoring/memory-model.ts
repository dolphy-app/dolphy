import { fsrs } from 'ts-fsrs';
import type { MemoryModel, MemoryState } from '../ports/index.ts';

const TS_FSRS_VERSION = '5.4.2';
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const hashWeights = (weights: readonly number[]) => {
  let hash = FNV_OFFSET;
  for (const char of weights.join(',')) {
    hash = Math.imul(hash ^ char.charCodeAt(0), FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Адаптер `MemoryModel` на ts-fsrs по проверенному рецепту (engine-ts.md §6):
 * `next_state` + `forgetting_curve`, не `next()`/`Card`. Один экземпляр
 * алгоритма на модель; версия ts-fsrs закреплена точно.
 */
export const createTsFsrsMemoryModel = (): MemoryModel => {
  const algorithm = fsrs({
    enable_short_term: true,
    learning_steps: [],
    relearning_steps: [],
    enable_fuzz: false,
    maximum_interval: 36500,
  });

  const step = (
    state: MemoryState | null,
    wholeDays: number,
    rating: 1 | 2 | 3 | 4,
  ): MemoryState => {
    if (!Number.isInteger(wholeDays) || wholeDays < 0) {
      throw new RangeError(
        `wholeDays must be a non-negative integer: ${wholeDays}`,
      );
    }
    if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
      throw new RangeError(`rating must be 1..4: ${rating}`);
    }
    const { stability, difficulty } = algorithm.next_state(
      state,
      wholeDays,
      rating,
    );
    return { stability, difficulty };
  };

  const retrievability = (state: MemoryState, days: number) =>
    algorithm.forgetting_curve(Math.max(0, days), state.stability);

  return {
    id: `fsrs-6/ts-fsrs@${TS_FSRS_VERSION}/w:${hashWeights(algorithm.parameters.w)}`,
    step,
    retrievability,
  };
};
