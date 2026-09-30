/**
 * Тестовый «мир» планировщика: библиотека из компактной спецификации,
 * локальные фейки состояния (попытки, награды, blacklist, review list,
 * сохранённые фильтры), скорер, единый холдер опций, сессия и сам
 * `DepthFirstScheduler`. Аналог `init_test_simulation` из `test_utils.rs`.
 *
 * Запись попытки повторяет `score_exercise` Trane: попытка → инвалидация →
 * пул повторов и success rate → награды → инвалидация обновлённых.
 */
import type {
  DeepPartial,
  ExerciseFilterDto,
  Grade,
  SchedulerOptionsDto,
  UnitId,
} from '@spirula/engine-contract';
import { createFakeClock, createSeededRng } from '@spirula/testkit';
import type { FakeClock, SeededRng } from '@spirula/testkit';
import { buildCourse, buildExercise, buildLesson } from '@spirula/testkit';
import { assembleLibrary } from '../../../src/domain/library.ts';
import type { Library } from '../../../src/domain/library.ts';
import type { Metadata } from '../../../src/domain/manifest.ts';
import type { Rng } from '../../../src/ports/index.ts';
import {
  type ExerciseScorer,
  type ExerciseTrial,
  type FsrsScorer,
  type Precision,
  type UnitScorer,
  createFsrsScorer,
  createPowerLawScorer,
  createRewardIndex,
  createUnitScorer,
  propagateRewards,
} from '../../../src/scoring/index.ts';
import { createTsFsrsMemoryModel } from '../../../src/scoring/memory-model.ts';
import {
  type AttemptCatalog,
  type DepthFirstScheduler,
  type SchedulerOptionsHolder,
  type SessionState,
  createDepthFirstScheduler,
  createReplayMemorySource,
  createSchedulerOptions,
  createSchedulerOptionsHolder,
  createSessionState,
  getDue,
  getFrontier,
  toScoringGraph,
} from '../../../src/scheduler/index.ts';
import type {
  DueItemDto,
  FrontierItemDto,
  SavedFilterDto,
} from '@spirula/engine-contract';
import type { MemoryModel } from '../../../src/ports/index.ts';

export interface WorldLessonSpec {
  /** Полный id урока: `курс::урок`. */
  id: UnitId;
  dependencies?: UnitId[];
  encompassed?: Array<[UnitId, number]>;
  superseded?: UnitId[];
  /** Число упражнений (`<урок>::0`, …) или явные id. */
  exercises: number | UnitId[];
  metadata?: Metadata;
}

export interface WorldCourseSpec {
  id: UnitId;
  dependencies?: UnitId[];
  encompassed?: Array<[UnitId, number]>;
  superseded?: UnitId[];
  metadata?: Metadata;
  lessons: WorldLessonSpec[];
}

const exerciseIdsOf = (lesson: WorldLessonSpec) =>
  typeof lesson.exercises === 'number'
    ? Array.from({ length: lesson.exercises }, (_, i) => `${lesson.id}::${i}`)
    : lesson.exercises;

/**
 * Библиотека по спецификации. Упражнения `Procedural`, как в `test_utils.rs`
 * Trane; граф собран как в загрузчике (`assembleLibrary`).
 */
export const buildWorldLibrary = (
  courses: readonly WorldCourseSpec[],
): Library => {
  const courseManifests = [];
  const lessonManifests = [];
  const exerciseManifests = [];
  for (const course of courses) {
    courseManifests.push(
      buildCourse({
        id: course.id,
        dependencies: course.dependencies ?? [],
        encompassed: course.encompassed ?? [],
        superseded: course.superseded ?? [],
        metadata: course.metadata ?? null,
      }),
    );
    for (const lesson of course.lessons) {
      lessonManifests.push(
        buildLesson({
          id: lesson.id,
          course_id: course.id,
          dependencies: lesson.dependencies ?? [],
          encompassed: lesson.encompassed ?? [],
          superseded: lesson.superseded ?? [],
          metadata: lesson.metadata ?? null,
        }),
      );
      for (const exerciseId of exerciseIdsOf(lesson)) {
        exerciseManifests.push(
          buildExercise({
            id: exerciseId,
            lesson_id: lesson.id,
            course_id: course.id,
            exercise_type: 'Procedural',
          }),
        );
      }
    }
  }
  return assembleLibrary(courseManifests, lessonManifests, exerciseManifests, {
    cycleCheck: true,
  });
};

