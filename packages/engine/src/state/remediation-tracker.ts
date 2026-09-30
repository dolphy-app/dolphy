import type {
  RemediationDto,
  RemediationStepDto,
  SchedulerOptionsDto,
  UnitId,
} from '@dolphy-app/engine-contract';
import type {
  AttemptIndex,
  AttemptRecord,
  RemediationTracker,
} from '../app/context.ts';
import type { Library } from '../domain/library.ts';
import type { MemoryModel } from '../ports/index.ts';
import { retrievabilityAt } from '../scheduler/due.ts';
import type { FsrsScorer } from '../scoring/fsrs-scorer.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import { compareEntryKeys } from './attempt-index.ts';

/** Оценки 1–2 — неудача, 3–5 — успех (как в `SessionState`, `RelearnPile`). */
const FAILING_GRADE_MAX = 2;

export interface RemediationDeps {
  readonly attempts: AttemptIndex;
  /** Текущая библиотека; `null` — не загружена или с ошибками. */
  library(): Library | null;
  options(): Pick<SchedulerOptionsDto, 'remediation'>;
  readonly blacklist: BlacklistView;
  readonly fsrs: Pick<FsrsScorer, 'replay'>;
  readonly memoryModel: Pick<MemoryModel, 'retrievability'>;
}

export interface RemediationTrackerHandle extends RemediationTracker {
  /**
   * Применена попытка упражнения: пересчитать, есть ли у него триггер, и
   * сбросить кэш планов (успех на упражнении шага влияет на чужой план).
   */
  noteAttempt(exerciseId: UnitId): void;
}

interface PlanEntry {
  readonly dto: RemediationDto;
  /** Упражнения шагов без успеха после триггера, в порядке шагов. */
  readonly remaining: readonly UnitId[];
  readonly triggerId: string;
}

interface StepSource {
  unitId: UnitId;
  source: RemediationStepDto['source'];
}

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

const isFailure = (record: AttemptRecord) => record.grade <= FAILING_GRADE_MAX;

const emptyPlan = (exerciseId: UnitId): RemediationDto => ({
  exerciseId,
  active: false,
  steps: [],
});

/**
 * Ремедиация (engine-ts.md §6a.5) — чистая функция неотменённых попыток,
 * графа и опций; собственных записей нет, поэтому порядок применения записей
 * не важен и `rebuild == incremental`. Триггер упражнения — попытка, после
 * которой серия неудач подряд достигла `failThreshold` (последняя такая
 * серия; следующие неудачи серии триггер не повторяют). Шаги строятся на
 * момент триггера: R считается по попыткам с ключом не больше триггера, не
 * начатые упражнения идут первыми (R = 0) по порядку id.
 */
