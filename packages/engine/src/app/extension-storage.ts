import {
  encodeJson,
  findStorageViolation,
  utf8Length,
} from '../domain/index.ts';
import type { StorageLimits, StorageSnapshot } from '../domain/index.ts';
import { EngineError } from './errors.ts';

/**
 * Проверка записи в пространство данных расширения; общая для всех адаптеров
 * `ExtensionDataStore`, чтобы потолки не зависели от хранилища. Возвращает
 * JSON-текст и его размер в байтах.
 */
export const prepareStorageWrite = (
  extensionId: string,
  key: unknown,
  value: unknown,
  snapshot: () => StorageSnapshot,
  limits?: StorageLimits,
): { encoded: string; bytes: number } => {
  if (typeof key !== 'string' || key === '') {
    throw new EngineError('INVALID_ARGUMENT', {
      message: 'Storage key must be a non-empty string',
      details: { field: 'key', extensionId },
    });
  }
  const encoded = encodeJson(value);
  if (encoded === null) {
    throw new EngineError('INVALID_ARGUMENT', {
      message: 'Storage value must be JSON',
      details: { field: 'value', extensionId },
    });
  }
  const bytes = utf8Length(encoded);
  const violation = findStorageViolation(key, bytes, snapshot(), limits);
  if (violation !== null) {
    throw new EngineError('EXTENSION_STORAGE_QUOTA', {
      message: `Extension storage quota exceeded (${violation.kind}: limit ${violation.limit})`,
      details: { extensionId, kind: violation.kind, limit: violation.limit },
    });
  }
  return { encoded, bytes };
};
