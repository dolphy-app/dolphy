import type { EpochMs, Grade, UnitId } from '@lms/engine-contract';
import type { ScoringEdge, ScoringGraph } from './graph.ts';
import type { UnitReward } from './types.ts';

/** Ниже по модулю распространение останавливается. */
export const MIN_ABS_REWARD = 0.2;
/** Ниже этого веса распространение останавливается. */
export const MIN_WEIGHT = 0.2;
/** Множитель веса на каждый переход по графу. */
export const WEIGHT_FACTOR = 0.8;
/** Множитель модуля награды на каждый переход. */
export const REWARD_FACTOR = 0.9;

const INITIAL_REWARDS: Readonly<Record<Grade, number>> = Object.freeze({
  5: 0.8,
  4: 0.4,
  3: -0.3,
  2: -0.5,
  1: -1.0,
});

/** Начальная награда за оценку: хорошие идут вниз по графу, плохие — вверх. */
export const initialReward = (grade: Grade) => INITIAL_REWARDS[grade];

/** Строгое `<`: значения ровно на границе проходят. Используется и `ReviewKnocker`. */
export const stopPropagation = (reward: number, weight: number) =>
  Math.abs(reward) < MIN_ABS_REWARD || weight < MIN_WEIGHT;

/** Направление задаёт знак награды и не меняется по пути. */
const nextUnits = (
  graph: ScoringGraph,
  unitId: UnitId,
  reward: number,
): readonly ScoringEdge[] =>
  (reward > 0.0
    ? graph.getEncompasses(unitId)
    : graph.getEncompassedBy(unitId)) ?? [];

/**
 * Награды за попытку (`reward_propagator.rs`): чистая функция события и графа.
 * Корни обхода — урок и курс упражнения; награды получают только уроки и
 * курсы, достижимые по рёбрам `encompassed`. При нескольких путях к одному
 * юниту побеждает больший модуль; при равном модуле — первый найденный. Порядок
 * результата — порядок первой вставки юнита (детерминирован).
 */
export const propagateRewards = (
  graph: ScoringGraph,
  exerciseId: UnitId,
  grade: Grade,
  timestamp: EpochMs,
): UnitReward[] => {
  const lessonId = graph.getExerciseLesson(exerciseId);
  const courseId = lessonId === null ? null : graph.getLessonCourse(lessonId);
  if (lessonId === null || courseId === null) return [];

  const reward = initialReward(grade);
  const stack: UnitReward[] = [];
  const roots = [
    ...nextUnits(graph, lessonId, reward),
    ...nextUnits(graph, courseId, reward),
  ];
  for (const [unitId, edgeWeight] of roots) {
    const value = edgeWeight * reward;
    const weight = edgeWeight;
    if (stopPropagation(value, weight)) continue;
    stack.push({ unitId, value, weight, timestamp });
  }

  const results = new Map<UnitId, UnitReward>();
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const existing = results.get(item.unitId);
    if (existing && Math.abs(existing.value) >= Math.abs(item.value)) continue;
    results.set(item.unitId, item);

    for (const [nextId, edgeWeight] of nextUnits(
      graph,
      item.unitId,
      item.value,
    )) {
      const value = edgeWeight * REWARD_FACTOR * item.value;
      const weight = edgeWeight * WEIGHT_FACTOR * item.weight;
      if (stopPropagation(value, weight)) continue;
      stack.push({ unitId: nextId, value, weight, timestamp });
    }
  }
  return [...results.values()];
};
