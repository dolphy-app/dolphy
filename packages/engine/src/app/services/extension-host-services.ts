import type {
  ExtensionSettingChangeDto,
  ExtensionSettingValuesDto,
  JsonValue,
} from '@dolphy-app/engine-contract';
import {
  EXTENSION_SECRET_LIMITS,
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
    | 'platform'
    | 'extensionSettingChanges'
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
        if (stored === undefined) return undefined;
        return viaCipher(async () => {
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
