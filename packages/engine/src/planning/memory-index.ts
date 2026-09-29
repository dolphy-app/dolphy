import type { SchedulerOptionsDto, UnitId } from '@lms/engine-contract';
import type {
  EffectiveAttempt,
  MemoryIndex as MemoryIndexPort,
} from '../app/context.ts';
import type { Library } from '../domain/library.ts';
import type { MemoryModel } from '../ports/index.ts';
import type { ReplayedMemory } from '../scoring/fsrs-scorer.ts';
import { type RatingMapName, RATING_MAPS } from '../scoring/rating-map.ts';
import { type CreditModel, createCreditModel } from './credit-model.ts';
import {
  type FireState,
  type ForgettingCurve,
  type Rating,
  FSRS_CURVE,
  createFractionalStepper,
} from './fractional.ts';
import {
  type EncompassMode,
  type PlanGraph,
  buildPlanGraph,
} from './plan-graph.ts';

/** Неявный рейтинг не выше Good (engine-ts.md §6a.2). */
const IMPLICIT_RATING_CAP: Rating = 3;

export interface MemoryIndexDeps {
  readonly memoryModel: MemoryModel;
  /** Как в `FsrsScorer`; по умолчанию `runner`. */
  readonly ratingMap?: RatingMapName;
  /** Читается при каждом применении: смена опций даёт полный реплей. */
  options(): Pick<SchedulerOptionsDto, 'implicitCredit'>;
  /** По умолчанию `declared`. */
  readonly encompassMode?: EncompassMode;
  readonly curve?: ForgettingCurve;
}

export interface MemoryIndexStats {
  /** Реальных попыток применено при последнем реплее/применении. */
  attempts: number;
  implicitUpdates: number;
  /** Полные реплеи из-за позднего прихода, смены библиотеки или опций. */
  replays: number;
}

/** Побитовый дамп состояния для проверок `rebuild == incremental`. */
export interface MemorySnapshot {
  stability: number[];
  difficulty: number[];
  lastAt: number[];
  trials: number[];
}

export interface MemoryIndexProjection extends MemoryIndexPort {
  readonly stats: MemoryIndexStats;
  /** Число реальных попыток упражнения в индексе. */
  trialsOf(exerciseId: UnitId): number;
  snapshot(): MemorySnapshot;
}

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

const compareAttempts = (a: EffectiveAttempt, b: EffectiveAttempt) =>
  a.at - b.at ||
  compareStrings(a.deviceId, b.deviceId) ||
  a.seq - b.seq ||
  compareStrings(a.id, b.id);

/**
 * `MemoryIndex` (engine-ts.md §5.2): на упражнение `{S, D, lastAt}` и счётчик
 * реальных попыток. Реальная попытка — `step`; при включённом
 * `implicitCredit` — ещё и дробный шаг для каждого упражнения с состоянием в
 * охваченных уроках (провал и `rating < 2` кредита не дают; сложность в v1 не
 * меняется). Порядок применения — ключ журнала `(at, deviceId, seq, id)`;
 * поздний приход вставляется в порядок и проигрывается заново, дубликат по `id`
 * игнорируется, упражнения вне библиотеки пропускаются. Один и тот же код
 * складывает состояние и в `rebuild`, и в `apply`, поэтому результаты равны
 * побитово.
 */
