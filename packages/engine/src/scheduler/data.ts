import type {
  EpochMs,
  KeyValueFilterWire,
  SavedFilterDto,
  StudySessionWire,
  UnitFilterWire,
  UnitId,
} from '@spirula/engine-contract';
import type { UnitGraph, UnitType } from '../domain/graph.ts';
import type {
  CourseManifest,
  ExerciseManifest,
  LessonManifest,
} from '../domain/manifest.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import {
  keyValueApplyToCourse,
  keyValueApplyToLesson,
  sessionPartAt,
} from './filters.ts';
import { SchedulerError } from './types.ts';

/** Что планировщику нужно от `Library`: граф и манифесты. */
export interface SchedulerLibrary {
  readonly graph: UnitGraph;
  getCourse(id: UnitId): CourseManifest | undefined;
  getLesson(id: UnitId): LessonManifest | undefined;
  getExercise(id: UnitId): ExerciseManifest | undefined;
}

/** Review list ученика (`ReviewList`): id юнитов в порядке добавления. */
export interface ReviewListView {
  entries(): readonly UnitId[];
}

/** Сохранённые фильтры (`FilterManager`). */
export interface SavedFilterSource {
  getFilter(id: string): SavedFilterDto | undefined;
}

export interface SchedulerDataDeps {
  /** Текущая библиотека; вызывается при каждом обращении (перезагрузка курса). */
  library(): SchedulerLibrary;
  readonly blacklist: BlacklistView;
  readonly reviewList: ReviewListView;
  readonly savedFilters: SavedFilterSource;
}

export interface StudySessionRun {
  readonly startTimeMs: EpochMs;
  readonly definition: StudySessionWire;
}

/**
 * Помощники `SchedulerData` (scheduler/data.rs): id, типы, манифесты,
 * наследование blacklist и фильтры. Ошибки данных — `SchedulerError`;
 * ошибки blacklist в Trane глотались как `false`, у порта они невозможны.
 */
export interface SchedulerData {
  graph(): UnitGraph;
  getUnitType(unitId: UnitId): UnitType | undefined;
  /** Неизвестный тип — `SchedulerError('UNKNOWN_UNIT')`. */
  getUnitTypeStrict(unitId: UnitId): UnitType;
  getLessonId(exerciseId: UnitId): UnitId;
  getCourseId(lessonId: UnitId): UnitId;
  getLessonCourse(lessonId: UnitId): UnitId | undefined;
  getExerciseManifest(exerciseId: UnitId): ExerciseManifest;
  blacklisted(unitId: UnitId): boolean;
  /** Само упражнение, его урок или курс в blacklist. */
  insideBlacklisted(exerciseId: UnitId): boolean;
  getAllDependents(unitId: UnitId): UnitId[];
  /** `get_dependencies_at_depth`: без дедупликации, только известные юниты. */
  getDependenciesAtDepth(unitId: UnitId, depth: number): UnitId[];
  /** Тип в графе и манифест в библиотеке. */
  unitExists(unitId: UnitId): boolean;
  getNumLessonsInCourse(courseId: UnitId): number;
  /**
   * `unit_passes_filter`: без фильтра — `true`; упражнение или отсутствующий
   * манифест — `SchedulerError`.
   */
  unitPassesFilter(unitId: UnitId, filter: KeyValueFilterWire | null): boolean;
  /** Фильтр части сессии на момент `nowMs`; `null` — «без фильтра». */
  getSessionFilter(
    session: StudySessionRun,
    nowMs: EpochMs,
  ): UnitFilterWire | null;
  /** Упражнения урока без blacklist (урок или курс в списке — пусто). */
  allValidExercisesInLesson(lessonId: UnitId): UnitId[];
}

