import type { UnitId } from '@lms/engine-contract';
import type {
  AttemptRecord,
  EntryKey,
  MemoryIndex,
  Projections,
} from '../app/context.ts';
import type { LogEntry } from '../domain/journal.ts';
import type { ScoringGraph } from '../scoring/graph.ts';
import { compareEntryKeys, createAttemptIndex } from './attempt-index.ts';
import { createFlagState } from './flag-state.ts';
import { createRemediationTracker } from './remediation-tracker.ts';
import type { RemediationDeps } from './remediation-tracker.ts';
import { createRewardProjection } from './reward-projection.ts';

export interface ProjectionsDeps extends Omit<
  RemediationDeps,
  'attempts' | 'blacklist'
> {
  /** Граф текущей библиотеки (см. `createCurrentScoringGraph`). */
  readonly graph: ScoringGraph;
  /** Поставщик `MemoryIndex` (`planning/memory-index.ts`). */
  createMemoryIndex(): MemoryIndex;
}

const unique = (ids: readonly UnitId[]): UnitId[] => [...new Set(ids)];

/**
 * Собирает проекции журнала (engine-ts.md §5.2) в один объект. Состояние
 * `AttemptIndex`, `FlagState` и границ сброса не зависит от порядка прихода;
 * производные проекции (награды, память, ремедиация) при записи новее всех
 * примененных обновляются на быстром пути, иначе помечаются устаревшими и
 * досчитываются при чтении — итог всегда равен полной перестройке.
 */
export const createProjections = (deps: ProjectionsDeps): Projections => {
  const { graph } = deps;
  const attempts = createAttemptIndex(() => graph);
  const flags = createFlagState();
  const rewards = createRewardProjection(attempts, graph);
  const remediation = createRemediationTracker({
    ...deps,
    attempts,
    blacklist: flags,
  });
  const memoryIndex = deps.createMemoryIndex();

  /** Наибольший ключ среди применённых попыток и сбросов. */
  let maxKey: EntryKey | null = null;
  let memoryStale = false;

  const noteKey = (entry: LogEntry) => {
    if (maxKey === null || compareEntryKeys(entry, maxKey) > 0) {
      const { at, deviceId, seq, id } = entry;
      maxKey = { at, deviceId, seq, id };
    }
  };

  const refreshMemory = () => {
    if (!memoryStale) return;
    memoryIndex.rebuild(attempts.allInOrder(), deps.library());
    memoryStale = false;
  };

  const memory: Projections['memory'] = {
    attemptedExerciseIds: () => {
      refreshMemory();
      return memoryIndex.attemptedExerciseIds();
    },
    getMemory: (exerciseId) => {
      refreshMemory();
      return memoryIndex.getMemory(exerciseId);
    },
  };

  const containersOf = (exerciseId: UnitId): UnitId[] => {
    const lessonId = graph.getExerciseLesson(exerciseId);
    const courseId = lessonId === null ? null : graph.getLessonCourse(lessonId);
    return [exerciseId, lessonId, courseId].filter(
      (id): id is UnitId => id !== null,
    );
  };

  const applyAttempt = (
    entry: Extract<LogEntry, { kind: 'attempt' }>,
  ): UnitId[] => {
    const inOrder = maxKey === null || compareEntryKeys(entry, maxKey) > 0;
    if (!attempts.applyAttempt(entry)) return [];
    noteKey(entry);
    remediation.noteAttempt(entry.exerciseId);
    const record: AttemptRecord = {
      at: entry.at,
      deviceId: entry.deviceId,
      seq: entry.seq,
      id: entry.id,
      exerciseId: entry.exerciseId,
      grade: entry.grade,
      source: entry.source,
    };
    if (!inOrder) {
      rewards.markStale();
      memoryStale = true;
      return containersOf(entry.exerciseId);
    }
    const rewarded = rewards.record(record);
    if (!memoryStale) memoryIndex.apply(record, deps.library());
    return unique([...containersOf(entry.exerciseId), ...rewarded]);
  };

  const apply: Projections['apply'] = (entry) => {
    if (entry.kind === 'attempt') return applyAttempt(entry);
    if (entry.kind === 'unit_flag') {
      attempts.noteUnit(entry.unitId);
      if (!flags.apply(entry)) return [];
      remediation.invalidate();
      return [entry.unitId];
    }
    if (!attempts.applyReset(entry.unitId, entry)) return [];
    noteKey(entry);
    rewards.markStale();
    memoryStale = true;
    remediation.invalidate();
    return [entry.unitId];
  };

  const invalidateDerived = () => {
    rewards.markStale();
    memoryStale = true;
    remediation.invalidate();
  };

  const clear = () => {
    attempts.clear();
    flags.clear();
    rewards.clear();
    memoryIndex.clear();
    remediation.invalidate();
    maxKey = null;
    memoryStale = false;
  };

  const rebuildFrom: Projections['rebuildFrom'] = async (entries) => {
    clear();
    let count = 0;
    for await (const entry of entries) {
      apply(entry);
      count++;
    }
    return count;
  };

  return {
    attempts,
    rewards,
    flags,
    memory,
    remediation,
    apply,
    rebuildFrom,
    invalidateDerived,
    isStale: () => memoryStale || rewards.isStale(),
    clear,
  };
};
