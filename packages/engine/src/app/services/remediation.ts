import type { RemediationService } from '@dolphy-app/engine-contract';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';

/** `remediation.getPlan` (engine-ts-api.md §4.3): чтение проекции `RemediationTracker`. */
export const createRemediationService = (
  ctx: EngineContext,
): RemediationService => ({
  getPlan: async ({ exerciseId }) => {
    if (
      typeof exerciseId !== 'string' ||
      !ctx.library.require().hasExercise(exerciseId)
    ) {
      throw new EngineError('NOT_FOUND', { details: { exerciseId } });
    }
    return ctx.projections.remediation.getPlan(exerciseId);
  },
});
