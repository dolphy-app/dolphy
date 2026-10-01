import type { ExerciseTypeErrorCause } from '@dolphy-app/engine/ports';
import { z } from 'zod';
import type { ResolvedExtension } from './discover.ts';

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

/**
 * Замена набора расширений: движок присылает полный набор (хост сам их не
 * ищет). Ответ `ok: true` приходит, когда новый каталог уже действует;
 * вытеснение прежних активаций идёт после ответа.
 */
export interface ReplaceExtensionsRequest {
  id: string;
  method: 'replaceExtensions';
  params: { extensions: ResolvedExtension[] };
}

/** Всё, что движок отправляет хосту расширений. */
export type ExtMessage = ExtRequest | ReplaceExtensionsRequest;

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

const isResolvedExtension = (value: unknown): value is ResolvedExtension => {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.version === 'string' &&
    typeof item.dir === 'string' &&
    typeof item.revision === 'string' &&
    (item.origin === 'bundled' ||
      item.origin === 'user' ||
      item.origin === 'dev') &&
    Array.isArray(item.permissions) &&
    Array.isArray(item.exerciseTypes) &&
    Array.isArray(item.themes) &&
    Array.isArray(item.markdownRenderers) &&
    Array.isArray(item.gradePolicies)
  );
};

/** Набор приходит от движка того же приложения, поэтому проверяется форма, а не каждое поле. */
const replaceExtensionsSchema = z.strictObject({
  id: z.string(),
  method: z.literal('replaceExtensions'),
  params: z.strictObject({
    extensions: z.array(z.custom<ResolvedExtension>(isResolvedExtension)),
  }),
});

/** Всё, что хост расширений принимает по каналу. */
export const extMessageSchema = z.union([
  extRequestSchema,
  replaceExtensionsSchema,
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
