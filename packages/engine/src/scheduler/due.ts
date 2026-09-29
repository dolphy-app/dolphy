import type {
  DueItemDto,
  SchedulerOptionsDto,
  UnitId,
} from '@lms/engine-contract';
import type { Clock, MemoryModel } from '../ports/index.ts';
import { MS_PER_DAY } from '../scoring/constants.ts';
import { ScoringError } from '../scoring/errors.ts';
import type { FsrsScorer, ReplayedMemory } from '../scoring/fsrs-scorer.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import type { AttemptSource, UnitScorer } from '../scoring/unit-scorer.ts';
import type { SchedulerLibrary } from './data.ts';

/**
 * Состояние памяти упражнений с попытками (`MemoryIndex` M4 или реплей
 * попыток): по нему считается извлекаемость R.
 */
export interface MemorySource {
  /** Упражнения, у которых есть хотя бы одна попытка. */
  attemptedExerciseIds(): Iterable<UnitId>;
  getMemory(exerciseId: UnitId): ReplayedMemory | null;
}

/** Источник попыток, который умеет перечислять упражнения с попытками. */
export interface AttemptCatalog extends AttemptSource {
  attemptedExerciseIds(): Iterable<UnitId>;
}

/** `MemorySource` поверх реплея окна попыток через `FsrsScorer.replay`. */
export const createReplayMemorySource = (
  attempts: AttemptCatalog,
  fsrs: Pick<FsrsScorer, 'replay'>,
  numTrials: () => number,
): MemorySource => ({
  attemptedExerciseIds: () => attempts.attemptedExerciseIds(),
  getMemory: (exerciseId) =>
    fsrs.replay(attempts.getTrials(exerciseId, numTrials())),
});

export interface DueDeps {
  readonly clock: Clock;
  /** Текущая библиотека; читается при каждом запросе. */
  library(): SchedulerLibrary;
  readonly scorer: UnitScorer;
  readonly blacklist: BlacklistView;
  readonly memory: MemorySource;
  readonly memoryModel: Pick<MemoryModel, 'retrievability'>;
  options(): Pick<SchedulerOptionsDto, 'plan'>;
}

export interface DueQuery {
  /** Отсечь упражнения с `need = 1 − R` ниже порога. */
  readonly minNeed?: number;
}

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * Извлекаемость R на момент `nowMs`: дробные сутки с последней попытки (не
 * отрицательные), результат в [0, 1]; нечисловой результат модели — 0.
 */
export const retrievabilityAt = (
  model: Pick<MemoryModel, 'retrievability'>,
  memory: ReplayedMemory,
  nowMs: number,
) => {
  const days = Math.max(nowMs - memory.lastAt, 0) / MS_PER_DAY;
  const raw = model.retrievability(memory.state, days);
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0;
};

/**
 * Упражнения с состоянием памяти и `R ≤ plan.targetRetention`, по убыванию
 * `need = 1 − R` (при равенстве — по id). Упражнения вне библиотеки и внутри
 * blacklist (сами, урок или курс) пропускаются. Не меняет состояния.
 */
export const getDue = (deps: DueDeps, query: DueQuery = {}): DueItemDto[] => {
  const { scorer, blacklist, memory, memoryModel } = deps;
  const { graph } = deps.library();
  const { targetRetention } = deps.options().plan;
  const minNeed = query.minNeed ?? 0;
  const nowMs = deps.clock.now();

  const isInsideBlacklist = (exerciseId: UnitId, lessonId: UnitId) => {
    const courseId = graph.getLessonCourse(lessonId) ?? '';
    return (
      blacklist.isBlacklisted(exerciseId) ||
      blacklist.isBlacklisted(lessonId) ||
      blacklist.isBlacklisted(courseId)
    );
  };

  const scoreOf = (exerciseId: UnitId) => {
    try {
      return scorer.getUnitScore(exerciseId) ?? 0;
    } catch (error) {
      if (error instanceof ScoringError) return 0;
      throw error;
    }
  };

  const items: DueItemDto[] = [];
  for (const exerciseId of memory.attemptedExerciseIds()) {
    const lessonId = graph.getExerciseLesson(exerciseId);
    if (lessonId === undefined) continue;
    if (isInsideBlacklist(exerciseId, lessonId)) continue;
    const state = memory.getMemory(exerciseId);
    if (state === null) continue;
    const retrievability = retrievabilityAt(memoryModel, state, nowMs);
    const need = 1 - retrievability;
    if (retrievability > targetRetention || need < minNeed) continue;
    items.push({
      exerciseId,
      lessonId,
      need,
      retrievability,
      score: scoreOf(exerciseId),
      lastAttemptAt: state.lastAt,
    });
  }
  return items.sort(
    (a, b) => b.need - a.need || compareStrings(a.exerciseId, b.exerciseId),
  );
};
