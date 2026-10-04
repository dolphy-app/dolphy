import type { JsonValue } from '@dolphy-app/engine-contract';
import {
  EngineError,
  SECRET_STORE_LIMITS,
  prepareStorageWrite,
} from '@dolphy-app/engine/app';
import type { StorageLimits } from '@dolphy-app/engine/app';
import type {
  ExtensionDataSpace,
  ExtensionDataStore,
} from '@dolphy-app/engine/ports';
import { guard } from './errors.ts';
import type { SqlDatabase } from './sql-database.ts';

const parse = (
  table: string,
  extensionId: string,
  key: string,
  text: string,
) => {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new EngineError('STORE_CORRUPT', {
      message: `Invalid stored value (${table}:${extensionId}:${key})`,
      details: { subject: `${table}:${extensionId}:${key}` },
      cause: error,
    });
  }
};

/**
 * Одно пространство данных расширений в `table` (имя — константа адаптера, не
 * ввод): значение — JSON-текст, порядок ключей — `ORDER BY key` (BINARY, то
 * есть по байтам UTF-8 и кодовым точкам).
 */
const createSpace = (
  db: SqlDatabase,
  table: string,
  limits?: StorageLimits,
): ExtensionDataSpace => {
  const selectOne = db.prepare<{ value: string }>(
    `SELECT value FROM ${table} WHERE extension_id = ? AND key = ?`,
  );
  const selectAll = db.prepare<{ key: string; value: string }>(
    `SELECT key, value FROM ${table} WHERE extension_id = ? ORDER BY key`,
  );
  const selectKeys = db.prepare<{ key: string }>(
    `SELECT key FROM ${table} WHERE extension_id = ? ORDER BY key`,
  );
  const selectSize = db.prepare<{ bytes: number }>(
    `SELECT LENGTH(CAST(value AS BLOB)) AS bytes FROM ${table}
     WHERE extension_id = ? AND key = ?`,
  );
  const selectUsage = db.prepare<{ keys: number; bytes: number }>(
    `SELECT COUNT(*) AS keys,
            COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS bytes
     FROM ${table} WHERE extension_id = ?`,
  );
  const upsert = db.prepare(
    `INSERT INTO ${table} (extension_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(extension_id, key) DO UPDATE SET value = excluded.value`,
  );
  const deleteOne = db.prepare(
    `DELETE FROM ${table} WHERE extension_id = ? AND key = ?`,
  );
  const deleteAll = db.prepare(`DELETE FROM ${table} WHERE extension_id = ?`);
  const usageOf = (extensionId: string) =>
    selectUsage.get(extensionId) ?? { keys: 0, bytes: 0 };
  return {
    get: async (extensionId, key) =>
      guard(() => {
        const row = selectOne.get(extensionId, key);
        return row === undefined
          ? undefined
          : parse(table, extensionId, key, row.value);
      }),
    set: async (extensionId, key, value) =>
      guard(() =>
        // проверка потолков и запись — одна транзакция: параллельный писатель не обгонит
        db.transaction(() => {
          const { encoded } = prepareStorageWrite(
            extensionId,
            key,
            value,
            () => {
              const { keys, bytes } = usageOf(extensionId);
              const existing = selectSize.get(extensionId, key);
              return {
                existingBytes: existing?.bytes ?? null,
                keys,
                totalBytes: bytes,
              };
            },
            limits,
          );
          upsert.run(extensionId, key, encoded);
        }),
      ),
    delete: async (extensionId, key) =>
      guard(() => deleteOne.run(extensionId, key).changes > 0),
    keys: async (extensionId) =>
      guard(() => selectKeys.all(extensionId).map(({ key }) => key)),
    all: async (extensionId) =>
      guard(() =>
        Object.fromEntries(
          selectAll
            .all(extensionId)
            .map(({ key, value }) => [
              key,
              parse(table, extensionId, key, value),
            ]),
        ),
      ),
    usage: async (extensionId) => guard(() => usageOf(extensionId)),
    deleteAll: async (extensionId) =>
      guard(() => void deleteAll.run(extensionId)),
  };
};

/**
 * Данные расширений в `engine.db`: три таблицы с одинаковой формой и
 * независимыми потолками (в `extension_secret` — только шифртекст). Использует соединение хранилища журнала и не
 * закрывает его.
 */
export const createSqliteExtensionDataStore = (
  db: SqlDatabase,
): ExtensionDataStore => {
  const storage = createSpace(db, 'extension_storage');
  const settings = createSpace(db, 'extension_setting');
  const secrets = createSpace(db, 'extension_secret', SECRET_STORE_LIMITS);
  const deleteSecrets = db.prepare(
    'DELETE FROM extension_secret WHERE extension_id = ?',
  );
  const deleteStorage = db.prepare(
    'DELETE FROM extension_storage WHERE extension_id = ?',
  );
  const deleteSettings = db.prepare(
    'DELETE FROM extension_setting WHERE extension_id = ?',
  );
  return {
    storage,
    settings,
    secrets,
    deleteAllData: async (extensionId) =>
      guard(() =>
        db.transaction(() => {
          deleteStorage.run(extensionId);
          deleteSettings.run(extensionId);
          deleteSecrets.run(extensionId);
        }),
      ),
  };
};
