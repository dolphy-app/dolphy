import type { ExerciseTypeErrorCause } from '@lms/engine/ports';
import { z } from 'zod';

export type ExtRequest =
  | {
      id: string;
      method: 'project';
      params: {
        type: string;
        exerciseId: string;
        spec: unknown;
        isolated: boolean;
      };
    }
  | {
      id: string;
      method: 'grade';
      params: {
        type: string;
        exerciseId: string;
        spec: unknown;
        answer: unknown;
        timeoutMs: number;
        authorMode: boolean;
        isolated: boolean;
      };
    }
  | {
      id: string;
      method: 'referenceAnswer';
      params: {
        type: string;
        exerciseId: string;
        spec: unknown;
        isolated: boolean;
      };
    }
  | {
      id: string;
      method: 'gradePolicy';
      params: {
        policyId: string;
        verdicts: { outcome: 'passed' | 'failed' | 'error'; reason?: string }[];
        gaveUp: boolean;
        isolated: boolean;
      };
    };

/** Причины отказа, которые сообщает сам хост расширений (остальные порождает клиент). */
export type ExtFailureCause =
  Exclude<ExerciseTypeErrorCause, 'host-down' | 'timeout'> | 'unknown-policy';

export type ExtResponse =
  | { id: string; ok: true; result: unknown }
  | {
      id: string;
      ok: false;
      error: {
        cause: ExtFailureCause;
        message: string;
      };
    };

const typed = {
  type: z.string(),
  exerciseId: z.string(),
  spec: z.unknown(),
  isolated: z.boolean(),
};

export const extRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({
    id: z.string(),
    method: z.literal('project'),
    params: z.strictObject(typed),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('grade'),
    params: z.strictObject({
      ...typed,
      answer: z.unknown(),
      timeoutMs: z.number(),
      authorMode: z.boolean(),
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('referenceAnswer'),
    params: z.strictObject(typed),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('gradePolicy'),
    params: z.strictObject({
      policyId: z.string(),
      verdicts: z.array(
        z.strictObject({
          outcome: z.enum(['passed', 'failed', 'error']),
          reason: z.string().optional(),
        }),
      ),
      gaveUp: z.boolean(),
      isolated: z.boolean(),
    }),
  }),
]);

/** Результат правила оценки: целое 1–5 или `null`. */
export const gradeValueSchema = z.union([z.literal([1, 2, 3, 4, 5]), z.null()]);

const reason = z.string().min(1).max(100);
const text = z.string().max(4000);

export const gradeResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('passed'),
    feedback: text.optional(),
    data: z.unknown().optional(),
  }),
  z.strictObject({
    outcome: z.literal('failed'),
    reason,
    feedback: text.optional(),
    detail: text.optional(),
    data: z.unknown().optional(),
  }),
  z.strictObject({
    outcome: z.literal('error'),
    reason,
    feedback: text.optional(),
    data: z.unknown().optional(),
  }),
]);
