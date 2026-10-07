import type { ExerciseTypeErrorCause } from '@dolphy-app/engine/ports';
import {
  EXTENSION_COMMAND_LIMITS,
  LEARNING_EVENT_NAMES,
} from '@dolphy-app/extension-api';
import type {
  ExportInput,
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
      };
    }
  | {
      id: string;
      method: 'referenceAnswer';
      params: {
        type: string;
        exerciseId: string;
        spec: unknown;
      };
    }
  | {
      id: string;
      method: 'gradePolicy';
      params: {
        policyId: string;
        verdicts: { outcome: 'passed' | 'failed' | 'error'; reason?: string }[];
        gaveUp: boolean;
      };
    }
  | DeliverEventRequest
  | FireScheduleRequest
  | InvokeCommandRequest
  | RunImporterRequest
  | RunExporterRequest;

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
  };
}

/**
 * Срабатывание расписания (`ctx.schedule.on`). Лениво активирует расширение;
 * ответ `{ delivered }`: `false` — расписание не объявлено или обработчик не
 * подписан. Сбой обработчика — `handler-failed`, превышение 10 с —
 * `handler-timeout`; клиент их только учитывает и логирует.
 */
export interface FireScheduleRequest {
  id: string;
  method: 'fireSchedule';
  params: {
    extensionId: string;
    scheduleId: string;
  };
}

/**
 * Вызов команды расширения (`ctx.commands.register`). Лениво активирует
 * расширение; `args` — JSON вызывающего (нет аргументов — ключа нет). Ответ —
 * `CommandOutcome`; неизвестная команда — `unknown-command`, сбой обработчика —
 * `handler-failed`, превышение 10 с — `handler-timeout`.
 */
export interface InvokeCommandRequest {
  id: string;
  method: 'invokeCommand';
  params: {
    extensionId: string;
    commandId: string;
    args?: JsonValue;
  };
}

/**
 * Запуск импортёра (`ctx.importers.register`): файл, который выбрал
 * пользователь, целиком в `text` (UTF-8) либо в `bytes` — по `input`
 * импортёра. Лениво активирует расширение. Ответ — `ImportResult`, уже
 * проверенный `normalizeImportResult`; неизвестный или незарегистрированный
 * импортёр — `unknown-importer`, сбой обработчика — `handler-failed`, срок
 * `EXTENSION_TRANSFER_LIMITS.handlerMs` — `handler-timeout`, неверный
 * результат — `invalid-result`.
 */
export interface RunImporterRequest {
  id: string;
  method: 'runImporter';
  params: {
    extensionId: string;
    importerId: string;
    name: string;
  } & ({ text: string } | { bytes: Uint8Array });
}

/**
 * Запуск экспортёра (`ctx.exporters.register`): снимок курса либо запрос
 * прогресса — по `scope` экспортёра. Ответ — `ExportResult`, проверенный
 * `normalizeExportResult`; причины как у `runImporter` (`unknown-exporter`).
 */
export interface RunExporterRequest {
  id: string;
  method: 'runExporter';
  params: {
    extensionId: string;
    exporterId: string;
    input: ExportInput;
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
  | {
      id: string;
      method: 'secrets.get';
      params: { extensionId: string; key: string };
    }
  | {
      id: string;
      method: 'secrets.set';
      params: { extensionId: string; key: string; value: string };
    }
  | {
      id: string;
      method: 'secrets.delete';
      params: { extensionId: string; key: string };
    }
  | { id: string; method: 'settings.all'; params: { extensionId: string } }
  | {
      id: string;
      method: 'stats.streak';
      params: { extensionId: string; courseId?: string };
    }
  | {
      id: string;
      method: 'stats.daily';
      params: {
        extensionId: string;
        from: string;
        to: string;
        courseId?: string;
      };
    }
  | {
      id: string;
      method: 'notifications.show';
      params: { extensionId: string; title: string; body: string };
    }
  | { id: string; method: 'health.report'; params: HealthReport };

/**
 * Здоровье расширения, о котором знает только хост: `activated` — активация
 * прошла за `durationMs`; `failed` — сбой вне вызова (процесс убит за предел
 * IPC; сбои вызовов учитывает сторона движка по исходу вызова); `suppressed` — ограниченный процесс приостановлен за
 * цикл падений до `until` (epoch ms); `reset` — файлы расширения сменились или
 * оно убрано, сводка начинается заново.
 */
export type HealthReport = { extensionId: string } & (
  | { kind: 'activated'; durationMs: number }
  | { kind: 'failed'; reason: string; message: string }
  | { kind: 'suppressed'; until: number }
  | { kind: 'reset' }
);

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
  | Exclude<ExerciseTypeErrorCause, 'host-down' | 'timeout'>
  | 'unknown-policy'
  | 'unknown-command'
  | 'unknown-importer'
  | 'unknown-exporter'
  | 'handler-timeout'
  | 'activation-timeout'
  | 'ipc-size'
  | 'ipc-rate'
  | 'replaced';

/**
 * Причина отказа хоста считается сбоем расширения: отказ или превышение срока
 * обработчика, неверный результат, сбой или превышение срока активации.
 * Остальные (`unknown-type`, `replaced`, ...) — решение системы, расширение в
 * них не виновато. Пределы IPC (`ipc-size`, `ipc-rate`) здесь не числятся: сбой
 * учитывает сам раннер сообщением `health.report` (`failed`), иначе вызов в
 * полёте посчитал бы его второй раз.
 */
export const isFault = (cause: ExtFailureCause): boolean =>
  cause === 'handler-failed' ||
  cause === 'handler-timeout' ||
  cause === 'invalid-result' ||
  cause === 'activation-failed' ||
  cause === 'activation-timeout';

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
});

