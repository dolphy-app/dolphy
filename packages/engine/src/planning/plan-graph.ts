import type { UnitId } from '@dolphy-app/engine-contract';
import type { Library } from '../domain/library.ts';

const compareStrings = (a: string, b: string) => Number(a > b) - Number(a < b);

/**
 * Откуда берутся рёбра охвата (`encompassed`) для неявного кредита:
 * `declared` — только объявленные в манифестах уроков (по умолчанию в
 * продукции: правило Trane «зависимость = охват @ 1.0» даёт 144 обновления на
 * попытку); `graph` — граф библиотеки как есть, включая автоправило Trane.
 */
export type EncompassMode = 'declared' | 'graph';

/** Уроки и упражнения библиотеки в плотной индексации: вход планировщика и `MemoryIndex`. */
export interface PlanGraph {
  readonly lessonCount: number;
  readonly exerciseCount: number;
  readonly lessonIds: readonly UnitId[];
  readonly exerciseIds: readonly UnitId[];
  readonly lessonIndex: ReadonlyMap<UnitId, number>;
  readonly exerciseIndex: ReadonlyMap<UnitId, number>;
  readonly courseIds: readonly UnitId[];
  readonly lessonCourse: Int32Array;
  readonly lessonExercises: readonly (readonly number[])[];
  readonly exerciseLesson: Int32Array;
  /** Теги урока (`engine.tags`) для разнесения в плане. */
  readonly lessonTags: readonly (readonly string[])[];
  /** Прямые зависимости урока (только уроки). */
  readonly dependencies: readonly (readonly number[])[];
  /** `охватывает[u] = [(v, вес)]`: повтор `u` повторяет `v`. */
  readonly encompassTargets: readonly Int32Array[];
  readonly encompassWeights: readonly Float64Array[];
  readonly encompassEdges: number;
  /** Упражнения по возрастанию кода символов id: канонический порядок тай-брейков. */
  readonly exerciseByRank: Int32Array;
}

export type PlanLibrary = Pick<
  Library,
  'graph' | 'getLesson' | 'getCourseIds' | 'getLessonIds' | 'getExerciseIds'
>;

const encompassedOf = (
  library: PlanLibrary,
  lessonId: UnitId,
  mode: EncompassMode,
): readonly (readonly [UnitId, number])[] =>
  mode === 'declared'
    ? (library.getLesson(lessonId)?.encompassed ?? [])
    : (library.graph.getEncompasses(lessonId) ?? []);

/** Строит `PlanGraph`; порядок — курсы и уроки по коду символов id. */
export const buildPlanGraph = (
  library: PlanLibrary,
  mode: EncompassMode = 'declared',
): PlanGraph => {
  const lessonIds: UnitId[] = [];
  const lessonIndex = new Map<UnitId, number>();
  const courseIds = library.getCourseIds();
  const courseOfLesson: number[] = [];
  courseIds.forEach((courseId, courseNumber) => {
    for (const lessonId of library.getLessonIds(courseId) ?? []) {
      if (library.getLesson(lessonId) === undefined) continue;
      lessonIndex.set(lessonId, lessonIds.length);
      lessonIds.push(lessonId);
      courseOfLesson.push(courseNumber);
    }
  });

  const exerciseIds: UnitId[] = [];
  const exerciseIndex = new Map<UnitId, number>();
  const exerciseOfLesson: number[] = [];
  const lessonExercises: number[][] = [];
  lessonIds.forEach((lessonId, lesson) => {
    const own: number[] = [];
    for (const exerciseId of library.getExerciseIds(lessonId) ?? []) {
      exerciseIndex.set(exerciseId, exerciseIds.length);
      own.push(exerciseIds.length);
      exerciseOfLesson.push(lesson);
      exerciseIds.push(exerciseId);
    }
    lessonExercises.push(own);
  });

  const dependencies = lessonIds.map((lessonId) => {
    const found: number[] = [];
    for (const dependency of library.graph.getDependencies(lessonId) ?? []) {
      const index = lessonIndex.get(dependency);
      if (index !== undefined) found.push(index);
    }
    return found;
  });

  const encompassTargets: Int32Array[] = [];
  const encompassWeights: Float64Array[] = [];
  let encompassEdges = 0;
  lessonIds.forEach((lessonId, lesson) => {
    const weights = new Map<number, number>();
    for (const [target, weight] of encompassedOf(library, lessonId, mode)) {
      const index = lessonIndex.get(target);
      if (index === undefined || index === lesson) continue;
      weights.set(index, Math.max(weights.get(index) ?? 0, weight));
    }
    encompassTargets.push(Int32Array.from(weights.keys()));
    encompassWeights.push(Float64Array.from(weights.values()));
    encompassEdges += weights.size;
  });

  const exerciseByRank = Int32Array.from(
    exerciseIds
      .map((_, index) => index)
      .sort((a, b) =>
        compareStrings(exerciseIds[a] as string, exerciseIds[b] as string),
      ),
  );

  return {
    lessonCount: lessonIds.length,
    exerciseCount: exerciseIds.length,
    lessonIds,
    exerciseIds,
    lessonIndex,
    exerciseIndex,
    courseIds,
    lessonCourse: Int32Array.from(courseOfLesson),
    lessonExercises,
    exerciseLesson: Int32Array.from(exerciseOfLesson),
    lessonTags: lessonIds.map(
      (lessonId) => library.getLesson(lessonId)?.engine?.tags ?? [],
    ),
    dependencies,
    encompassTargets,
    encompassWeights,
    encompassEdges,
    exerciseByRank,
  };
};
