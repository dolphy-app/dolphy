import type {
  ExerciseFilterDto,
  KeyValueFilterWire,
  SchedulerOptionsDto,
  UnitFilterWire,
  UnitId,
} from '@spirula/engine-contract';
import type { ExerciseManifest } from '../domain/manifest.ts';
import type { Clock, Rng } from '../ports/index.ts';
import { ScoringError } from '../scoring/errors.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import type { UnitScorer } from '../scoring/unit-scorer.ts';
import type { Precision } from '../scoring/types.ts';
import { createCandidateFilter } from './candidate-filter.ts';
import {
  type ReviewListView,
  type SavedFilterSource,
  type SchedulerData,
  type SchedulerLibrary,
  createSchedulerData,
} from './data.ts';
import { FULL_CANDIDATES_SCORE } from './options.ts';
import { roundOf } from './precision.ts';
import { createReviewKnocker } from './review-knocker.ts';
import type { SessionState } from './session-state.ts';
import { shuffleCandidates } from './shuffler.ts';
import {
  type Candidate,
  type StackItem,
  SchedulerError,
  createCandidate,
} from './types.ts';

/** Поиск возвращается рано при тупике, если кандидатов ≥ `batchSize` × это число. */
export const MAX_CANDIDATE_FACTOR = 10;

type PassingScore = SchedulerOptionsDto['passingScore'];

/**
 * Урок или курс проходит порог, если средняя оценка и среднее число попыток
 * не ниже заданных. Нет данных (blacklist, юнит без валидных упражнений) —
 * проходит: поиск не блокируется на таких юнитах (`passes_threshold`).
 */
export const passesThreshold = (
  passing: PassingScore,
  averageScore: number | null,
  averageTrials: number | null,
) => {
  if (averageScore === null || averageTrials === null) return true;
  return (
    averageScore >= passing.minScore && averageTrials >= passing.minAvgTrials
  );
};

/** Убирает повторы по `exerciseId`; первый выигрывает, порядок сохраняется. */
export const deduplicateCandidates = (candidates: readonly Candidate[]) => {
  const seen = new Set<UnitId>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.exerciseId)) return false;
    seen.add(candidate.exerciseId);
    return true;
  });
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/**
 * Дробный отбор кандидатов урока по его средней оценке (`select_candidates`):
 * ниже `minScore` и от 4.0 — все; между ними доля растёт линейно от
 * `minFraction` до 1, но не меньше одного. Порядок обращений к `rng` — одно
 * перемешивание, если отбор происходит.
 */
export const selectCandidates = (
  candidates: readonly Candidate[],
  score: number,
  passing: PassingScore,
  rng: Rng,
  precision: Precision = 'f64',
): Candidate[] => {
  if (candidates.length === 0) return [];
  if (score >= FULL_CANDIDATES_SCORE || score < passing.minScore) {
    return [...candidates];
  }
  const round = roundOf(precision);
  const minFraction = clamp(round(passing.minFraction), 0, 1);
  const span = round(FULL_CANDIDATES_SCORE - round(passing.minScore));
  const progress = round(round(score - round(passing.minScore)) / span);
  const fraction = round(
    minFraction + round(progress * round(1.0 - minFraction)),
  );
  const clamped = clamp(fraction, 0, 1);
  let amount = Math.floor(round(clamped * candidates.length));
  if (clamped > 0 && amount === 0) amount = 1;
  const shuffled = [...candidates];
  rng.shuffle(shuffled);
  return shuffled.slice(0, amount);
};

/**
 * Добавляет кандидатов урока в общий список с учётом лимита уроков «в
 * процессе»: урок с оценкой не выше верхней границы окна `target` (или без
 * оценки) занимает слот; при нехватке слотов кандидаты урока отбрасываются.
 */
export const extendCandidates = (
  all: Candidate[],
  candidates: readonly Candidate[],
  lessonId: UnitId,
  lessonScore: number | null,
  lessonsInProgress: Set<UnitId>,
  options: Pick<SchedulerOptionsDto, 'masteryWindows' | 'maxLessonsInProgress'>,
) => {
  if (candidates.length === 0) return;
  const inProgress =
    lessonScore === null ||
    lessonScore <= options.masteryWindows.target.range[1];
  if (inProgress && !lessonsInProgress.has(lessonId)) {
    if (lessonsInProgress.size >= options.maxLessonsInProgress) return;
    lessonsInProgress.add(lessonId);
  }
  all.push(...candidates);
};

