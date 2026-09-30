import type {
  EpochMs,
  ScorerInfoDto,
  SchedulerOptionsDto,
  UnitId,
} from '@dolphy-app/engine-contract';
import type { ExerciseType } from '../domain/manifest.ts';
import type { Clock } from '../ports/index.ts';
import { ScoringError, UnknownUnitError } from './errors.ts';
import {
  type BlacklistView,
  type ScoringGraph,
  allValidExercises,
} from './graph.ts';
import {
  MIN_TRIALS_FOR_REWARD,
  type RewardScorer,
  createWeightedRewardScorer,
} from './reward-scorer.ts';
import type {
  ExerciseDelta,
  ExerciseScorer,
  ExerciseTrial,
  UnitReward,
} from './types.ts';

/** Кэш живёт 2 часа, как `MAX_CACHE_AGE` в Trane. */
export const MAX_CACHE_AGE_MS = 2 * 60 * 60 * 1000;
const GRADE_MAX = 5;

/** Опции планировщика, которые читает скорер; единый источник (не клон). */
export type ScoringOptions = Pick<
  SchedulerOptionsDto,
  'numTrials' | 'numRewards' | 'supersedingScore'
>;

/** Источник попыток (`AttemptIndex`): новейшие `limit` попыток, от новых к старым. */
export interface AttemptSource {
  getTrials(exerciseId: UnitId, limit: number): readonly ExerciseTrial[];
}

/** Источник наград (`RewardIndex`): новейшие `limit` наград юнита. */
export interface RewardSource {
  getRewards(unitId: UnitId, limit: number): readonly UnitReward[];
}

export interface UnitScorerDeps {
  readonly clock: Clock;
  readonly graph: ScoringGraph;
  readonly blacklist: BlacklistView;
  readonly attempts: AttemptSource;
  readonly rewards: RewardSource;
  /** Тип упражнения из манифеста; `null` — манифеста нет (тогда `Procedural`). */
  exerciseTypeOf(exerciseId: UnitId): ExerciseType | null;
  readonly exerciseScorer: ExerciseScorer;
  readonly rewardScorer?: RewardScorer;
  options(): ScoringOptions;
}

/** Ключи пяти кэшей: тестовый хук для проверки инвалидации. */
export interface UnitScorerCacheKeys {
  exercise: string[];
  lesson: string[];
  course: string[];
  lessonTrials: string[];
  courseTrials: string[];
}

export interface UnitScorer {
  /** `null` — валидной оценки нет (blacklist, вытеснен, пусто): зависимость выполнена. */
  getUnitScore(unitId: UnitId): number | null;
  getExerciseUrgency(exerciseId: UnitId): number;
  getExerciseVelocity(exerciseId: UnitId): number | null;
  /** Число попыток, полученных из источника (≤ `numTrials`), не общее. */
  getExerciseNumTrials(exerciseId: UnitId): number;
  /** Среднее число попыток по упражнениям урока или курса; иначе `null`. */
  getAvgTrials(unitId: UnitId): number | null;
  allValidExercisesHaveScores(unitId: UnitId): boolean;
  isSuperseded(
    supersededId: UnitId,
    supersedingIds: ReadonlySet<UnitId>,
  ): boolean;
  getSupersedingRecursive(unitId: UnitId): ReadonlySet<UnitId> | null;
  /** Сбрасывает кэши юнитов и каскад: упражнение → урок → курс, урок и курс → вниз. */
  invalidate(unitIds: readonly UnitId[]): void;
  invalidateWithPrefix(prefix: string): void;
  getScorerInfo(): ScorerInfoDto;
  cacheKeys(): UnitScorerCacheKeys;
}

interface CachedExercise {
  readonly score: number;
  readonly urgency: number;
  readonly velocity: number | null;
  readonly numTrials: number;
  readonly timestamp: EpochMs;
}

interface CachedAggregate {
  readonly score: number | null;
  readonly timestamp: EpochMs;
}

