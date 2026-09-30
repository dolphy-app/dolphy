import type { UnitId } from '@spirula/engine-contract';
import type {
  AttemptIndex,
  AttemptRecord,
  RewardProjection,
} from '../app/context.ts';
import type { ScoringGraph } from '../scoring/graph.ts';
import { propagateRewards } from '../scoring/reward-propagator.ts';
import { createRewardIndex } from '../scoring/reward-index.ts';

export interface RewardProjectionHandle extends RewardProjection {
  /**
   * Быстрый путь: попытка новее всех примененных. Возвращает юниты, чьи
   * награды изменились; при устаревшей проекции — пусто (досчитается при
   * чтении).
   */
  record(attempt: AttemptRecord): UnitId[];
  /** Награды устарели: сброс, отмена попыток, поздняя запись, смена графа. */
  markStale(): void;
  isStale(): boolean;
}

/**
 * Награды юнитов — чистая функция неотменённых попыток и графа: попытки в
 * порядке ключа проходят через `propagateRewards`, дедуп — в
 * `RewardIndex.record`. Порядок применения не важен: если запись пришла не в
 * хронологическом порядке, проекция помечается устаревшей и досчитывается
 * из `AttemptIndex` при следующем чтении, поэтому результат всегда равен
 * полной перестройке.
 */
export const createRewardProjection = (
  attempts: Pick<AttemptIndex, 'allInOrder'>,
  graph: ScoringGraph,
): RewardProjectionHandle => {
  const index = createRewardIndex();
  let stale = false;

  const add = (attempt: AttemptRecord): UnitId[] =>
    index.record(
      propagateRewards(graph, attempt.exerciseId, attempt.grade, attempt.at),
    );

  const refresh = () => {
    if (!stale) return;
    index.clear();
    for (const attempt of attempts.allInOrder()) add(attempt);
    stale = false;
  };

  return {
    record: (attempt) => (stale ? [] : add(attempt)),
    markStale: () => {
      stale = true;
    },
    isStale: () => stale,
    getRewards: (unitId, limit) => {
      refresh();
      return index.getRewards(unitId, limit);
    },
    clear: () => {
      index.clear();
      stale = false;
    },
  };
};