export interface WorldOptions {
  courses: readonly WorldCourseSpec[];
  seed?: number;
  /** Свой `Rng` вместо `createSeededRng(seed)`. */
  rng?: Rng;
  /** `f32` — двойник для сверки с Rust (планировщик и скорер). */
  precision?: Precision;
  /** `power-law` (как Rust) по умолчанию; `fsrs` — продукционный скорер. */
  scorer?: 'power-law' | 'fsrs';
  /** Патч опций планировщика поверх умолчаний. */
  options?: DeepPartial<SchedulerOptionsDto>;
  /** Стартовое время `FakeClock`; по умолчанию `T0_MS` testkit. */
  startMs?: number;
}

export interface World {
  readonly library: Library;
  readonly clock: FakeClock;
  readonly rng: Rng;
  readonly seed: number | null;
  readonly precision: Precision;
  readonly options: SchedulerOptionsHolder;
  readonly session: SessionState;
  readonly scorer: UnitScorer;
  readonly exerciseScorer: ExerciseScorer;
  /** Только для `scorer: 'fsrs'`. */
  readonly fsrs: FsrsScorer | null;
  readonly memoryModel: MemoryModel;
  readonly scheduler: DepthFirstScheduler;
  /** Изменяемый blacklist; `blacklist.add/remove` сбрасывают кэши оценок. */
  readonly blacklist: {
    add(unitId: UnitId): void;
    remove(unitId: UnitId): void;
    has(unitId: UnitId): boolean;
    entries(): UnitId[];
  };
  readonly reviewList: {
    add(unitId: UnitId): void;
    remove(unitId: UnitId): void;
    entries(): UnitId[];
  };
  readonly savedFilters: Map<string, SavedFilterDto>;
  readonly attempts: AttemptCatalog & {
    count(exerciseId: UnitId): number;
  };
  /**
   * Записывает попытку как `score_exercise`; `atMs` по умолчанию — текущее
   * время `clock`. `noteSession: false` не трогает пул повторов и success
   * rate (сверка с Rust: там сессия начинается с нуля).
   */
  record(
    exerciseId: UnitId,
    grade: Grade,
    options?: { atMs?: number; noteSession?: boolean },
  ): void;
  getBatch(filter?: ExerciseFilterDto): UnitId[];
  getFrontier(query?: { courseId?: UnitId }): FrontierItemDto[];
  /** Извлекаемость — по реплею FSRS, независимо от выбранного скорера упражнений. */
  getDue(query?: { minNeed?: number }): DueItemDto[];
}

