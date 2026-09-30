import type { UnitId } from '@spirula-app/engine-contract';
import { MS_PER_DAY } from './constants.ts';
import type { UnitReward } from './types.ts';

/** Хранится не больше наград на юнит (`OFFSET 20` в practice_rewards.rs). */
export const MAX_REWARDS_PER_UNIT = 20;
/** Дедуп сверяется с этим числом новейших сохранённых (`MAX_CACHE_SIZE`). */
export const REWARD_DEDUP_WINDOW = 10;
/** Награды ближе по времени считаются «похожими» (строго `<`). */
export const REWARD_DEDUP_INTERVAL_MS = MS_PER_DAY;
/** Веса ближе этого считаются «похожими» (строго `<`). */
export const REWARD_WEIGHT_EPSILON = 0.1;

/** Как `RewardCache::is_similar`: то же значение, близкие время и вес. */
export const isSimilarReward = (a: UnitReward, b: UnitReward) =>
  a.value === b.value &&
  Math.abs(a.timestamp - b.timestamp) < REWARD_DEDUP_INTERVAL_MS &&
  Math.abs(a.weight - b.weight) < REWARD_WEIGHT_EPSILON;

/**
 * Добавляет награду в список юнита (от новых к старым). Возвращает `null`,
 * если среди `REWARD_DEDUP_WINDOW` новейших уже есть похожая; иначе новый
 * список не длиннее `MAX_REWARDS_PER_UNIT`: при равных метках новая запись
 * считается более новой. Чистая функция: результат зависит только от
 * аргументов, поэтому на отсортированной последовательности событий
 * перестройка даёт тот же список (в Rust дедуп жил в кэше процесса).
 */
export const insertReward = (
  retained: readonly UnitReward[],
  reward: UnitReward,
): readonly UnitReward[] | null => {
  const window = retained.slice(0, REWARD_DEDUP_WINDOW);
  if (window.some((known) => isSimilarReward(known, reward))) return null;

  const position = retained.findIndex(
    (known) => known.timestamp <= reward.timestamp,
  );
  const at = position === -1 ? retained.length : position;
  const updated = [...retained.slice(0, at), reward, ...retained.slice(at)];
  return updated.slice(0, MAX_REWARDS_PER_UNIT);
};

/** Награды по юнитам; события подаются в порядке `(at, deviceId, seq)`. */
export interface RewardIndex {
  /** Записывает награды; возвращает id юнитов, чей список изменился. */
  record(rewards: readonly UnitReward[]): UnitId[];
  /** Не больше `limit` новейших наград юнита, от новых к старым. */
  getRewards(unitId: UnitId, limit: number): readonly UnitReward[];
  clear(): void;
}

export const createRewardIndex = (): RewardIndex => {
  const byUnit = new Map<UnitId, readonly UnitReward[]>();

  const record = (rewards: readonly UnitReward[]) => {
    const changed = new Set<UnitId>();
    for (const reward of rewards) {
      const retained = byUnit.get(reward.unitId) ?? [];
      const updated = insertReward(retained, reward);
      if (updated === null || !updated.includes(reward)) continue;
      byUnit.set(reward.unitId, updated);
      changed.add(reward.unitId);
    }
    return [...changed];
  };

  const getRewards = (unitId: UnitId, limit: number) =>
    (byUnit.get(unitId) ?? []).slice(0, limit);

  return { record, getRewards, clear: () => byUnit.clear() };
};
