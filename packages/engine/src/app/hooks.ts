import type { ItemReason } from '@dolphy-app/engine-contract';
import {
  EXTENSION_HOOK_MAX_EXERCISES,
  ExtensionHookError,
} from '../ports/extension-hooks.ts';
import { retrievabilityAt } from '../scheduler/due.ts';
import type {
  ExtensionHookRequests,
  ExtensionHookResponses,
  HookExerciseMemory,
} from '../ports/extension-hooks.ts';
import type { EngineContext } from './context.ts';
import { EngineError } from './errors.ts';

type HookName = keyof ExtensionHookRequests;

export interface BatchEntry {
  exerciseId: string;
  reason: ItemReason;
}
/**
 * Вызывает хуки «до»; отказ любого расширения — `EXTENSION_HOOK_FAILED`, в
 * сообщении id расширения и текст его ошибки.
 */
export const runBeforeHook = async <N extends HookName>(
  ctx: Pick<EngineContext, 'extensionHooks'>,
  name: N,
  request: ExtensionHookRequests[N],
  verify?: (response: ExtensionHookResponses[N]) => string | null,
): Promise<ExtensionHookResponses[N] | undefined> => {
  try {
    return await ctx.extensionHooks.before(name, request, verify);
  } catch (error) {
    if (!(error instanceof ExtensionHookError)) throw error;
    throw new EngineError('EXTENSION_HOOK_FAILED', {
      message: `Extension '${error.extensionId}': ${error.message}`,
      details: {
        hook: error.hook,
        extensionId: error.extensionId,
        reason: error.reason,
        message: error.message,
      },
      cause: error,
    });
  }
};

/** Проекции уже хранят состояние памяти: реплея журнала нет. */
const memoryOf = (
  ctx: Pick<EngineContext, 'projections' | 'memoryModel'>,
  exerciseId: string,
  now: number,
): HookExerciseMemory => {
  const attempts = ctx.projections.attempts.count(exerciseId);
  const memory = ctx.projections.memory.getMemory(exerciseId);
  if (memory === null) {
    return {
      retrievability: null,
      lastAttemptAt: null,
      attempts,
      stability: null,
      difficulty: null,
    };
  }
  return {
    retrievability: retrievabilityAt(ctx.memoryModel, memory, now),
    lastAttemptAt: memory.lastAt,
    attempts,
    stability: memory.state.stability,
    difficulty: memory.state.difficulty,
  };
};

/**
 * Хук `practice.batch`: расширения могут переставить, убрать и добавить
 * упражнения. Ответ каждого обработчика проверяется библиотекой (равные
 * длины, не больше потолка, каждый id есть в библиотеке); возвращается
 * список в порядке ответа.
 */
export const runBatchHook = async (
  ctx: Pick<
    EngineContext,
    | 'extensionHooks'
    | 'library'
    | 'currentSession'
    | 'projections'
    | 'memoryModel'
    | 'clock'
  >,
  source: ExtensionHookRequests['practice.batch']['source'],
  entries: readonly BatchEntry[],
): Promise<BatchEntry[]> => {
  const library = ctx.library.require();
  const now = ctx.clock.now();
  const response = await runBeforeHook(
    ctx,
    'practice.batch',
    {
      sessionId: ctx.currentSession.id,
      source,
      exerciseIds: entries.map(({ exerciseId }) => exerciseId),
      reasons: entries.map(({ reason }) => reason),
      memory: entries.map(({ exerciseId }) => memoryOf(ctx, exerciseId, now)),
    },
    ({ exerciseIds, reasons }) => {
      if (exerciseIds.length !== reasons.length) {
        return 'exerciseIds and reasons must have the same length';
      }
      if (exerciseIds.length > EXTENSION_HOOK_MAX_EXERCISES) {
        return `at most ${EXTENSION_HOOK_MAX_EXERCISES} exercises allowed`;
      }
      const unknown = exerciseIds.find((id) => !library.hasExercise(id));
      return unknown === undefined ? null : `unknown exercise '${unknown}'`;
    },
  );
  if (response === undefined) return [...entries];
  return response.exerciseIds.map((exerciseId, index) => ({
    exerciseId,
    reason: response.reasons[index] as ItemReason,
  }));
};
