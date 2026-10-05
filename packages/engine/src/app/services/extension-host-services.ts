import type {
  ExtensionInfoDto,
  ExtensionSettingChangeDto,
  ExtensionSettingValuesDto,
  JsonValue,
} from '@dolphy-app/engine-contract';
import {
  STATS_DAILY_MAX_DAYS,
  parseStatsDate,
} from '../../domain/learning-stats.ts';
import type { DailyResult, StreakResult } from '../../domain/learning-stats.ts';
import {
  EXTENSION_NOTIFICATION_LIMITS,
  EXTENSION_SECRET_LIMITS,
  createNotificationRateLimiter,
  sanitizeNotificationText,
  textLength,
  utf8Length,
} from '../../domain/index.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { createExtensionValues } from '../extension-values.ts';

/**
 * Что движок отдаёт хосту расширений: данные расширения по его id. Обычный
 * объект, не RPC и не команда окна: вызывается из канала хоста
 * (`@dolphy-app/extension-host`) и в очередь команд не встаёт. Запрос
 * неизвестного расширения — `NOT_FOUND`, отключённого — `INVALID_ARGUMENT`
 * `{ reason: 'disabled' }`; недопустимый ключ или не JSON-значение —
 * `INVALID_ARGUMENT`, превышение потолка — `EXTENSION_STORAGE_QUOTA`.
 */
export interface ExtensionHostServices {
  readonly storage: {
    get(extensionId: string, key: string): Promise<JsonValue | undefined>;
    set(extensionId: string, key: string, value: JsonValue): Promise<void>;
    /** `false`, если ключа не было. */
    delete(extensionId: string, key: string): Promise<boolean>;
    keys(extensionId: string): Promise<string[]>;
  };
  /**
   * Секреты расширения: открытое значение уходит шифру платформы, в
   * хранилище остаётся шифртекст. Без системного хранилища ключей `set` и
   * `get` существующего ключа — `SECRETS_UNAVAILABLE`; `get` отсутствующего
   * ключа — `undefined`, `delete` работает всегда. Потолки —
   * `EXTENSION_SECRET_LIMITS` (`EXTENSION_STORAGE_QUOTA`).
   */
  readonly secrets: {
    get(extensionId: string, key: string): Promise<string | undefined>;
    set(extensionId: string, key: string, value: string): Promise<void>;
    /** `false`, если ключа не было. */
    delete(extensionId: string, key: string): Promise<boolean>;
  };
  readonly settings: {
    /** Действующие значения по `id` определений: сохранённое пользователем или `default`. */
    all(extensionId: string): Promise<ExtensionSettingValuesDto>;
  };
  /**
   * Агрегированная статистика обучения (`ctx.stats`): нужно разрешение
   * `learning.stats`, иначе `INVALID_ARGUMENT` `{ reason: 'permission',
   * permission: 'learning.stats' }`. Только числа: идентификаторов заданий и
   * курсов в ответе нет. `courseId` не задан — все курсы; неизвестный курс —
   * нули. `daily`: `from` и `to` — даты `YYYY-MM-DD`, `from ≤ to`, не более
   * 366 дат (`INVALID_ARGUMENT` с `details.field`).
   */
  readonly stats: {
    streak(extensionId: string, courseId?: string): Promise<StreakResult>;
    daily(
      extensionId: string,
      from: string,
      to: string,
      courseId?: string,
    ): Promise<DailyResult[]>;
  };
  /**
   * Системные уведомления (`ctx.notifications`): нужно разрешение
   * `notifications`, иначе `INVALID_ARGUMENT` `{ reason: 'permission',
   * permission: 'notifications' }`. Текст очищается от управляющих
   * символов; пустое название или длина сверх `EXTENSION_NOTIFICATION_LIMITS`
   * — `INVALID_ARGUMENT` с `details.field` (`title` | `body`). Сверх
   * `perMinute`/`perHour` — `INVALID_ARGUMENT` `{ reason: 'rate-limit',
   * window, limit }`. `false` — переключатель «Уведомления» выключен или
   * платформа уведомления не показывает; такой вызов лимит не расходует.
   */
  readonly notifications: {
    show(extensionId: string, title: string, body: string): Promise<boolean>;
  };
  /**
   * Сообщения хоста о здоровье расширения: длительность активации, сбой вне
   * вызова (процесс убит за предел IPC), приостановка за цикл падений, сброс при смене файлов расширения. В отличие
   * от данных расширения, принимаются и для отключённого: это учёт, а не доступ.
   */
  readonly health: {
    activated(extensionId: string, durationMs: number): void;
    failed(extensionId: string, reason: string, message: string): void;
    suppressed(extensionId: string, until: number): void;
    reset(extensionId: string): void;
  };
  /**
   * Значение настройки изменилось (пользователь, сброс, очистка данных):
   * хост пересылает это работающему расширению. Вызывается сразу после
   * записи; исключение слушателя логируется и дальше не идёт. Возвращает отписку.
   */
  onSettingChanged(
    listener: (change: ExtensionSettingChangeDto) => void,
  ): () => void;
}