export interface DepthFirstSchedulerDeps {
  /** Часы для study session (в Rust — `Utc::now()`, не время планировщика). */
  readonly clock: Clock;
  readonly rng: Rng;
  /** Текущая библиотека; читается при каждом обращении. */
  library(): SchedulerLibrary;
  readonly scorer: UnitScorer;
  readonly blacklist: BlacklistView;
  readonly reviewList: ReviewListView;
  readonly savedFilters: SavedFilterSource;
  /** Единый источник опций планировщика (`SchedulerOptionsHolder.get`). */
  options(): SchedulerOptionsDto;
  readonly session: SessionState;
  /** `f32` — двойник для сверки с Rust; продукция — `f64`. */
  readonly precision?: Precision;
}

export interface DepthFirstScheduler {
  /**
   * Батч упражнений (`get_exercise_batch`): поиск кандидатов → knocker →
   * фильтр окон → релёрн → перемешивание. Увеличивает счётчики показов.
   * Ошибки данных — `SchedulerError`.
   */
  getExerciseBatch(filter?: ExerciseFilterDto): ExerciseManifest[];
  /** Кандидаты до knocker и фильтра, без побочных эффектов (кроме `rng`). */
  getInitialCandidates(filter?: ExerciseFilterDto): Candidate[];
  /** Стартовые уроки курса, зависимости которых выполнены. */
  getCourseValidStartingLessons(
    courseId: UnitId,
    metadataFilter?: KeyValueFilterWire | null,
  ): UnitId[];
}

interface SearchParams {
  readonly stack: StackItem[];
  readonly visited: Set<UnitId>;
  readonly metadataFilter: KeyValueFilterWire | null;
  readonly allowCourseTraversal: boolean;
  readonly allowedCourses: readonly UnitId[];
}

const EMPTY_SET: ReadonlySet<UnitId> = new Set();

const isSameSet = (a: ReadonlySet<UnitId>, b: ReadonlySet<UnitId>) => {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
};

/**
 * Планировщик Trane с обходом графа в глубину (`scheduler.rs`). Синхронный
 * и чистый по отношению к I/O: состояние ученика приходит через `scorer`,
 * blacklist, review list и `session`.
 */
