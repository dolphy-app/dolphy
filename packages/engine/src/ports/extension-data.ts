import type { JsonValue } from '@dolphy-app/engine-contract';

/** Занятое место одного пространства: число ключей и байты JSON-значений. */
export interface ExtensionDataUsage {
  keys: number;
  bytes: number;
}

/**
 * Пространство ключей одного вида данных расширения (`ExtensionDataStore`).
 * Адаптеры хранят JSON-текст и отдают каждый раз новую копию. Потолки
 * (`EXTENSION_STORAGE_LIMITS`) проверяет сам адаптер до записи: нарушение —
 * `EngineError('EXTENSION_STORAGE_QUOTA')`, не-JSON значение или пустой ключ —
 * `INVALID_ARGUMENT`; при отказе ничего не меняется.
 */
export interface ExtensionDataSpace {
  get(extensionId: string, key: string): Promise<JsonValue | undefined>;
  set(extensionId: string, key: string, value: JsonValue): Promise<void>;
  /** `false`, если ключа не было. */
  delete(extensionId: string, key: string): Promise<boolean>;
  /** Ключи по кодовым точкам. */
  keys(extensionId: string): Promise<string[]>;
  /** Все пары расширения в порядке `keys`. */
  all(extensionId: string): Promise<Record<string, JsonValue>>;
  usage(extensionId: string): Promise<ExtensionDataUsage>;
  /** Стирает пространство расширения; чужие данные не затрагиваются. */
  deleteAll(extensionId: string): Promise<void>;
}

/**
 * Данные расширений на устройстве: хранилище кода (`storage`), значения
 * настроек (`settings`) и секреты (`secrets`) — независимые таблицы со своими
 * потолками. В журнал и синхронизацию не входят. Адаптеры: SQLite
 * (`engine.db`) и память.
 *
 * `secrets` хранит только шифртекст (base64-строку от `SecretCipher`) под
 * потолками `SECRET_STORE_LIMITS`; шифрует и расшифровывает служба хоста
 * расширений, адаптер значений не видит.
 */
export interface ExtensionDataStore {
  readonly storage: ExtensionDataSpace;
  readonly settings: ExtensionDataSpace;
  readonly secrets: ExtensionDataSpace;
  /** Стирает все три пространства расширения одной операцией. */
  deleteAllData(extensionId: string): Promise<void>;
}