const scheduleParams = z.strictObject({
  extensionId: z.string(),
  scheduleId: z.string(),
});

const commandParams = z.strictObject({
  extensionId: z.string(),
  commandId: z.string(),
  args: z.unknown().optional(),
});

const bytesField = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  'must be a Uint8Array',
);

const importParams = {
  extensionId: z.string(),
  importerId: z.string(),
  name: z.string(),
};

const exportInput = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('course'),
    courseId: z.string(),
    title: z.string(),
    files: z.record(z.string(), z.string()),
  }),
  z.strictObject({ scope: z.literal('progress') }),
]);

const typed = {
  type: z.string(),
  exerciseId: z.string(),
  spec: z.unknown(),
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
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('deliverEvent'),
    params: eventParams,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('fireSchedule'),
    params: scheduleParams,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('invokeCommand'),
    params: commandParams,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('runImporter'),
    params: z.union([
      z.strictObject({ ...importParams, text: z.string() }),
      z.strictObject({ ...importParams, bytes: bytesField }),
    ]),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('runExporter'),
    params: z.strictObject({
      extensionId: z.string(),
      exporterId: z.string(),
      input: exportInput,
    }),
  }),
]);

const settingValue = z.union([
  z.boolean(),
  z.string(),
  z.number(),
  z.array(z.string()),
]);

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
    method: z.literal('secrets.get'),
    params: hostKey,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('secrets.set'),
    // тип значения проверяет служба движка: ошибка приходит как `INVALID_ARGUMENT`
    params: z.strictObject({
      extensionId: z.string(),
      key: z.string(),
      value: z.unknown(),
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('secrets.delete'),
    params: hostKey,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('settings.all'),
    params: hostOwner,
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('stats.streak'),
    params: z.strictObject({
      extensionId: z.string(),
      courseId: z.string().optional(),
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('stats.daily'),
    params: z.strictObject({
      extensionId: z.string(),
      from: z.string(),
      to: z.string(),
      courseId: z.string().optional(),
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('notifications.show'),
    params: z.strictObject({
      extensionId: z.string(),
      title: z.string(),
      body: z.string(),
    }),
  }),
  z.strictObject({
    id: z.string(),
    method: z.literal('health.report'),
    params: z.discriminatedUnion('kind', [
      z.strictObject({
        extensionId: z.string(),
        kind: z.literal('activated'),
        durationMs: z.number().finite().nonnegative(),
      }),
      z.strictObject({
        extensionId: z.string(),
        kind: z.literal('failed'),
        reason: z.string(),
        message: z.string(),
      }),
      z.strictObject({
        extensionId: z.string(),
        kind: z.literal('suppressed'),
        until: z.number().finite().nonnegative(),
      }),
      z.strictObject({ extensionId: z.string(), kind: z.literal('reset') }),
    ]),
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
    Array.isArray(item.dependencies) &&
    typeof item.messages === 'object' &&
    item.messages !== null &&
    Array.isArray(item.warnings) &&
    Array.isArray(item.exerciseTypes) &&
    Array.isArray(item.themes) &&
    Array.isArray(item.markdownRenderers) &&
    Array.isArray(item.gradePolicies) &&
    Array.isArray(item.settings) &&
    Array.isArray(item.events) &&
    Array.isArray(item.commands) &&
    Array.isArray(item.panels) &&
    Array.isArray(item.widgets) &&
    Array.isArray(item.schedules) &&
    Array.isArray(item.importers) &&
    Array.isArray(item.exporters)
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

const isJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1));
  }
  if (typeof value !== 'object') return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
};

const fitsResult = (value: unknown): boolean =>
  isJsonValue(value) &&
  new TextEncoder().encode(JSON.stringify(value)).length <=
    EXTENSION_COMMAND_LIMITS.resultBytes;

const resultJson = z.custom<JsonValue>(fitsResult, 'must be JSON up to 64 KiB');

/**
 * Результат команды на границе хоста и движка. Ограниченный процесс не
 * доверен, поэтому форму и потолки проверяет и получатель, а не только
 * `normalizeCommandResult` в рантайме.
 */
export const commandOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('notify'),
    text: z.string().min(1).max(EXTENSION_COMMAND_LIMITS.notifyChars),
  }),
  z.strictObject({
    kind: z.literal('openPanel'),
    panelId: z.string().min(1).max(128),
    props: resultJson.optional(),
  }),
  z.strictObject({ kind: z.literal('data'), value: resultJson }),
]);
