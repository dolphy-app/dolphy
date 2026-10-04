import type {
  ExtensionSettingChangeDto,
  ExtensionSettingValuesDto,
  JsonValue,
} from '@dolphy-app/engine-contract';
import {
  STATS_DAILY_MAX_DAYS,
  parseStatsDate,
} from '../../domain/learning-stats.ts';
import type { DailyResult, StreakResult } from '../../domain/learning-stats.ts';
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

export const createExtensionHostServices = (
  ctx: Pick<
    EngineContext,
    | 'extensionRegistry'
    | 'extensionPolicy'
    | 'extensionHealth'
    | 'extensionData'
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
  return {
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
