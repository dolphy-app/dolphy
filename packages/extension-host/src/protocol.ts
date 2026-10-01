import type { ExerciseTypeErrorCause } from '@dolphy-app/engine/ports';
import { LEARNING_EVENT_NAMES } from '@dolphy-app/extension-api';
import type {
  JsonValue,
  LearningEventName,
  LearningEventPayloads,
  SettingValue,
} from '@dolphy-app/extension-api';
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
    }
  | DeliverEventRequest;

/**
 * Событие обучения расширению. Ответ `{ delivered }`: `false` — обработчика нет
 * (расширение не объявило событие или не подписалось). Лениво активирует
 * расширение; сбой и таймаут обработчика (2 с) — `ok: false`, клиент их только
 * логирует.
 */
export interface DeliverEventRequest {
  id: string;
  method: 'deliverEvent';
  params: {
    extensionId: string;
    name: LearningEventName;
    payload: LearningEventPayloads[LearningEventName];
    isolated: boolean;
  };
}

/** Значение настройки расширения изменилось: хост сообщает его работающему расширению. Без ответа. */
export interface SettingChangedNotice {
  method: 'settingChanged';
  params: { extensionId: string; id: string; value: SettingValue };
}

/**
 * Запросы хоста к движку: данные расширения. Собственное пространство
 * идентификаторов (`h<N>`); ответ — `HostResponse`.
 */
export type HostRequest =
  | {
      id: string;
      method: 'storage.get';
      params: { extensionId: string; key: string };
    }
  | {
      id: string;
      method: 'storage.set';
      params: { extensionId: string; key: string; value: JsonValue };
    }
  | {
      id: string;
      method: 'storage.delete';
      params: { extensionId: string; key: string };
    }
  | { id: string; method: 'storage.keys'; params: { extensionId: string } }
  | { id: string; method: 'settings.all'; params: { extensionId: string } };

export type HostMethod = HostRequest['method'];

/** Отказ движка на запрос хоста: `code` — код ошибки движка (`EXTENSION_STORAGE_QUOTA`, `INVALID_ARGUMENT`, …) или `UNAVAILABLE`. */
export interface HostFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type HostResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: HostFailure };

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

const eventParams = z.strictObject({
  extensionId: z.string(),
  name: z.enum(LEARNING_EVENT_NAMES),
  payload: z.record(z.string(), z.unknown()),
  isolated: z.boolean(),
});

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
  z.strictObject({
    id: z.string(),
    method: z.literal('deliverEvent'),
    params: eventParams,
  }),
]);

const settingValue = z.union([z.boolean(), z.string(), z.number()]);

export const settingChangedSchema = z.strictObject({
  method: z.literal('settingChanged'),
  params: z.strictObject({
    extensionId: z.string(),
    id: z.string(),
    value: settingValue,
  }),
});

const hostKey = z.strictObject({ extensionId: z.string(), key: z.string() });
const hostOwner = z.strictObject({ extensionId: z.string() });

/** Запрос хоста к движку: форму проверяет получатель, значение хранилища — сервис движка. */
export const hostRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({
    id: z.string(),
    method: z.literal('storage.get'),
    params: hostKey,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('storage.set'),
    params: z.strictObject({
      extensionId: z.string(),
      key: z.string(),
      value: z.unknown(),
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('storage.delete'),
    params: hostKey,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('storage.keys'),
    params: hostOwner,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('settings.all'),
    params: hostOwner,
  }),
]);

export const hostResponseSchema = z.union([
  // `undefined` (ключа нет, значение не записано) через JSON-IPC теряет ключ `result`
  z.strictObject({
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown().optional(),
  }),
  z.strictObject({
    id: z.string(),
    ok: z.literal(false),
    error: z.strictObject({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
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
    Array.isArray(item.gradePolicies) &&
    Array.isArray(item.settings) &&
    Array.isArray(item.events)
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
  settingChangedSchema,
  hostResponseSchema,
]);

/** Всё, что ограниченный процесс принимает от хоста (набор расширений ему не шлют). */
export const childInboundSchema = z.union([
  extRequestSchema,
  settingChangedSchema,
  hostResponseSchema,
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
