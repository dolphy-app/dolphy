/**
 * Request and response schemas of the hooks in `hooks.ts`. They live apart
 * from the names and types so that code which only registers or types a hook
 * (every browser bundle imports this package) does not pull `zod` in; the host,
 * the engine and the test server import them from
 * `@dolphy-app/extension-api/hook-schemas`.
 */

import { z } from 'zod';
import { EXTENSION_HOOK_LIMITS } from './hooks.ts';

const itemReason = z.enum(['review', 'new', 'remediation']);

/** `null` fields: the exercise has no attempts yet, so there is no memory state. */
const exerciseMemory = z.object({
  /** Probability of recall right now, 0..1. */
  retrievability: z.number().nullable(),
  /** Unix epoch milliseconds of the newest attempt. */
  lastAttemptAt: z.number().nullable(),
  /** Attempts that count (cancelled ones excluded). */
  attempts: z.number(),
  /** FSRS stability in days. */
  stability: z.number().nullable(),
  /** FSRS difficulty. */
  difficulty: z.number().nullable(),
});

/**
 * Request and response schema of every hook. The handlers of the extensions
 * that registered a hook run one after another in ascending order of the
 * extension id; each gets the response of the previous one (for a hook
 * without a response, the same request). A thrown error, an invalid
 * response or a handler exceeding `EXTENSION_HOOK_LIMITS.timeoutMs` cancels
 * the operation and the error message reaches the user.
 */
export const EXTENSION_HOOKS = Object.freeze({
  /**
   * A learning session is about to start. The handler can only cancel the
   * start by throwing.
   */
  'session.start': {
    request: z.object({
      /** Unix epoch milliseconds. */
      now: z.number(),
    }),
    response: z.void(),
  },
  /**
   * A batch of exercises or a day plan is about to be handed to the learner.
   * `exerciseIds` and `reasons` are parallel arrays; the response can
   * reorder, remove and add exercises (every id must exist in the library;
   * `exerciseIds` and `reasons` keep the same length, at most
   * `EXTENSION_HOOK_LIMITS.maxExercises`).
   */
  'practice.batch': {
    request: z.object({
      /** The open session; `null` while none has started. */
      sessionId: z.string().nullable(),
      /** `batch` — `practice.getBatch`, `plan` — `plan.getDay`. */
      source: z.enum(['batch', 'plan']),
      exerciseIds: z.array(z.string()),
      reasons: z.array(itemReason),
      /**
       * Parallel to `exerciseIds`: what the engine remembers of each
       * exercise. Read-only; the FSRS state is not changed by the hook.
       */
      memory: z.array(exerciseMemory),
    }),
    response: z
      .object({
        exerciseIds: z
          .array(z.string())
          .max(EXTENSION_HOOK_LIMITS.maxExercises),
        reasons: z.array(itemReason).max(EXTENSION_HOOK_LIMITS.maxExercises),
      })
      .refine(
        ({ exerciseIds, reasons }) => exerciseIds.length === reasons.length,
        { message: 'exerciseIds and reasons must have the same length' },
      ),
  },
});
