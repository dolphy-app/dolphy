import type { UnitId } from '@dolphy-app/engine-contract';

export type UnitKind = 'course' | 'lesson' | 'exercise';

/** Ребро `encompassed`: юнит и вес 0..=1. */
export type ScoringEdge = readonly [unitId: UnitId, weight: number];

/**
 * Узкий срез графа юнитов, нужный скорингу. Полный `UnitGraph` (M1)
 * удовлетворяет ему структурно; порядок рёбер `encompassed` — порядок
 * добавления, он влияет на обход наград. Если `encompassed` пуст глобально,
 * граф отдаёт зависимости с весом 1.0 (graph.rs:659-676) — это забота графа.
 */
export interface ScoringGraph {
  getUnitType(unitId: UnitId): UnitKind | null;
  getExerciseLesson(exerciseId: UnitId): UnitId | null;
  getLessonCourse(lessonId: UnitId): UnitId | null;
  getLessonExercises(lessonId: UnitId): readonly UnitId[] | null;
  getCourseLessons(courseId: UnitId): readonly UnitId[] | null;
  /** Юниты, которые охватывает `unitId` (вниз по графу). */
  getEncompasses(unitId: UnitId): readonly ScoringEdge[] | null;
  /** Юниты, которые охватывают `unitId` (вверх по графу). */
  getEncompassedBy(unitId: UnitId): readonly ScoringEdge[] | null;
  /** Юниты, вытесняющие `unitId` (`superseded_by`). */
  getSupersededBy(unitId: UnitId): ReadonlySet<UnitId> | null;
}

/** Чёрный список; наследование курс → урок → упражнение считает вызывающий. */
export interface BlacklistView {
  isBlacklisted(unitId: UnitId): boolean;
}

/**
 * Упражнения урока, не закрытые blacklist'ом: урок или его курс в списке —
 * пусто, иначе упражнения урока без тех, что в списке
 * (`all_valid_exercises_in_lesson`, data.rs:342-361).
 */
const validExercisesInLesson = (
  graph: ScoringGraph,
  blacklist: BlacklistView,
  lessonId: UnitId,
) => {
  const courseId = graph.getLessonCourse(lessonId);
  const isCourseBlacklisted =
    courseId !== null && blacklist.isBlacklisted(courseId);
  if (blacklist.isBlacklisted(lessonId) || isCourseBlacklisted) return [];
  const exercises = graph.getLessonExercises(lessonId) ?? [];
  return exercises.filter((id) => !blacklist.isBlacklisted(id));
};

/** `all_valid_exercises` (data.rs:365-399): упражнения юнита с учётом blacklist. */
export const allValidExercises = (
  graph: ScoringGraph,
  blacklist: BlacklistView,
  unitId: UnitId,
): UnitId[] => {
  const kind = graph.getUnitType(unitId);
  if (kind === 'exercise') {
    return blacklist.isBlacklisted(unitId) ? [] : [unitId];
  }
  if (kind === 'lesson')
    return validExercisesInLesson(graph, blacklist, unitId);
  if (kind === 'course') {
    if (blacklist.isBlacklisted(unitId)) return [];
    const lessons = graph.getCourseLessons(unitId) ?? [];
    return lessons.flatMap((id) =>
      validExercisesInLesson(graph, blacklist, id),
    );
  }
  return [];
};