/** Мир поверх готовой библиотеки (например, собранной сканером). */
export const createWorldFromLibrary = (
  library: Library,
  {
    seed,
    rng: customRng,
    precision = 'f64',
    scorer: scorerKind = 'power-law',
    options: patch,
    startMs,
  }: Omit<WorldOptions, 'courses'>,
): World => {
  const clock = createFakeClock(startMs);
  const seeded: SeededRng | null =
    customRng === undefined ? createSeededRng(seed ?? 1) : null;
  const rng = customRng ?? (seeded as SeededRng);
  const holder = createSchedulerOptionsHolder(createSchedulerOptions());
  if (patch !== undefined) holder.set(patch);
  const session = createSessionState({
    options: holder.get,
    rng,
    precision,
  });

  const trials = new Map<UnitId, ExerciseTrial[]>();
  const attempts = {
    getTrials: (exerciseId: UnitId, limit: number) =>
      (trials.get(exerciseId) ?? []).slice(0, limit),
    attemptedExerciseIds: () => trials.keys(),
    count: (exerciseId: UnitId) => trials.get(exerciseId)?.length ?? 0,
  };
  const blacklisted = new Set<UnitId>();
  const rewards = createRewardIndex();
  const scoringGraph = toScoringGraph(library.graph);
  const memoryModel = createTsFsrsMemoryModel();
  const fsrs =
    scorerKind === 'fsrs' ? createFsrsScorer({ memory: memoryModel }) : null;
  const exerciseScorer: ExerciseScorer =
    fsrs ?? createPowerLawScorer({ precision });
  const scorer = createUnitScorer({
    clock,
    graph: scoringGraph,
    blacklist: { isBlacklisted: (unitId) => blacklisted.has(unitId) },
    attempts,
    rewards,
    exerciseTypeOf: (id) => library.getExercise(id)?.exercise_type ?? null,
    exerciseScorer,
    options: holder.get,
  });

  const reviewEntries: UnitId[] = [];
  const savedFilters = new Map<string, SavedFilterDto>();
  const scheduler = createDepthFirstScheduler({
    clock,
    rng,
    library: () => library,
    scorer,
    blacklist: { isBlacklisted: (unitId) => blacklisted.has(unitId) },
    reviewList: { entries: () => reviewEntries },
    savedFilters: { getFilter: (id) => savedFilters.get(id) },
    options: holder.get,
    session,
    precision,
  });

  const record: World['record'] = (
    exerciseId,
    grade,
    { atMs = clock.now(), noteSession = true } = {},
  ) => {
    const history = trials.get(exerciseId) ?? [];
    // от новых к старым; при равных метках новая попытка считается новее
    const position = history.findIndex((trial) => trial.timestamp <= atMs);
    const at = position === -1 ? history.length : position;
    history.splice(at, 0, { score: grade, timestamp: atMs });
    trials.set(exerciseId, history);
    scorer.invalidate([exerciseId]);
    if (noteSession) session.noteResult(exerciseId, grade);
    const updated = rewards.record(
      propagateRewards(scoringGraph, exerciseId, grade, atMs),
    );
    scorer.invalidate(updated);
  };

  return {
    library,
    clock,
    rng,
    seed: seeded === null ? null : seeded.seed,
    precision,
    options: holder,
    session,
    scorer,
    exerciseScorer,
    fsrs,
    memoryModel,
    scheduler,
    blacklist: {
      add: (unitId) => {
        scorer.invalidate([unitId]);
        blacklisted.add(unitId);
      },
      remove: (unitId) => {
        scorer.invalidate([unitId]);
        blacklisted.delete(unitId);
      },
      has: (unitId) => blacklisted.has(unitId),
      entries: () => [...blacklisted],
    },
    reviewList: {
      add: (unitId) => {
        if (!reviewEntries.includes(unitId)) reviewEntries.push(unitId);
      },
      remove: (unitId) => {
        const index = reviewEntries.indexOf(unitId);
        if (index !== -1) reviewEntries.splice(index, 1);
      },
      entries: () => [...reviewEntries],
    },
    savedFilters,
    attempts,
    record,
    getBatch: (filter) =>
      scheduler.getExerciseBatch(filter).map((manifest) => manifest.id),
    getFrontier: (query) =>
      getFrontier(
        {
          library: () => library,
          scorer,
          blacklist: { isBlacklisted: (unitId) => blacklisted.has(unitId) },
          options: holder.get,
        },
        query,
      ),
    getDue: (query) =>
      getDue(
        {
          clock,
          library: () => library,
          scorer,
          blacklist: { isBlacklisted: (unitId) => blacklisted.has(unitId) },
          memory: createReplayMemorySource(
            attempts,
            fsrs ?? createFsrsScorer({ memory: memoryModel }),
            () => holder.get().numTrials,
          ),
          memoryModel,
          options: holder.get,
        },
        query,
      ),
  };
};

export const createWorld = (options: WorldOptions): World =>
  createWorldFromLibrary(buildWorldLibrary(options.courses), options);
