import { createUnitGraph } from './graph.ts';
import type { UnitGraph, UnitType, WeightedUnit } from './graph.ts';
import type {
  CourseManifest,
  ExerciseManifest,
  LessonManifest,
} from './manifest.ts';

const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * Неизменяемая библиотека курсов: манифесты (пути ассетов приведены к
 * относительным корня библиотеки, `engine` — внутри манифеста) и граф.
 * Списки отсортированы по коду символов id, как `get_*_ids` Trane.
 */
export interface Library {
  readonly courses: ReadonlyMap<string, CourseManifest>;
  readonly lessons: ReadonlyMap<string, LessonManifest>;
  readonly exercises: ReadonlyMap<string, ExerciseManifest>;
  readonly graph: UnitGraph;
  getCourse(id: string): CourseManifest | undefined;
  getLesson(id: string): LessonManifest | undefined;
  getExercise(id: string): ExerciseManifest | undefined;
  hasExercise(id: string): boolean;
  getCourseIds(): string[];
  /** `undefined`, если у курса нет уроков в графе. */
  getLessonIds(courseId: string): string[] | undefined;
  /** `undefined`, если у урока нет упражнений. */
  getExerciseIds(lessonId: string): string[] | undefined;
  /** Без аргумента — все упражнения; иначе по типу юнита. */
  getAllExerciseIds(unitId?: string): string[];
  getMatchingPrefix(prefix: string, unitType?: UnitType): Set<string>;
}

export interface AssembleOptions {
  /** Артефакт уже проверен компилятором: проверку циклов можно пропустить. */
  cycleCheck: boolean;
}

/**
 * Собирает граф в порядке Trane `process_results`: курсы, затем уроки и
 * упражнения. Карты охвата сбрасываются, если ни один юнит не задаёт
 * `encompassed`. Бросает `UnitGraphError`.
 */
export const assembleLibrary = (
  courses: readonly CourseManifest[],
  lessons: readonly LessonManifest[],
  exercises: readonly ExerciseManifest[],
  { cycleCheck }: AssembleOptions,
): Library => {
  const graph = createUnitGraph();
  const courseMap = new Map<string, CourseManifest>();
  const lessonMap = new Map<string, LessonManifest>();
  const exerciseMap = new Map<string, ExerciseManifest>();
  let isEncompassingDependency = true;
  const addStructure = (
    id: string,
    type: 'Course' | 'Lesson',
    manifest: CourseManifest | LessonManifest,
  ) => {
    graph.addDependencies(id, type, manifest.dependencies);
    graph.addEncompassed(
      id,
      manifest.dependencies,
      manifest.encompassed as readonly WeightedUnit[],
    );
    graph.addSuperseded(id, manifest.superseded);
    if (manifest.encompassed.length > 0) isEncompassingDependency = false;
  };
  for (const course of courses) {
    graph.addCourse(course.id);
    addStructure(course.id, 'Course', course);
    courseMap.set(course.id, course);
  }
  for (const lesson of lessons) {
    graph.addLesson(lesson.id, lesson.course_id);
    addStructure(lesson.id, 'Lesson', lesson);
    lessonMap.set(lesson.id, lesson);
  }
  for (const exercise of exercises) {
    graph.addExercise(exercise.id, exercise.lesson_id);
    exerciseMap.set(exercise.id, exercise);
  }
  graph.updateStartingLessons();
  if (isEncompassingDependency) graph.setEncompassingEqualsDependency();
  if (cycleCheck) graph.checkCycles();

  const sortedIds = (ids: Iterable<string> | undefined) =>
    ids === undefined ? undefined : [...ids].sort(compare);
  const getAllExerciseIds = (unitId?: string) =>
    unitId === undefined
      ? [...exerciseMap.keys()].sort(compare)
      : [...graph.getExercisesUnder(unitId)].sort(compare);
  const getMatchingPrefix = (prefix: string, unitType?: UnitType) => {
    const maps: Record<UnitType, ReadonlyMap<string, unknown>> = {
      Course: courseMap,
      Lesson: lessonMap,
      Exercise: exerciseMap,
    };
    const selected =
      unitType === undefined ? Object.values(maps) : [maps[unitType]];
    const found = new Set<string>();
    for (const map of selected) {
      for (const id of map.keys()) if (id.startsWith(prefix)) found.add(id);
    }
    return found;
  };

  return {
    courses: courseMap,
    lessons: lessonMap,
    exercises: exerciseMap,
    graph,
    getCourse: (id) => courseMap.get(id),
    getLesson: (id) => lessonMap.get(id),
    getExercise: (id) => exerciseMap.get(id),
    hasExercise: (id) => exerciseMap.has(id),
    getCourseIds: () => [...courseMap.keys()].sort(compare),
    getLessonIds: (courseId) => sortedIds(graph.getCourseLessons(courseId)),
    getExerciseIds: (lessonId) => sortedIds(graph.getLessonExercises(lessonId)),
    getAllExerciseIds,
    getMatchingPrefix,
  };
};
