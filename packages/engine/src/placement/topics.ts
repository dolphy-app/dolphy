import type { UnitId } from '@lms/engine-contract';
import type { Library } from '../domain/library.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import { type TopicGraph, buildTopicGraph } from './topic-graph.ts';

export type PlacementLibrary = Pick<
  Library,
  | 'graph'
  | 'getLesson'
  | 'getExercise'
  | 'getCourseIds'
  | 'getLessonIds'
  | 'getExerciseIds'
>;

/** Темы диагностики — уроки; у каждой есть упражнение-проба. */
export interface PlacementTopics {
  readonly graph: TopicGraph;
  /** Упражнения темы (без blacklist) по коду символов id. */
  readonly exercises: readonly (readonly UnitId[])[];
  /** Упражнение-проба: первое с `engine.verification`, иначе первое по id. */
  readonly probeExercise: readonly UnitId[];
  /** У пробы есть исполняемая проверка (шум ≈ 0, `Verifier`). */
  readonly verifiable: readonly boolean[];
}

export interface PlacementTopicsOptions {
  /** Курсы диагностики; пусто или нет — все курсы библиотеки. */
  readonly courseIds?: readonly UnitId[];
  readonly blacklist?: BlacklistView;
}

/**
 * Темы диагностики. Урок вне выбора, в blacklist (сам или курс) или без
 * упражнений темой не бывает и в графе «прозрачен»: зависимые наследуют его
 * пререквизиты (как `getFrontier` — юнит без оценки выполнен, когда выполнены
 * его собственные зависимости). Зависимости на уроки вне выбора, на курсы и
 * зависимости курсов игнорируются [ВЫВОД: у диагностики нет данных о них].
 */
export const buildPlacementTopics = (
  library: PlacementLibrary,
  { courseIds, blacklist }: PlacementTopicsOptions = {},
): PlacementTopics => {
  const selected =
    courseIds === undefined || courseIds.length === 0
      ? library.getCourseIds()
      : library.getCourseIds().filter((id) => courseIds.includes(id));
  const blocked = (unitId: UnitId) => blacklist?.isBlacklisted(unitId) === true;

  const lessonIds: UnitId[] = [];
  const exercises: UnitId[][] = [];
  const inScope = new Set<UnitId>();
  for (const courseId of selected) {
    for (const lessonId of library.getLessonIds(courseId) ?? []) {
      if (library.getLesson(lessonId) === undefined) continue;
      inScope.add(lessonId);
      if (blocked(courseId) || blocked(lessonId)) continue;
      const valid = (library.getExerciseIds(lessonId) ?? []).filter(
        (id) => !blocked(id),
      );
      if (valid.length === 0) continue;
      lessonIds.push(lessonId);
      exercises.push(valid);
    }
  }
  const topic = new Set<UnitId>(lessonIds);

  /** Ближайшие темы-пререквизиты; прозрачные уроки раскрываются рекурсивно. */
  const effective = (lessonId: UnitId): UnitId[] => {
    const found = new Set<UnitId>();
    const visited = new Set<UnitId>();
    const walk = (id: UnitId) => {
      for (const dependency of library.graph.getDependencies(id) ?? []) {
        if (topic.has(dependency)) found.add(dependency);
        else if (inScope.has(dependency) && !visited.has(dependency)) {
          visited.add(dependency);
          walk(dependency);
        }
      }
    };
    walk(lessonId);
    return [...found];
  };

  const graph = buildTopicGraph(lessonIds, effective);
  const probeExercise = exercises.map((own) => {
    const verifiable = own.find(
      (id) => library.getExercise(id)?.engine?.verification !== undefined,
    );
    return verifiable ?? (own[0] as UnitId);
  });
  return {
    graph,
    exercises,
    probeExercise,
    verifiable: probeExercise.map(
      (id) => library.getExercise(id)?.engine?.verification !== undefined,
    ),
  };
};
