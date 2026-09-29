import type { UnitGraph, WeightedUnit } from '../../src/domain/graph.ts';

const compare = (a: string, b: string) => Number(a > b) - Number(a < b);

const sortedSet = (ids: ReadonlySet<string> | undefined) =>
  ids === undefined ? null : [...ids].sort(compare);

const sortedWeights = (entries: readonly WeightedUnit[] | undefined) =>
  entries === undefined
    ? null
    : [...entries].sort((a, b) => compare(a[0], b[0]) || a[1] - b[1]);

/**
 * Канонический, не зависящий от порядка снимок графа: 12 отношений
 * `UnitGraph` на каждый юнит плюс стоки и признак «охват = зависимости».
 */
export const graphSnapshot = ({ graph }: { graph: UnitGraph }) => ({
  encompassingEqualsDependency: graph.encompassingEqualsDependency(),
  sinks: sortedSet(graph.getDependencySinks()),
  units: [...graph.unitIds()].sort(compare).map((id) => ({
    id,
    type: graph.getUnitType(id) ?? null,
    lessons: sortedSet(graph.getCourseLessons(id)),
    startingLessons: sortedSet(graph.getStartingLessons(id)),
    course: graph.getLessonCourse(id) ?? null,
    exercises: sortedSet(graph.getLessonExercises(id)),
    lesson: graph.getExerciseLesson(id) ?? null,
    dependencies: sortedSet(graph.getDependencies(id)),
    dependents: sortedSet(graph.getDependents(id)),
    encompasses: sortedWeights(graph.getEncompasses(id)),
    encompassedBy: sortedWeights(graph.getEncompassedBy(id)),
    supersedes: sortedSet(graph.getSupersedes(id)),
    supersededBy: sortedSet(graph.getSupersededBy(id)),
  })),
});
