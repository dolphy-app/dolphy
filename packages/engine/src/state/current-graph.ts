import type { Library } from '../domain/library.ts';
import type { ScoringGraph } from '../scoring/graph.ts';
import { toScoringGraph } from '../scheduler/scoring-graph.ts';

/**
 * `ScoringGraph` текущей библиотеки. Скорер держит один объект графа, а
 * библиотека подменяется при `reload`, поэтому методы читают граф через
 * `library()` при каждом вызове; срезы кэшируются по объекту библиотеки.
 * Без библиотеки граф пуст: юниты неизвестны.
 */
export const createCurrentScoringGraph = (
  library: () => Library | null,
): ScoringGraph => {
  const slices = new WeakMap<Library, ScoringGraph>();

  const current = (): ScoringGraph | null => {
    const loaded = library();
    if (loaded === null) return null;
    let slice = slices.get(loaded);
    if (slice === undefined) {
      slice = toScoringGraph(loaded.graph);
      slices.set(loaded, slice);
    }
    return slice;
  };

  return {
    getUnitType: (id) => current()?.getUnitType(id) ?? null,
    getExerciseLesson: (id) => current()?.getExerciseLesson(id) ?? null,
    getLessonCourse: (id) => current()?.getLessonCourse(id) ?? null,
    getLessonExercises: (id) => current()?.getLessonExercises(id) ?? null,
    getCourseLessons: (id) => current()?.getCourseLessons(id) ?? null,
    getEncompasses: (id) => current()?.getEncompasses(id) ?? null,
    getEncompassedBy: (id) => current()?.getEncompassedBy(id) ?? null,
    getSupersededBy: (id) => current()?.getSupersededBy(id) ?? null,
  };
};