export const createRemediationTracker = (
  deps: RemediationDeps,
): RemediationTrackerHandle => {
  const { attempts, blacklist, fsrs, memoryModel } = deps;
  let candidates: Set<UnitId> | null = null;
  const plans = new Map<UnitId, PlanEntry | null>();

  /** Попытка, породившая последний триггер упражнения, или `null`. */
  const triggerOf = (exerciseId: UnitId): AttemptRecord | null => {
    const { failThreshold } = deps.options().remediation;
    const newestFirst = attempts.getRecords(exerciseId);
    let streak = 0;
    let trigger: AttemptRecord | null = null;
    for (let i = newestFirst.length - 1; i >= 0; i--) {
      const record = newestFirst[i] as AttemptRecord;
      if (!isFailure(record)) {
        streak = 0;
        continue;
      }
      streak++;
      if (streak === failThreshold) trigger = record;
    }
    return trigger;
  };

  const isInsideBlacklist = (library: Library, exerciseId: UnitId) => {
    const lessonId = library.graph.getExerciseLesson(exerciseId) ?? '';
    const courseId = library.graph.getLessonCourse(lessonId) ?? '';
    return (
      blacklist.isBlacklisted(exerciseId) ||
      blacklist.isBlacklisted(lessonId) ||
      blacklist.isBlacklisted(courseId)
    );
  };

  /** R на момент триггера; не начатое упражнение — 0. */
  const retrievabilityAtTrigger = (
    exerciseId: UnitId,
    trigger: AttemptRecord,
  ) => {
    const trials = attempts
      .getRecords(exerciseId)
      .filter((record) => compareEntryKeys(record, trigger) <= 0)
      .map(({ grade, at }) => ({ score: grade, timestamp: at }));
    const memory = fsrs.replay(trials);
    return memory === null
      ? 0
      : retrievabilityAt(memoryModel, memory, trigger.at);
  };

  /** Упражнения юнита по возрастанию R (не начатые — по id), без blacklist. */
  const rankExercises = (
    library: Library,
    unitId: UnitId,
    trigger: AttemptRecord,
  ) =>
    library.graph
      .getExercisesUnder(unitId)
      .filter((id) => !isInsideBlacklist(library, id))
      .map((id) => ({ id, r: retrievabilityAtTrigger(id, trigger) }))
      .sort((a, b) => a.r - b.r || compareStrings(a.id, b.id));

  const stepSources = (
    library: Library,
    exerciseId: UnitId,
    trigger: AttemptRecord,
  ): StepSource[] => {
    const keyPrerequisites =
      library.getExercise(exerciseId)?.engine?.keyPrerequisites ?? [];
    const known = (unitId: UnitId) =>
      library.graph.getUnitType(unitId) !== undefined;
    if (keyPrerequisites.length > 0) {
      return keyPrerequisites
        .filter(known)
        .map((unitId) => ({ unitId, source: 'key-prerequisite' as const }));
    }
    const lessonId = library.graph.getExerciseLesson(exerciseId);
    const dependencies =
      lessonId === undefined
        ? []
        : [...(library.graph.getDependencies(lessonId) ?? [])].filter(known);
    const meanR = (unitId: UnitId) => {
      const ranked = rankExercises(library, unitId, trigger);
      return ranked.length === 0
        ? Infinity
        : ranked.reduce((sum, { r }) => sum + r, 0) / ranked.length;
    };
    return dependencies
      .map((unitId) => ({
        unitId,
        source: 'lesson-dependency' as const,
        r: meanR(unitId),
      }))
      .sort((a, b) => a.r - b.r || compareStrings(a.unitId, b.unitId))
      .map(({ unitId, source }) => ({ unitId, source }));
  };

  const hasSuccessAfter = (exerciseId: UnitId, trigger: AttemptRecord) =>
    attempts
      .getRecords(exerciseId)
      .some(
        (record) => compareEntryKeys(record, trigger) > 0 && !isFailure(record),
      );

  const buildPlan = (
    library: Library,
    exerciseId: UnitId,
    trigger: AttemptRecord,
  ): PlanEntry => {
    let budget = deps.options().remediation.maxItems;
    const steps: RemediationStepDto[] = [];
    const remaining: UnitId[] = [];
    for (const { unitId, source } of stepSources(
      library,
      exerciseId,
      trigger,
    )) {
      if (budget <= 0) break;
      const chosen = rankExercises(library, unitId, trigger)
        .slice(0, budget)
        .map(({ id }) => id);
      if (chosen.length === 0) continue;
      budget -= chosen.length;
      const pending = chosen.filter((id) => !hasSuccessAfter(id, trigger));
      remaining.push(...pending);
      steps.push({
        unitId,
        source,
        exerciseIds: chosen,
        done: pending.length === 0,
      });
    }
    return {
      dto: {
        exerciseId,
        active: steps.some(({ done }) => !done),
        triggeredAt: trigger.at,
        steps,
      },
      remaining,
      triggerId: trigger.id,
    };
  };

  const entryOf = (exerciseId: UnitId): PlanEntry | null => {
    const cached = plans.get(exerciseId);
    if (cached !== undefined) return cached;
    const library = deps.library();
    const trigger = library === null ? null : triggerOf(exerciseId);
    const entry =
      library === null || trigger === null
        ? null
        : buildPlan(library, exerciseId, trigger);
    plans.set(exerciseId, entry);
    return entry;
  };

  const candidateSet = (): ReadonlySet<UnitId> => {
    if (candidates !== null) return candidates;
    const found = new Set<UnitId>();
    for (const exerciseId of attempts.attemptedExerciseIds()) {
      if (triggerOf(exerciseId) !== null) found.add(exerciseId);
    }
    candidates = found;
    return found;
  };

  const getPlan: RemediationTracker['getPlan'] = (exerciseId) =>
    entryOf(exerciseId)?.dto ?? emptyPlan(exerciseId);

  const activeEntries = (): PlanEntry[] => {
    const active: PlanEntry[] = [];
    for (const exerciseId of candidateSet()) {
      const entry = entryOf(exerciseId);
      if (entry?.dto.active) active.push(entry);
    }
    return active.sort(
      (a, b) =>
        (b.dto.triggeredAt ?? 0) - (a.dto.triggeredAt ?? 0) ||
        compareStrings(a.dto.exerciseId, b.dto.exerciseId),
    );
  };

  const pendingExerciseIds: RemediationTracker['pendingExerciseIds'] = (
    limit = deps.options().remediation.maxItems,
  ) => {
    const picked = new Set<UnitId>();
    const library = deps.library();
    if (library === null) return [];
    for (const { remaining } of activeEntries()) {
      for (const id of remaining) {
        if (picked.size >= limit) return [...picked];
        if (!isInsideBlacklist(library, id)) picked.add(id);
      }
    }
    return [...picked];
  };

  const onAttempt: RemediationTracker['onAttempt'] = (entry) => {
    const found = entryOf(entry.exerciseId);
    if (found === null || found.triggerId !== entry.id) return null;
    return found.dto.steps.length === 0 ? null : found.dto;
  };

  const noteAttempt = (exerciseId: UnitId) => {
    plans.clear();
    if (candidates === null) return;
    if (triggerOf(exerciseId) === null) candidates.delete(exerciseId);
    else candidates.add(exerciseId);
  };

  const invalidate = () => {
    plans.clear();
    candidates = null;
  };

  return {
    getPlan,
    activePlans: () => activeEntries().map(({ dto }) => dto),
    pendingExerciseIds,
    onAttempt,
    noteAttempt,
    invalidate,
  };
};
