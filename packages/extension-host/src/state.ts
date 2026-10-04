import {
  SecretsUnavailableError,
  StorageQuotaError,
} from '@dolphy-app/extension-api';
import type {
  ExtensionLogger,
  ExtensionSecrets,
  ExtensionSettings,
  ExtensionStorage,
  JsonValue,
  SettingChange,
  SettingValue,
  StorageQuotaKind,
} from '@dolphy-app/extension-api';
import { EngineRequestError } from './engine-link.ts';
import type { EngineLink } from './engine-link.ts';
import type { ResolvedSetting } from './points/types.ts';

const QUOTA_KINDS: readonly StorageQuotaKind[] = [
  'key-length',
  'value-size',
  'key-count',
  'total-size',
];

/** Что видит код расширения: превышение потолка — `StorageQuotaError`, остальное — обычный `Error` с `code`. */
const extensionErrorOf = (error: unknown): unknown => {
  if (!(error instanceof EngineRequestError)) return error;
  const { kind, limit } = error.details ?? {};
  if (
    error.code === 'EXTENSION_STORAGE_QUOTA' &&
    QUOTA_KINDS.includes(kind as StorageQuotaKind) &&
    typeof limit === 'number'
  ) {
    return new StorageQuotaError(
      kind as StorageQuotaKind,
      limit,
      error.message,
    );
  }
  if (error.code === 'SECRETS_UNAVAILABLE') {
    return new SecretsUnavailableError(error.message);
  }
  return Object.assign(new Error(error.message), { code: error.code });
};

/** `ctx.storage` расширения: запросы к движку, который единственный владеет данными. */
export const createExtensionStorage = (
  link: EngineLink,
  extensionId: string,
): ExtensionStorage => {
  const request = async (
    method: 'storage.get' | 'storage.set' | 'storage.delete' | 'storage.keys',
    params: { key?: string; value?: JsonValue },
  ): Promise<unknown> => {
    try {
      return await link.request(method, { extensionId, ...params } as never);
    } catch (error) {
      throw extensionErrorOf(error);
    }
  };
  return {
    get: async <T extends JsonValue = JsonValue>(key: string) =>
      (await request('storage.get', { key })) as T | undefined,
    set: async (key, value) => {
      await request('storage.set', { key, value });
    },
    delete: async (key) =>
      (await request('storage.delete', { key })) as boolean,
    keys: async () => (await request('storage.keys', {})) as string[],
  };
};

/** `ctx.secrets` расширения: шифрует движок через платформу, значение живёт в процессе расширения только в ответе. */
export const createExtensionSecrets = (
  link: EngineLink,
  extensionId: string,
): ExtensionSecrets => {
  const request = async (
    method: 'secrets.get' | 'secrets.set' | 'secrets.delete',
    params: { key: string; value?: string },
  ): Promise<unknown> => {
    try {
      return await link.request(method, { extensionId, ...params } as never);
    } catch (error) {
      throw extensionErrorOf(error);
    }
  };
  return {
    get: async (key) => {
      const value = await request('secrets.get', { key });
      return typeof value === 'string' ? value : undefined;
    },
    set: async (key, value) => {
      await request('secrets.set', { key, value });
    },
    delete: async (key) =>
      (await request('secrets.delete', { key })) as boolean,
  };
};

/** Значение подходит определению по типу; границы проверил движок. */
const fits = (definition: ResolvedSetting, value: unknown): boolean => {
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'string':
    case 'text':
    case 'color':
      return typeof value === 'string';
    case 'list':
      return (
        Array.isArray(value) && value.every((item) => typeof item === 'string')
      );
    default:
      return (
        typeof value === 'string' &&
        definition.options.some((option) => option.value === value)
      );
  }
};

/** Скаляры сравниваются как есть, списки — поэлементно: `onDidChange` не срабатывает на то же значение. */
const sameValue = (a: SettingValue | undefined, b: SettingValue): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => item === b[index])
    : Object.is(a, b);

export interface SettingsState {
  readonly api: ExtensionSettings;
  /**
   * Подгружает действующие значения у движка. Сбой не мешает активации: до
   * первого изменения расширение читает `default` (в лог — предупреждение).
   * Изменения, пришедшие во время загрузки, применяются поверх неё.
   */
  load(fetch: () => Promise<unknown>): Promise<void>;
  /** Новое значение от движка; неизвестный `id` и то же значение игнорируются. */
  apply(change: SettingChange): void;
  /** Отписывает обработчики `onDidChange`; значения остаются читаемыми. */
  dispose(): void;
}

export const createSettingsState = (
  extensionId: string,
  definitions: readonly ResolvedSetting[],
  logger: ExtensionLogger,
): SettingsState => {
  const byId = new Map(definitions.map((item) => [item.id, item]));
  const values = new Map<string, SettingValue>(
    definitions.map((item) => [item.id, item.default]),
  );
  const handlers = new Set<(change: SettingChange) => void>();
  let loaded = false;
  const early = new Map<string, SettingValue>();

  const notify = (change: SettingChange): void => {
    for (const handler of [...handlers]) {
      const failed = (error: unknown): void =>
        logger.error(
          { extensionId, settingId: change.id, error },
          'setting change handler failed',
        );
      try {
        const result = handler(change) as unknown;
        if (result instanceof Promise) result.catch(failed);
      } catch (error) {
        failed(error);
      }
    }
  };

  const set = (id: string, value: SettingValue): void => {
    const definition = byId.get(id);
    if (definition === undefined || !fits(definition, value)) return;
    if (sameValue(values.get(id), value)) return;
    values.set(id, value);
    notify({ id, value });
  };

  return {
    api: {
      get: <T extends SettingValue = SettingValue>(id: string): T => {
        const value = values.get(id);
        if (value === undefined) {
          throw new Error(
            `setting '${id}' is not declared in the manifest of '${extensionId}'`,
          );
        }
        // список отдаётся копией: правка в коде не меняет состояние
        return (Array.isArray(value) ? [...value] : value) as T;
      },
      onDidChange(handler) {
        handlers.add(handler);
        return { dispose: () => void handlers.delete(handler) };
      },
    },
    async load(fetch) {
      if (definitions.length > 0) {
        try {
          const all = (await fetch()) as Record<string, unknown>;
          for (const definition of definitions) {
            const value = all[definition.id];
            if (fits(definition, value)) {
              values.set(definition.id, value as SettingValue);
            }
          }
        } catch (error) {
          logger.warn(
            { extensionId, error },
            'extension settings were not loaded, defaults are used',
          );
        }
      }
      loaded = true;
      for (const [id, value] of early) set(id, value);
      early.clear();
    },
    apply(change) {
      if (loaded) set(change.id, change.value);
      else early.set(change.id, change.value);
    },
    dispose: () => handlers.clear(),
  };
};