const MESSAGE_KEY = /^%([A-Za-z0-9_.-]{1,64})%$/;

/**
 * Имя расширения в уведомлении: название манифеста, `%ключ%` — по таблице
 * `en` (язык окна движок не знает); нет названия — id.
 */
const sourceNameOf = (info: ExtensionInfoDto): string => {
  const name = info.name;
  if (name === null) return info.id;
  const key = MESSAGE_KEY.exec(name)?.[1];
  if (key === undefined) return name;
  return info.messages.en?.[key] ?? info.id;
};

export const createExtensionHostServices = (
  ctx: Pick<
    EngineContext,
    | 'extensionRegistry'
    | 'extensionPolicy'
    | 'extensionHealth'
    | 'extensionData'
    | 'platform'
    | 'settings'
    | 'clock'
    | 'extensionSettingChanges'
    | 'statsIndex'
    | 'emit'
    | 'state'
  >,
): ExtensionHostServices => {
  const values = createExtensionValues(ctx);
  /** Расширение действует, пока движок открыт. */
  const active = (extensionId: string): string => {
    if (ctx.state.closed) throw new EngineError('ENGINE_CLOSED');
    return values.requireActive(extensionId);
  };
  const { storage } = ctx.extensionData;
  /** Ключ приходит из процесса расширения: тип проверяется на границе, длину и пустоту — хранилище. */
  const keyOf = (key: unknown): string => {
    if (typeof key !== 'string') {
      throw new EngineError('INVALID_ARGUMENT', {
        message: 'Storage key must be a string',
        details: { field: 'key' },
      });
    }
    return key;
  };
  /** Разрешение проверяет движок, а не процесс расширения: ограниченному процессу доверять нельзя. */
  const statsOf = (extensionId: string): string => {
    const id = active(extensionId);
    const info = ctx.extensionRegistry
      .list()
      .find((item) => item.id === id && item.state === 'loaded');
    if (info?.permissions.includes('learning.stats') !== true) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Extension '${id}' does not declare the 'learning.stats' permission`,
        details: {
          reason: 'permission',
          permission: 'learning.stats',
          extensionId: id,
        },
      });
    }
    return id;
  };
  const courseIdOf = (courseId: unknown): string | undefined => {
    if (courseId !== undefined && typeof courseId !== 'string') {
      throw new EngineError('INVALID_ARGUMENT', {
        message: 'courseId must be a string',
        details: { field: 'courseId' },
      });
    }
    return courseId;
  };
  const dateOf = (field: 'from' | 'to', value: unknown): number => {
    const day = parseStatsDate(value);
    if (day === null) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `'${field}' must be a date as YYYY-MM-DD`,
        details: { field },
      });
    }
    return day;
  };
  const notificationsOf = (extensionId: string): ExtensionInfoDto => {
    const id = active(extensionId);
    const info = ctx.extensionRegistry
      .list()
      .find((item) => item.id === id && item.state === 'loaded');
    if (info?.permissions.includes('notifications') !== true) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Extension '${id}' does not declare the 'notifications' permission`,
        details: {
          reason: 'permission',
          permission: 'notifications',
          extensionId: id,
        },
      });
    }
    return info;
  };
  const notificationText = (
    field: 'title' | 'body',
    value: unknown,
    max: number,
  ): string => {
    if (typeof value !== 'string') {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Notification ${field} must be a string`,
        details: { field },
      });
    }
    const text = sanitizeNotificationText(value, {
      multiline: field === 'body',
    });
    if ((field === 'title' && text === '') || textLength(text) > max) {
      throw new EngineError('INVALID_ARGUMENT', {
        message: `Notification ${field} must be ${field === 'title' ? '1 to ' : 'up to '}${max} characters`,
        details: { field, max },
      });
    }
    return text;
  };
  const limiter = createNotificationRateLimiter();
  const { secrets } = ctx.extensionData;
  const { cipher } = ctx.platform;
  /** Шифр не отвечает или отказал: ни запись, ни чтение невозможны. */
  const unavailable = (cause?: unknown): EngineError =>
    new EngineError('SECRETS_UNAVAILABLE', {
      message: 'System secret store is unavailable',
      ...(cause !== undefined && { cause }),
    });
  const viaCipher = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw error instanceof EngineError && error.code === 'SECRETS_UNAVAILABLE'
        ? error
        : unavailable(error);
    }
  };
  const quota = (extensionId: string, kind: string, limit: number) =>
    new EngineError('EXTENSION_STORAGE_QUOTA', {
      message: `Extension secret quota exceeded (${kind}: limit ${limit})`,
      details: { extensionId, kind, limit },
    });
  return {
    secrets: {
      get: async (extensionId, key) => {
        const id = active(extensionId);
        const stored = await secrets.get(id, keyOf(key));
        return stored === undefined
          ? undefined
          : viaCipher(async () => {
              if (!(await cipher.available())) throw unavailable();
              return cipher.decrypt(stored as string);
            });
      },
      set: async (extensionId, key, value) => {
        const id = active(extensionId);
        const name = keyOf(key);
        if (typeof value !== 'string') {
          throw new EngineError('INVALID_ARGUMENT', {
            message: 'Secret value must be a string',
            details: { field: 'value' },
          });
        }
        const limits = EXTENSION_SECRET_LIMITS;
        if (name.length > limits.keyLength) {
          throw quota(id, 'key-length', limits.keyLength);
        }
        if (utf8Length(value) > limits.valueBytes) {
          throw quota(id, 'value-size', limits.valueBytes);
        }
        const encrypted = await viaCipher(async () => {
          if (!(await cipher.available())) throw unavailable();
          return cipher.encrypt(value);
        });
        await secrets.set(id, name, encrypted);
      },
      delete: async (extensionId, key) =>
        secrets.delete(active(extensionId), keyOf(key)),
    },
    storage: {
      get: async (extensionId, key) =>
        storage.get(active(extensionId), keyOf(key)),
      set: async (extensionId, key, value) =>
        storage.set(active(extensionId), keyOf(key), value),
      delete: async (extensionId, key) =>
        storage.delete(active(extensionId), keyOf(key)),
      keys: async (extensionId) => storage.keys(active(extensionId)),
    },
    settings: {
      all: async (extensionId) => values.values(active(extensionId)),
    },
    stats: {
      streak: async (extensionId, courseId) => {
        statsOf(extensionId);
        return ctx.statsIndex.streak(courseIdOf(courseId));
      },
      daily: async (extensionId, from, to, courseId) => {
        statsOf(extensionId);
        const first = dateOf('from', from);
        const last = dateOf('to', to);
        if (last < first || last - first + 1 > STATS_DAILY_MAX_DAYS) {
          throw new EngineError('INVALID_ARGUMENT', {
            message: `The range must be ascending and cover at most ${STATS_DAILY_MAX_DAYS} dates`,
            details: { field: 'to', maxDays: STATS_DAILY_MAX_DAYS },
          });
        }
        return ctx.statsIndex.daily(first, last, courseIdOf(courseId));
      },
    },
    notifications: {
      show: async (extensionId, title, body) => {
        const info = notificationsOf(extensionId);
        const limits = EXTENSION_NOTIFICATION_LIMITS;
        const notification = {
          source: sourceNameOf(info),
          title: notificationText('title', title, limits.titleLength),
          body: notificationText('body', body, limits.bodyLength),
        };
        const { notificationsOff } = await ctx.settings.loadExtensions();
        if (notificationsOff.includes(info.id)) return false;
        const exhausted = limiter.take(info.id, ctx.clock.now());
        if (exhausted !== null) {
          const limit = exhausted === 'minute' ? limits.perMinute : limits.perHour;
          throw new EngineError('INVALID_ARGUMENT', {
            message: `Notification rate limit exceeded: ${limit} per ${exhausted}`,
            details: {
              reason: 'rate-limit',
              window: exhausted,
              limit,
              extensionId: info.id,
            },
          });
        }
        return ctx.platform.notifier.show(notification);
      },
    },
    health: {
      activated: (extensionId, durationMs) =>
        ctx.extensionHealth.recordActivation(extensionId, durationMs),
      failed: (extensionId, reason, message) =>
        ctx.extensionHealth.recordFailure(extensionId, reason, message),
      suppressed: (extensionId, until) =>
        ctx.extensionHealth.recordSuppression(extensionId, until),
      reset: (extensionId) => ctx.extensionHealth.forget(extensionId),
    },
    onSettingChanged: ctx.extensionSettingChanges.subscribe,
  };
};
