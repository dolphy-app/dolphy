import type { UnitId } from '@spirula/engine-contract';
import type { UnitGraph } from '../domain/graph.ts';
import type { ScoringGraph, UnitKind } from '../scoring/graph.ts';

const KIND_OF = {
  Course: 'course',
  Lesson: 'lesson',
  Exercise: 'exercise',
} as const satisfies Record<string, UnitKind>;

/**
 * Узкий срез `ScoringGraph` поверх готового `UnitGraph`: `undefined` → `null`,
 * множества → массивы (кэшируются по юниту: граф неизменяем после сборки, а
 * скорер спрашивает списки на каждом пересчёте).
 */
export const toScoringGraph = (graph: UnitGraph): ScoringGraph => {
  const exercisesCache = new Map<UnitId, readonly UnitId[]>();
  const lessonsCache = new Map<UnitId, readonly UnitId[]>();

  const listOf = (
    cache: Map<UnitId, readonly UnitId[]>,
    id: UnitId,
    source: ReadonlySet<UnitId> | undefined,
  ) => {
    if (source === undefined) return null;
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const list = [...source];
    cache.set(id, list);
    return list;
  };

  return {
    getUnitType: (id) => {
      const type = graph.getUnitType(id);
      return type === undefined ? null : KIND_OF[type];
    },
    getExerciseLesson: (id) => graph.getExerciseLesson(id) ?? null,
    getLessonCourse: (id) => graph.getLessonCourse(id) ?? null,
    getLessonExercises: (id) =>
      listOf(exercisesCache, id, graph.getLessonExercises(id)),
    getCourseLessons: (id) =>
      listOf(lessonsCache, id, graph.getCourseLessons(id)),
    getEncompasses: (id) => graph.getEncompasses(id) ?? null,
    getEncompassedBy: (id) => graph.getEncompassedBy(id) ?? null,
    getSupersededBy: (id) => graph.getSupersededBy(id) ?? null,
  };
};
