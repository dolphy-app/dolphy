import type { ExerciseTypeErrorCause } from '@lms/engine/ports';
import { z } from 'zod';

export type ExtRequest =
  | {
      id: string;
      method: 'project';
      params: { type: string; exerciseId: string; spec: unknown };
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
      };
    }
  | {
      id: string;
      method: 'referenceAnswer';
      params: { type: string; exerciseId: string; spec: unknown };
    };

export type ExtResponse =
  | { id: string; ok: true; result: unknown }
  | {
      id: string;
      ok: false;
      error: {
        cause: Exclude<ExerciseTypeErrorCause, 'host-down' | 'timeout'>;
        message: string;
      };
    };

const typed = { type: z.string(), exerciseId: z.string(), spec: z.unknown() };

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
]);

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