export const createMemoryIndex = (
  deps: MemoryIndexDeps,
): MemoryIndexProjection => {
  const ratings = RATING_MAPS[deps.ratingMap ?? 'runner'];
  const stepper = createFractionalStepper(
    deps.memoryModel,
    deps.curve ?? FSRS_CURVE,
  );

  let library: Library | null = null;
  let graph: PlanGraph | null = null;
  let credit: CreditModel | null = null;
  let creditSignature = '';
  let stability = new Float64Array(0);
  let difficulty = new Float64Array(0);
  let lastAt = new Float64Array(0);
  let has = new Uint8Array(0);
  let trials = new Uint32Array(0);
  let log: EffectiveAttempt[] = [];
  const seen = new Set<string>();
  const stats: MemoryIndexStats = {
    attempts: 0,
    implicitUpdates: 0,
    replays: 0,
  };

  const signatureOf = ({
    implicitCredit,
  }: Pick<SchedulerOptionsDto, 'implicitCredit'>) =>
    implicitCredit.enabled
      ? `${implicitCredit.lambda}:${implicitCredit.minCredit}:${implicitCredit.kappa}`
      : 'off';

  const allocate = (size: number) => {
    stability = new Float64Array(size);
    difficulty = new Float64Array(size);
    lastAt = new Float64Array(size);
    has = new Uint8Array(size);
    trials = new Uint32Array(size);
  };

  /** Подстраивает граф и кредит под библиотеку и опции; `true` — нужен реплей. */
  const configure = (next: Library | null): boolean => {
    let changed = false;
    if (next !== library) {
      library = next;
      graph = next === null ? null : buildPlanGraph(next, deps.encompassMode);
      creditSignature = '';
      credit = null;
      allocate(graph?.exerciseCount ?? 0);
      changed = true;
    }
    const options = deps.options();
    const signature = signatureOf(options);
    if (graph !== null && signature !== creditSignature) {
      credit =
        signature === 'off'
          ? null
          : createCreditModel(graph, options.implicitCredit);
      if (creditSignature !== '') changed = true;
      creditSignature = signature;
    }
    return changed;
  };

  const stateOf = (exercise: number): FireState | null =>
    has[exercise] === 1
      ? {
          stability: stability[exercise] as number,
          difficulty: difficulty[exercise] as number,
          lastAt: lastAt[exercise] as number,
        }
      : null;

  const put = (exercise: number, state: FireState) => {
    stability[exercise] = state.stability;
    difficulty[exercise] = state.difficulty;
    lastAt[exercise] = state.lastAt;
    has[exercise] = 1;
  };

  const applyInOrder = (attempt: EffectiveAttempt) => {
    if (graph === null) return;
    const exercise = graph.exerciseIndex.get(attempt.exerciseId);
    if (exercise === undefined) return;
    const rating = ratings[attempt.grade - 1] as Rating;
    put(exercise, stepper.review(stateOf(exercise), attempt.at, rating));
    (trials[exercise] as number)++;
    stats.attempts++;
    if (credit === null || rating < 2) return;
    const implicit = Math.min(rating, IMPLICIT_RATING_CAP) as Rating;
    const lesson = graph.exerciseLesson[exercise] as number;
    for (const { lesson: target, weight } of credit.of(lesson)) {
      for (const other of graph.lessonExercises[target] as readonly number[]) {
        const state = stateOf(other);
        if (state === null) continue;
        const next = stepper.fractional(state, attempt.at, implicit, weight, {
          updateDifficulty: false,
        });
        if (next !== null) put(other, next);
        stats.implicitUpdates++;
      }
    }
  };

  const reset = () => {
    stability.fill(0);
    difficulty.fill(0);
    lastAt.fill(0);
    has.fill(0);
    trials.fill(0);
    stats.attempts = 0;
    stats.implicitUpdates = 0;
  };

  const replay = () => {
    reset();
    stats.replays++;
    for (const attempt of log) applyInOrder(attempt);
  };

  const rebuild = (
    attempts: readonly EffectiveAttempt[],
    next: Library | null,
  ) => {
    configure(next);
    seen.clear();
    const unique: EffectiveAttempt[] = [];
    for (const attempt of attempts) {
      if (seen.has(attempt.id)) continue;
      seen.add(attempt.id);
      unique.push(attempt);
    }
    log = unique.sort(compareAttempts);
    reset();
    for (const attempt of log) applyInOrder(attempt);
  };

  const apply = (attempt: EffectiveAttempt, next: Library | null) => {
    const changed = configure(next);
    if (seen.has(attempt.id)) {
      if (changed) replay();
      return;
    }
    seen.add(attempt.id);
    const last = log[log.length - 1];
    if (last === undefined || compareAttempts(last, attempt) < 0) {
      log.push(attempt);
      if (changed) replay();
      else applyInOrder(attempt);
      return;
    }
    let low = 0;
    let high = log.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareAttempts(log[middle] as EffectiveAttempt, attempt) < 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    log.splice(low, 0, attempt);
    replay();
  };

  const clear = () => {
    library = null;
    graph = null;
    credit = null;
    creditSignature = '';
    allocate(0);
    log = [];
    seen.clear();
    stats.attempts = 0;
    stats.implicitUpdates = 0;
  };

  const getMemory = (exerciseId: UnitId): ReplayedMemory | null => {
    const exercise = graph?.exerciseIndex.get(exerciseId);
    if (exercise === undefined || has[exercise] !== 1) return null;
    return {
      state: {
        stability: stability[exercise] as number,
        difficulty: difficulty[exercise] as number,
      },
      lastAt: lastAt[exercise] as number,
    };
  };

  function* attemptedExerciseIds() {
    if (graph === null) return;
    for (let exercise = 0; exercise < graph.exerciseCount; exercise++) {
      if (has[exercise] === 1) yield graph.exerciseIds[exercise] as UnitId;
    }
  }

  return {
    stats,
    rebuild,
    apply,
    clear,
    getMemory,
    attemptedExerciseIds,
    trialsOf: (exerciseId) => {
      const exercise = graph?.exerciseIndex.get(exerciseId);
      return exercise === undefined ? 0 : (trials[exercise] as number);
    },
    snapshot: () => ({
      stability: [...stability],
      difficulty: [...difficulty],
      lastAt: [...lastAt],
      trials: [...trials],
    }),
  };
};