const NO_DELTAS: readonly ExerciseDelta[] = Object.freeze([]);

/** Запись из «будущего» (часы отмотали назад) не свежа; граница включительна. */
const isFresh = (cachedAt: EpochMs, now: EpochMs) =>
  now >= cachedAt && now - cachedAt <= MAX_CACHE_AGE_MS;

const average = (values: readonly number[]) => {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
};

const isPresent = (value: number | null): value is number => value !== null;

/**
 * Кэширующий агрегатор оценок (`scheduler/unit_scorer.rs`): упражнение
 * (скорер + награды) → урок (среднее) → курс (среднее по урокам). Опции берутся
 * из `options()` при каждом вычислении, поэтому смена опций доходит до
 * скорера (в Rust у `UnitScorer` устаревший клон). Deltas удалены: скорер
 * упражнения получает пустой список.
 */
export const createUnitScorer = (deps: UnitScorerDeps): UnitScorer => {
  const { clock, graph, blacklist, attempts, rewards, exerciseScorer } = deps;
  const rewardScorer = deps.rewardScorer ?? createWeightedRewardScorer();

  const exerciseCache = new Map<UnitId, CachedExercise>();
  const lessonCache = new Map<UnitId, CachedAggregate>();
  const courseCache = new Map<UnitId, CachedAggregate>();
  const lessonTrialsCache = new Map<UnitId, number | null>();
  const courseTrialsCache = new Map<UnitId, number | null>();

  const computeExercise = (exerciseId: UnitId, now: EpochMs) => {
    const { numTrials, numRewards } = deps.options();
    const exerciseType = deps.exerciseTypeOf(exerciseId) ?? 'Procedural';
    const trials = attempts.getTrials(exerciseId, numTrials);
    const score = exerciseScorer.score(exerciseType, trials, NO_DELTAS, now);

    let value = score.value;
    if (trials.length >= MIN_TRIALS_FOR_REWARD) {
      const lessonId = graph.getExerciseLesson(exerciseId);
      const courseId =
        lessonId === null ? null : graph.getLessonCourse(lessonId);
      const lessonRewards =
        lessonId === null ? [] : rewards.getRewards(lessonId, numRewards);
      const courseRewards =
        courseId === null ? [] : rewards.getRewards(courseId, numRewards);
      const reward = rewardScorer.scoreRewards(
        courseRewards,
        lessonRewards,
        now,
      );
      if (rewardScorer.applyReward(reward, trials, now)) {
        value = Math.min(Math.max(score.value + reward, 0), GRADE_MAX);
      }
    }
    return {
      score: value,
      urgency: score.urgency,
      velocity: score.velocity,
      numTrials: trials.length,
      timestamp: now,
    };
  };

  /** Свежая запись кэша или пересчёт; ошибка скорера ничего не пишет в кэш. */
  const loadExercise = (exerciseId: UnitId): CachedExercise => {
    const now = clock.now();
    const cached = exerciseCache.get(exerciseId);
    if (cached && isFresh(cached.timestamp, now)) return cached;
    const computed = computeExercise(exerciseId, now);
    exerciseCache.set(exerciseId, computed);
    return computed;
  };

  /** `Err` Trane → `null`: отбрасываем только ошибки скорера, баги пробрасываем. */
  const attempt = <T>(compute: () => T): T | null => {
    try {
      return compute();
    } catch (error) {
      if (error instanceof ScoringError) return null;
      throw error;
    }
  };

  const tryExerciseScore = (exerciseId: UnitId) =>
    attempt(() => loadExercise(exerciseId).score);

  const allValidExercisesHaveScores = (unitId: UnitId) => {
    const valid = allValidExercises(graph, blacklist, unitId);
    if (valid.length === 0) return true;
    const scores = valid.map(tryExerciseScore);
    return scores.every((score) => score !== null && score > 0);
  };

  /** `isSuperseded` и `getUnitScore` взаимно рекурсивны (вытеснение по оценке). */
  const tryUnitScore = (unitId: UnitId): number | null =>
    // eslint-disable-next-line no-use-before-define
    attempt(() => getUnitScore(unitId));

  const isSuperseded = (
    supersededId: UnitId,
    supersedingIds: ReadonlySet<UnitId>,
  ) => {
    if (supersedingIds.size === 0) return false;
    if (!allValidExercisesHaveScores(supersededId)) return false;
    const scores = [...supersedingIds].map(tryUnitScore).filter(isPresent);
    const threshold = deps.options().supersedingScore;
    return scores.length > 0 && scores.every((score) => score >= threshold);
  };

  /** Вытесняющие юниты, сами замещённые вытесняющими их (рекурсия без кэша). */
  const replaceSuperseding = (unitIds: ReadonlySet<UnitId>): Set<UnitId> => {
    const replaced = new Set<UnitId>();
    for (const unitId of unitIds) {
      const superseding = graph.getSupersededBy(unitId);
      if (superseding && isSuperseded(unitId, superseding)) {
        for (const id of replaceSuperseding(superseding)) replaced.add(id);
      } else {
        replaced.add(unitId);
      }
    }
    return replaced;
  };

  const getSupersedingRecursive = (unitId: UnitId) => {
    const superseding = graph.getSupersededBy(unitId);
    return superseding ? replaceSuperseding(superseding) : null;
  };

  const isUnitSuperseded = (unitId: UnitId) => {
    const superseding = getSupersedingRecursive(unitId);
    return superseding !== null && isSuperseded(unitId, superseding);
  };

  const getLessonScore = (lessonId: UnitId): number | null => {
    const now = clock.now();
    const cached = lessonCache.get(lessonId);
    if (cached && isFresh(cached.timestamp, now)) return cached.score;

    if (blacklist.isBlacklisted(lessonId)) {
      lessonCache.set(lessonId, { score: null, timestamp: now });
      return null;
    }
    // Вытеснение не кэшируется: вытесняющий юнит может потерять освоение без
    // инвалидации кэша этого урока.
    if (isUnitSuperseded(lessonId)) return null;

    const exercises = graph.getLessonExercises(lessonId) ?? [];
    const valid = exercises.filter((id) => !blacklist.isBlacklisted(id));
    const scores = valid.map(tryExerciseScore).filter(isPresent);
    const score = scores.length === 0 ? null : average(scores);
    lessonCache.set(lessonId, { score, timestamp: now });
    return score;
  };

  const getCourseScore = (courseId: UnitId): number | null => {
    const now = clock.now();
    const cached = courseCache.get(courseId);
    if (cached && isFresh(cached.timestamp, now)) return cached.score;

    if (blacklist.isBlacklisted(courseId)) {
      courseCache.set(courseId, { score: null, timestamp: now });
      return null;
    }
    if (isUnitSuperseded(courseId)) return null;

    const lessons = graph.getCourseLessons(courseId);
    if (lessons === null) {
      courseCache.set(courseId, { score: null, timestamp: now });
      return null;
    }
    const scores = lessons.map(getLessonScore).filter(isPresent);
    // Курс без валидных уроков не кэшируется (в отличие от урока).
    if (scores.length === 0) return null;
    const score = average(scores);
    courseCache.set(courseId, { score, timestamp: now });
    return score;
  };

  const getUnitScore = (unitId: UnitId): number | null => {
    const kind = graph.getUnitType(unitId);
    if (kind === null) throw new UnknownUnitError(unitId);
    if (kind === 'course') return getCourseScore(unitId);
    if (kind === 'lesson') return getLessonScore(unitId);
    return loadExercise(unitId).score;
  };

  const tryExerciseTrials = (exerciseId: UnitId) =>
    attempt(() => loadExercise(exerciseId).numTrials);

  /** Кэш без срока жизни: сбрасывается только явной инвалидацией. */
  const getLessonNumTrials = (lessonId: UnitId): number | null => {
    const cached = lessonTrialsCache.get(lessonId);
    if (cached !== undefined) return cached;

    const exercises = graph.getLessonExercises(lessonId);
    if (exercises === null) return null;
    const valid = exercises.filter((id) => !blacklist.isBlacklisted(id));
    const counts = valid.map(tryExerciseTrials).filter(isPresent);
    const result = counts.length === 0 ? null : average(counts);
    lessonTrialsCache.set(lessonId, result);
    return result;
  };

  const getCourseNumTrials = (courseId: UnitId): number | null => {
    const cached = courseTrialsCache.get(courseId);
    if (cached !== undefined) return cached;

    const lessons = graph.getCourseLessons(courseId) ?? [];
    const valid = lessons.filter(
      (id) => !blacklist.isBlacklisted(id) && !isUnitSuperseded(id),
    );
    const counts = valid.map(getLessonNumTrials).filter(isPresent);
    const result = counts.length === 0 ? null : average(counts);
    courseTrialsCache.set(courseId, result);
    return result;
  };

  const getAvgTrials = (unitId: UnitId) => {
    const kind = graph.getUnitType(unitId);
    if (kind === 'course') return getCourseNumTrials(unitId);
    if (kind === 'lesson') return getLessonNumTrials(unitId);
    return null;
  };

  const dropCourse = (courseId: UnitId | null) => {
    if (courseId === null) return;
    courseCache.delete(courseId);
    courseTrialsCache.delete(courseId);
  };

  const dropLesson = (lessonId: UnitId) => {
    lessonCache.delete(lessonId);
    lessonTrialsCache.delete(lessonId);
  };

  const dropExercisesOf = (lessonId: UnitId) => {
    for (const exerciseId of graph.getLessonExercises(lessonId) ?? []) {
      exerciseCache.delete(exerciseId);
    }
  };

  const invalidateOne = (unitId: UnitId) => {
    exerciseCache.delete(unitId);
    dropLesson(unitId);
    dropCourse(unitId);

    const kind = graph.getUnitType(unitId);
    if (kind === 'exercise') {
      const lessonId = graph.getExerciseLesson(unitId);
      if (lessonId === null) return;
      dropLesson(lessonId);
      dropCourse(graph.getLessonCourse(lessonId));
    } else if (kind === 'lesson') {
      dropCourse(graph.getLessonCourse(unitId));
      dropExercisesOf(unitId);
    } else if (kind === 'course') {
      for (const lessonId of graph.getCourseLessons(unitId) ?? []) {
        dropLesson(lessonId);
        dropExercisesOf(lessonId);
      }
    }
  };

  const invalidate = (unitIds: readonly UnitId[]) => {
    for (const unitId of unitIds) invalidateOne(unitId);
  };

  const invalidateWithPrefix = (prefix: string) => {
    const caches = [
      exerciseCache,
      lessonCache,
      courseCache,
      lessonTrialsCache,
      courseTrialsCache,
    ];
    for (const cache of caches) {
      for (const key of [...cache.keys()]) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
    }
  };

  const getScorerInfo = (): ScorerInfoDto => ({
    ...exerciseScorer.info,
    numTrials: deps.options().numTrials,
  });

  const cacheKeys = () => ({
    exercise: [...exerciseCache.keys()],
    lesson: [...lessonCache.keys()],
    course: [...courseCache.keys()],
    lessonTrials: [...lessonTrialsCache.keys()],
    courseTrials: [...courseTrialsCache.keys()],
  });

  return {
    getUnitScore,
    getExerciseUrgency: (id) => loadExercise(id).urgency,
    getExerciseVelocity: (id) => loadExercise(id).velocity,
    getExerciseNumTrials: (id) => loadExercise(id).numTrials,
    getAvgTrials,
    allValidExercisesHaveScores,
    isSuperseded,
    getSupersedingRecursive,
    invalidate,
    invalidateWithPrefix,
    getScorerInfo,
    cacheKeys,
  };
};