export const createDepthFirstScheduler = (
  deps: DepthFirstSchedulerDeps,
): DepthFirstScheduler => {
  const { rng, scorer, session, blacklist } = deps;
  const precision = deps.precision ?? 'f64';
  const round = roundOf(precision);
  const data: SchedulerData = createSchedulerData({
    library: deps.library,
    blacklist,
    reviewList: deps.reviewList,
    savedFilters: deps.savedFilters,
  });
  const knocker = createReviewKnocker(() => data.graph());
  const candidateFilter = createCandidateFilter({
    options: deps.options,
    successRate: session.successRate,
    rng,
    precision,
  });

  /** `Err` Trane → `null`: ошибки скорера на входе не роняют проверки зависимостей. */
  const tryUnitScore = (unitId: UnitId) => {
    try {
      return scorer.getUnitScore(unitId);
    } catch (error) {
      if (error instanceof ScoringError) return null;
      throw error;
    }
  };

  const isUnitSuperseded = (unitId: UnitId) => {
    const superseding = scorer.getSupersedingRecursive(unitId) ?? EMPTY_SET;
    return scorer.isSuperseded(unitId, superseding);
  };

  /** `unit_passes_filter(...).unwrap_or(fallback)`: ошибка данных → запасное значение. */
  const passesOr = (
    unitId: UnitId,
    filter: KeyValueFilterWire | null,
    fallback: boolean,
  ) => {
    try {
      return data.unitPassesFilter(unitId, filter);
    } catch (error) {
      if (error instanceof SchedulerError) return fallback;
      throw error;
    }
  };

  const shuffleToStack = (
    current: StackItem,
    units: readonly UnitId[],
    stack: StackItem[],
  ) => {
    const shuffled = [...units];
    rng.shuffle(shuffled);
    for (const unitId of shuffled) {
      stack.push({ unitId, depth: current.depth + 1 });
    }
  };

  const satisfiedEffectiveDependency = (
    dependencyId: UnitId,
    passing: PassingScore,
  ) => {
    if (data.blacklisted(dependencyId)) return true;
    const courseId = data.getLessonCourse(dependencyId) ?? '';
    if (data.blacklisted(courseId)) return true;
    if (isUnitSuperseded(dependencyId)) return true;
    return passesThreshold(
      passing,
      tryUnitScore(dependencyId),
      scorer.getAvgTrials(dependencyId),
    );
  };

  /** Уроки курса, проходящие фильтр и без зависимых среди проходящих уроков. */
  const lastMatchingLessonsInCourse = (
    courseId: UnitId,
    filter: KeyValueFilterWire | null,
  ) => {
    const graph = data.graph();
    const lessons = [...(graph.getCourseLessons(courseId) ?? [])];
    const matching = new Set(
      lessons.filter((lessonId) => passesOr(lessonId, filter, false)),
    );
    const last = new Set<UnitId>();
    for (const lessonId of matching) {
      const dependents = graph.getDependents(lessonId) ?? EMPTY_SET;
      let hasMatchingDependent = false;
      for (const dependent of dependents) {
        if (matching.has(dependent)) hasMatchingDependent = true;
      }
      if (!hasMatchingDependent) last.add(lessonId);
    }
    return last;
  };

  /**
   * Эффективные зависимости с мостом через юниты, отфильтрованные
   * метаданными: отфильтрованный урок заменяется своими зависимостями (у
   * стартового — ещё и зависимостями курса), курс — последними
   * подходящими уроками или своими зависимостями.
   */
  const resolveEffectiveDependencies = (
    dependencyId: UnitId,
    filter: KeyValueFilterWire | null,
    visited: Set<UnitId>,
  ): Set<UnitId> => {
    if (visited.has(dependencyId)) return new Set();
    visited.add(dependencyId);
    if (passesOr(dependencyId, filter, false)) return new Set([dependencyId]);

    const graph = data.graph();
    const type = data.getUnitType(dependencyId);
    const next = new Set<UnitId>();
    if (type === 'Lesson') {
      for (const id of graph.getDependencies(dependencyId) ?? EMPTY_SET) {
        next.add(id);
      }
      const courseId = data.getLessonCourse(dependencyId) ?? '';
      const starting = graph.getStartingLessons(courseId) ?? EMPTY_SET;
      if (starting.has(dependencyId)) {
        for (const id of graph.getDependencies(courseId) ?? EMPTY_SET) {
          next.add(id);
        }
      }
    } else if (type === 'Course') {
      const last = lastMatchingLessonsInCourse(dependencyId, filter);
      if (last.size > 0) return last;
      for (const id of graph.getDependencies(dependencyId) ?? EMPTY_SET) {
        next.add(id);
      }
    } else {
      return new Set();
    }
    const resolved = new Set<UnitId>();
    for (const id of next) {
      for (const target of resolveEffectiveDependencies(id, filter, visited)) {
        resolved.add(target);
      }
    }
    return resolved;
  };

  const satisfiedDependency = (
    dependencyId: UnitId,
    filter: KeyValueFilterWire | null,
    passing: PassingScore,
  ) => {
    if (filter === null) {
      return satisfiedEffectiveDependency(dependencyId, passing);
    }
    const targets = resolveEffectiveDependencies(
      dependencyId,
      filter,
      new Set(),
    );
    if (targets.size === 0) return true;
    for (const target of targets) {
      if (!satisfiedEffectiveDependency(target, passing)) return false;
    }
    return true;
  };

  const allSatisfiedDependencies = (
    unitId: UnitId,
    filter: KeyValueFilterWire | null,
    passing: PassingScore,
  ) => {
    for (const id of data.graph().getDependencies(unitId) ?? EMPTY_SET) {
      if (!satisfiedDependency(id, filter, passing)) return false;
    }
    return true;
  };

  const getValidDependents = (
    unitId: UnitId,
    filter: KeyValueFilterWire | null,
    passing: PassingScore,
  ) =>
    data
      .getAllDependents(unitId)
      .filter((id) => allSatisfiedDependencies(id, filter, passing));

  const getCourseValidStartingLessons = (
    courseId: UnitId,
    filter: KeyValueFilterWire | null,
    passing: PassingScore,
  ) =>
    [...(data.graph().getStartingLessons(courseId) ?? EMPTY_SET)].filter((id) =>
      allSatisfiedDependencies(id, filter, passing),
    );

  const skipCourse = (
    courseId: UnitId,
    filter: KeyValueFilterWire | null,
    pending: Map<UnitId, number>,
  ) => {
    const isBlacklisted = data.blacklisted(courseId);
    const isFiltered = !passesOr(courseId, filter, true);
    if (!pending.has(courseId)) {
      pending.set(courseId, data.getNumLessonsInCourse(courseId));
    }
    const isSuperseded = isUnitSuperseded(courseId);
    return (
      isBlacklisted || isFiltered || pending.get(courseId) === 0 || isSuperseded
    );
  };

  const skipLesson = (lessonId: UnitId, filter: KeyValueFilterWire | null) => {
    const isBlacklisted = data.blacklisted(lessonId);
    const isFiltered = !passesOr(lessonId, filter, true);
    const isLessonSuperseded = isUnitSuperseded(lessonId);
    const courseId = data.getLessonCourse(lessonId) ?? '';
    const isCourseSuperseded = isUnitSuperseded(courseId);
    return (
      isBlacklisted || isFiltered || isLessonSuperseded || isCourseSuperseded
    );
  };

  const exerciseCandidate = (
    exerciseId: UnitId,
    lessonId: UnitId,
    courseId: UnitId,
    depth: number,
  ) =>
    createCandidate({
      exerciseId,
      lessonId,
      courseId,
      depth,
      exerciseScore: scorer.getUnitScore(exerciseId) ?? 0,
      urgency: scorer.getExerciseUrgency(exerciseId),
      velocity: scorer.getExerciseVelocity(exerciseId),
      frequency: session.frequencyOf(exerciseId),
    });

  /** Кандидаты урока и его средняя оценка до отбора (`get_candidates_from_lesson_helper`). */
  const getCandidatesFromLessonHelper = (
    item: StackItem,
    options: SchedulerOptionsDto,
  ) => {
    const exercises = data.allValidExercisesInLesson(item.unitId);
    if (exercises.length === 0) return { candidates: [], averageScore: 0 };
    const courseId = data.getLessonCourse(item.unitId) ?? '';
    const candidates = exercises.map((exerciseId) =>
      exerciseCandidate(exerciseId, item.unitId, courseId, item.depth + 1),
    );
    let sum = 0;
    for (const candidate of candidates) {
      sum = round(sum + candidate.exerciseScore);
    }
    const averageScore = round(sum / candidates.length);
    const selected = selectCandidates(
      candidates,
      averageScore,
      options.passingScore,
      rng,
      precision,
    );
    return { candidates: selected, averageScore };
  };

  const searchGraph = (
    params: SearchParams,
    options: SchedulerOptionsDto,
  ): Candidate[] => {
    const { stack, visited, metadataFilter, allowCourseTraversal } = params;
    const { passingScore: passing } = options;
    const maxCandidates = options.batchSize * MAX_CANDIDATE_FACTOR;
    const allCandidates: Candidate[] = [];
    const lessonsInProgress = new Set<UnitId>();
    const pendingCourseLessons = new Map<UnitId, number>();

    for (
      let current = stack.pop();
      current !== undefined;
      current = stack.pop()
    ) {
      if (visited.has(current.unitId)) continue;
      const type = data.getUnitType(current.unitId);
      if (type === undefined) continue;

      if (type === 'Course' && allowCourseTraversal) {
        const starting = getCourseValidStartingLessons(
          current.unitId,
          metadataFilter,
          passing,
        );
        shuffleToStack(current, starting, stack);
        if (skipCourse(current.unitId, metadataFilter, pendingCourseLessons)) {
          visited.add(current.unitId);
          shuffleToStack(
            current,
            getValidDependents(current.unitId, metadataFilter, passing),
            stack,
          );
        }
      } else if (type === 'Lesson') {
        visited.add(current.unitId);
        const lessonCourse = data.getLessonCourse(current.unitId) ?? '';
        if (
          !allowCourseTraversal &&
          !params.allowedCourses.includes(lessonCourse)
        ) {
          continue;
        }

        if (allowCourseTraversal) {
          const courseId = data.getCourseId(current.unitId);
          const known = pendingCourseLessons.get(courseId);
          let pending = known ?? data.getNumLessonsInCourse(courseId);
          if (pending > 0) pending -= 1;
          pendingCourseLessons.set(courseId, pending);
          if (pending === 0) {
            stack.push({ unitId: courseId, depth: current.depth + 1 });
          }
        }

        const validDependents = getValidDependents(
          current.unitId,
          metadataFilter,
          passing,
        );
        if (skipLesson(current.unitId, metadataFilter)) {
          shuffleToStack(current, validDependents, stack);
          continue;
        }

        const { candidates, averageScore } = getCandidatesFromLessonHelper(
          current,
          options,
        );
        const averageTrials = scorer.getAvgTrials(current.unitId);
        const lessonScore = candidates.length > 0 ? averageScore : null;
        if (!passesThreshold(passing, lessonScore, averageTrials)) {
          const deadEnds = candidates.map((candidate): Candidate => ({
            ...candidate,
            deadEnd: true,
          }));
          extendCandidates(
            allCandidates,
            deadEnds,
            current.unitId,
            lessonScore,
            lessonsInProgress,
            options,
          );
          if (allCandidates.length >= maxCandidates) break;
          rng.shuffle(stack);
          continue;
        }
        extendCandidates(
          allCandidates,
          candidates,
          current.unitId,
          lessonScore,
          lessonsInProgress,
          options,
        );
        shuffleToStack(current, validDependents, stack);
      }
    }
    return allCandidates;
  };

  /** `get_all_starting_units`: источники графа, заменённые зависимыми, пока юнит не существует. */
  const getAllStartingUnits = () => {
    const graph = data.graph();
    let starting: ReadonlySet<UnitId> = new Set(graph.getDependencySinks());
    for (;;) {
      const next = new Set<UnitId>();
      for (const unitId of starting) {
        if (data.unitExists(unitId)) next.add(unitId);
        else
          for (const dependent of data.getAllDependents(unitId))
            next.add(dependent);
      }
      if (isSameSet(next, starting)) break;
      starting = next;
    }
    return [...starting].filter((unitId) => {
      const dependencies = graph.getDependencies(unitId) ?? EMPTY_SET;
      for (const dependency of dependencies) {
        if (data.unitExists(dependency)) return false;
      }
      return true;
    });
  };

  const getInitialStack = (
    filter: KeyValueFilterWire | null,
    passing: PassingScore,
  ) => {
    const stack: StackItem[] = [];
    for (const courseId of getAllStartingUnits()) {
      const lessons = getCourseValidStartingLessons(courseId, filter, passing);
      if (lessons.length === 0) {
        stack.push({ unitId: courseId, depth: 0 });
      } else {
        for (const unitId of lessons) stack.push({ unitId, depth: 0 });
      }
    }
    rng.shuffle(stack);
    return stack;
  };

  const getCandidatesFromGraph = (
    stack: StackItem[],
    metadataFilter: KeyValueFilterWire | null,
    options: SchedulerOptionsDto,
  ) =>
    searchGraph(
      {
        stack,
        visited: new Set(),
        metadataFilter,
        allowCourseTraversal: true,
        allowedCourses: [],
      },
      options,
    );

  const getCandidatesFromCourses = (
    courseIds: readonly UnitId[],
    options: SchedulerOptionsDto,
  ) => {
    const stack: StackItem[] = [];
    const visited = new Set<UnitId>();
    for (const courseId of courseIds) {
      const lessons = data.graph().getStartingLessons(courseId) ?? EMPTY_SET;
      for (const unitId of lessons) stack.push({ unitId, depth: 0 });
      visited.add(courseId);
    }
    return searchGraph(
      {
        stack,
        visited,
        metadataFilter: null,
        allowCourseTraversal: false,
        allowedCourses: courseIds,
      },
      options,
    );
  };

  const getCandidatesFromLesson = (
    lessonId: UnitId,
    options: SchedulerOptionsDto,
  ) =>
    getCandidatesFromLessonHelper({ unitId: lessonId, depth: 0 }, options)
      .candidates;

  const getCandidatesFromReviewList = (options: SchedulerOptionsDto) => {
    const candidates: Candidate[] = [];
    for (const unitId of deps.reviewList.entries()) {
      const type = data.getUnitTypeStrict(unitId);
      if (type === 'Course') {
        candidates.push(...getCandidatesFromCourses([unitId], options));
      } else if (type === 'Lesson') {
        candidates.push(...getCandidatesFromLesson(unitId, options));
      } else {
        const lessonId = data.graph().getExerciseLesson(unitId) ?? '';
        const courseId = data.getLessonCourse(lessonId) ?? '';
        candidates.push(exerciseCandidate(unitId, lessonId, courseId, 0));
      }
    }
    return candidates;
  };

  const getCandidatesForUnitFilter = (
    filter: UnitFilterWire,
    options: SchedulerOptionsDto,
  ): Candidate[] => {
    if (typeof filter === 'string') {
      return getCandidatesFromReviewList(options);
    }
    if ('CourseFilter' in filter) {
      return getCandidatesFromCourses(filter.CourseFilter.course_ids, options);
    }
    if ('LessonFilter' in filter) {
      return filter.LessonFilter.lesson_ids.flatMap((lessonId) =>
        getCandidatesFromLesson(lessonId, options),
      );
    }
    if ('MetadataFilter' in filter) {
      const metadata = filter.MetadataFilter.filter;
      const stack = getInitialStack(metadata, options.passingScore);
      return getCandidatesFromGraph(stack, metadata, options);
    }
    if ('Dependents' in filter) {
      const stack = filter.Dependents.unit_ids.map((unitId): StackItem => ({
        unitId,
        depth: 0,
      }));
      return getCandidatesFromGraph(stack, null, options);
    }
    const { unit_ids: unitIds, depth } = filter.Dependencies;
    const stack = unitIds
      .flatMap((unitId) => data.getDependenciesAtDepth(unitId, depth))
      .map((unitId): StackItem => ({ unitId, depth: 0 }));
    return getCandidatesFromGraph(stack, null, options);
  };

  const getInitialCandidatesFor = (
    filter: ExerciseFilterDto | undefined,
    options: SchedulerOptionsDto,
  ): Candidate[] => {
    if (filter === undefined) {
      const stack = getInitialStack(null, options.passingScore);
      return deduplicateCandidates(
        getCandidatesFromGraph(stack, null, options),
      );
    }
    if ('StudySession' in filter) {
      const unitFilter = data.getSessionFilter(
        filter.StudySession,
        deps.clock.now(),
      );
      return getInitialCandidatesFor(
        unitFilter === null ? undefined : { UnitFilter: unitFilter },
        options,
      );
    }
    return deduplicateCandidates(
      getCandidatesForUnitFilter(filter.UnitFilter, options),
    );
  };

  /** Ошибки скорера на входе — `SchedulerError`, программные баги пробрасываются. */
  const guarded = <T>(run: () => T): T => {
    try {
      return run();
    } catch (error) {
      if (error instanceof ScoringError) {
        throw new SchedulerError('SCORER_FAILED', error.message, {
          cause: error,
        });
      }
      throw error;
    }
  };

  const getInitialCandidates = (filter?: ExerciseFilterDto) =>
    guarded(() => getInitialCandidatesFor(filter, deps.options()));

  const getExerciseBatch = (filter?: ExerciseFilterDto) =>
    guarded(() => {
      const options = deps.options();
      const initial = getInitialCandidatesFor(filter, options);
      const knocked = knocker.knockOutReviews(initial);
      const filtered = candidateFilter.filterCandidates(knocked);

      const library = deps.library();
      const isStale = (exerciseId: UnitId) =>
        data.insideBlacklisted(exerciseId) ||
        library.getExercise(exerciseId) === undefined;
      const chosen = new Set(filtered.map((c) => c.exerciseId));
      const relearn = session.relearnPile
        .selectExercises(isStale)
        .filter((candidate) => !chosen.has(candidate.exerciseId));

      const shuffled = shuffleCandidates(
        [...filtered, ...relearn],
        options,
        rng,
        precision,
      );
      const manifests = shuffled.map((candidate) =>
        data.getExerciseManifest(candidate.exerciseId),
      );
      for (const manifest of manifests) session.incrementFrequency(manifest.id);
      return manifests;
    });

  return {
    getExerciseBatch,
    getInitialCandidates,
    getCourseValidStartingLessons: (courseId, metadataFilter = null) =>
      getCourseValidStartingLessons(
        courseId,
        metadataFilter,
        deps.options().passingScore,
      ),
  };
};