export const createSchedulerData = (deps: SchedulerDataDeps): SchedulerData => {
  const { blacklist, savedFilters } = deps;
  const graph = () => deps.library().graph;

  const getUnitType = (unitId: UnitId) => graph().getUnitType(unitId);

  const getUnitTypeStrict = (unitId: UnitId) => {
    const type = getUnitType(unitId);
    if (type === undefined) {
      throw new SchedulerError(
        'UNKNOWN_UNIT',
        `missing unit type for unit with ID ${unitId}`,
        { details: { unitId } },
      );
    }
    return type;
  };

  const getLessonId = (exerciseId: UnitId) => {
    const lessonId = graph().getExerciseLesson(exerciseId);
    if (lessonId === undefined) {
      throw new SchedulerError(
        'MISSING_LESSON',
        `missing lesson ID for exercise with ID ${exerciseId}`,
        { details: { exerciseId } },
      );
    }
    return lessonId;
  };

  const getLessonCourse = (lessonId: UnitId) =>
    graph().getLessonCourse(lessonId);

  const getCourseId = (lessonId: UnitId) => {
    const courseId = getLessonCourse(lessonId);
    if (courseId === undefined) {
      throw new SchedulerError(
        'MISSING_COURSE',
        `missing course ID for lesson with ID ${lessonId}`,
        { details: { lessonId } },
      );
    }
    return courseId;
  };

  const missingManifest = (kind: string, unitId: UnitId) =>
    new SchedulerError(
      'MISSING_MANIFEST',
      `missing manifest for ${kind} ${unitId}`,
      {
        details: { kind, unitId },
      },
    );

  const getExerciseManifest = (exerciseId: UnitId) => {
    const manifest = deps.library().getExercise(exerciseId);
    if (manifest === undefined) throw missingManifest('exercise', exerciseId);
    return manifest;
  };

  const insideBlacklisted = (exerciseId: UnitId) => {
    if (blacklist.isBlacklisted(exerciseId)) return true;
    const lessonId = graph().getExerciseLesson(exerciseId) ?? '';
    if (blacklist.isBlacklisted(lessonId)) return true;
    const courseId = getLessonCourse(lessonId) ?? '';
    return blacklist.isBlacklisted(courseId);
  };

  const getDependenciesAtDepth = (unitId: UnitId, depth: number) => {
    const found: UnitId[] = [];
    const stack: Array<readonly [UnitId, number]> = [[unitId, 0]];
    const unitGraph = graph();
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      const [candidateId, candidateDepth] = item;
      if (candidateDepth === depth) {
        found.push(candidateId);
        continue;
      }
      const dependencies = unitGraph.getDependencies(candidateId);
      if (dependencies === undefined || dependencies.size === 0) {
        found.push(candidateId);
        continue;
      }
      for (const dependency of dependencies) {
        stack.push([dependency, candidateDepth + 1]);
      }
    }
    return found.filter((id) => unitGraph.getUnitType(id) !== undefined);
  };

  const unitExists = (unitId: UnitId) => {
    const type = getUnitType(unitId);
    if (type === undefined) return false;
    const library = deps.library();
    if (type === 'Course') return library.getCourse(unitId) !== undefined;
    if (type === 'Lesson') return library.getLesson(unitId) !== undefined;
    return library.getExercise(unitId) !== undefined;
  };

  const unitPassesFilter = (
    unitId: UnitId,
    filter: KeyValueFilterWire | null,
  ) => {
    if (filter === null) return true;
    const type = getUnitTypeStrict(unitId);
    const library = deps.library();
    if (type === 'Exercise') {
      throw new SchedulerError(
        'FILTER_ON_EXERCISE',
        `cannot apply metadata filter to exercise with ID ${unitId}`,
        { details: { unitId } },
      );
    }
    if (type === 'Course') {
      const course = library.getCourse(unitId);
      if (course === undefined) throw missingManifest('course', unitId);
      return keyValueApplyToCourse(filter, course.metadata);
    }
    const courseId = getLessonCourse(unitId) ?? '';
    const course = library.getCourse(courseId);
    if (course === undefined) throw missingManifest('course', courseId);
    const lesson = library.getLesson(unitId);
    if (lesson === undefined) throw missingManifest('lesson', unitId);
    return keyValueApplyToLesson(filter, course.metadata, lesson.metadata);
  };

  const getSessionFilter = (session: StudySessionRun, nowMs: EpochMs) => {
    const part = sessionPartAt(session, nowMs);
    if ('NoFilter' in part) return null;
    if ('UnitFilter' in part) return part.UnitFilter.filter;
    const { filter_id: filterId } = part.SavedFilter;
    const saved = savedFilters.getFilter(filterId);
    if (saved === undefined) {
      throw new SchedulerError(
        'MISSING_SAVED_FILTER',
        `no saved filter with ID ${filterId} exists`,
        { details: { filterId } },
      );
    }
    return saved.filter;
  };

  const allValidExercisesInLesson = (lessonId: UnitId) => {
    const courseId = getLessonCourse(lessonId) ?? '';
    if (blacklist.isBlacklisted(lessonId)) return [];
    if (blacklist.isBlacklisted(courseId)) return [];
    const exercises = graph().getLessonExercises(lessonId) ?? [];
    return [...exercises].filter((id) => !blacklist.isBlacklisted(id));
  };

  return {
    graph,
    getUnitType,
    getUnitTypeStrict,
    getLessonId,
    getCourseId,
    getLessonCourse,
    getExerciseManifest,
    blacklisted: (unitId) => blacklist.isBlacklisted(unitId),
    insideBlacklisted,
    getAllDependents: (unitId) => [...(graph().getDependents(unitId) ?? [])],
    getDependenciesAtDepth,
    unitExists,
    getNumLessonsInCourse: (courseId) =>
      graph().getCourseLessons(courseId)?.size ?? 0,
    unitPassesFilter,
    getSessionFilter,
    allValidExercisesInLesson,
  };
};
