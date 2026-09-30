import type { EpochMs } from '@dolphy-app/engine-contract';
import type { MemoryModel } from '../ports/index.ts';
import type { MemorySource } from '../scheduler/due.ts';
import { retrievabilityAt } from '../scheduler/due.ts';
import type { PlanGraph } from './plan-graph.ts';
import type { PlanDueExercise } from './planner.ts';

export interface DueSetDeps {
  readonly memory: MemorySource;
  readonly memoryModel: Pick<MemoryModel, 'retrievability'>;
  readonly graph: Pick<PlanGraph, 'exerciseIndex'>;
  /** Само упражнение, урок или курс в blacklist. */
  isExcluded(exerciseId: string): boolean;
}

/**
 * Просроченные упражнения плана: состояние памяти есть, `R ≤ targetRetention`,
 * упражнение в библиотеке и не в blacklist. Те же `R` и порог, что у
 * `getDue`, но без оценок юнитов (плану нужна только `R`). Порядок — порядок
 * `MemorySource`; планировщик канонизирует его сам.
 */
export const collectDue = (
  { memory, memoryModel, graph, isExcluded }: DueSetDeps,
  nowMs: EpochMs,
  targetRetention: number,
): PlanDueExercise[] => {
  const due: PlanDueExercise[] = [];
  for (const exerciseId of memory.attemptedExerciseIds()) {
    if (!graph.exerciseIndex.has(exerciseId) || isExcluded(exerciseId))
      continue;
    const state = memory.getMemory(exerciseId);
    if (state === null) continue;
    const retrievability = retrievabilityAt(memoryModel, state, nowMs);
    if (retrievability <= targetRetention) {
      due.push({ exerciseId, retrievability });
    }
  }
  return due;
};
