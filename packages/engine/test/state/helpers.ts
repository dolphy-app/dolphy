import type { SchedulerOptionsDto, UnitId } from '@spirula/engine-contract';
import type { CourseLibrary } from '@spirula/testkit';
import { assembleLibrary } from '../../src/domain/library.ts';
import type { Library } from '../../src/domain/library.ts';
import type { Projections } from '../../src/app/index.ts';
import { createMemoryIndex } from '../../src/planning/memory-index.ts';
import { DEFAULT_SCHEDULER_OPTIONS } from '../../src/scheduler/options.ts';
import { createFsrsScorer } from '../../src/scoring/fsrs-scorer.ts';
import { createTsFsrsMemoryModel } from '../../src/scoring/memory-model.ts';
import { createCurrentScoringGraph } from '../../src/state/current-graph.ts';
import { createProjections } from '../../src/state/projections.ts';

export const toLibrary = (source: CourseLibrary): Library =>
  assembleLibrary(source.courses, source.lessons, source.exercises, {
    cycleCheck: true,
  });

export interface TestProjections {
  projections: Projections;
  library: Library;
  options: SchedulerOptionsDto;
}

/** Проекции без движка: граф и опции фиксированы, память — настоящий `MemoryIndex` M6. */
export const createTestProjections = (
  library: Library,
  options: SchedulerOptionsDto = DEFAULT_SCHEDULER_OPTIONS,
): TestProjections => {
  const memoryModel = createTsFsrsMemoryModel();
  const fsrs = createFsrsScorer({ memory: memoryModel });
  const projections = createProjections({
    library: () => library,
    options: () => options,
    fsrs,
    memoryModel,
    graph: createCurrentScoringGraph(() => library),
    createMemoryIndex: () =>
      createMemoryIndex({
        memoryModel,
        ratingMap: fsrs.ratingMap,
        options: () => options,
      }),
  });
  return { projections, library, options };
};

/** Полное наблюдаемое состояние проекций: сравнивается сериализацией (побитово). */
export const snapshotOf = (
  { projections, library, options }: TestProjections,
  exerciseIds: readonly UnitId[] = library.getAllExerciseIds(),
): string => {
  const unitIds = [...library.graph.unitIds()].sort();
  const attempts = exerciseIds.map((id) => ({
    id,
    count: projections.attempts.count(id),
    records: projections.attempts
      .getRecords(id)
      .map(({ id: eventId }) => eventId),
    cut: projections.attempts.cutOf(id),
  }));
  const rewards = unitIds.map((id) => ({
    id,
    rewards: projections.rewards.getRewards(id, 20),
  }));
  const memory = exerciseIds.map((id) => ({
    id,
    memory: projections.memory.getMemory(id),
  }));
  const remediation = exerciseIds.map((id) =>
    projections.remediation.getPlan(id),
  );
  return JSON.stringify({
    attempts,
    flags: {
      blacklist: projections.flags.list('blacklist'),
      review: projections.flags.list('review'),
    },
    rewards,
    memory,
    remediation,
    pending: projections.remediation.pendingExerciseIds(
      options.remediation.maxItems,
    ),
  });
};
