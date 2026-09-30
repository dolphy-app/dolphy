import { EngineError } from '@spirula/engine/app';
import type { EngineErrorOptions } from '@spirula/engine/app';

type StoreCode = 'STORE_BUSY' | 'STORE_READONLY' | 'STORE_CORRUPT';

/** Первичный код SQLite (`SQLITE_BUSY_SNAPSHOT` → `SQLITE_BUSY`) → код движка. */
const STORE_CODES: readonly [string, StoreCode][] = [
  ['SQLITE_BUSY', 'STORE_BUSY'],
  ['SQLITE_LOCKED', 'STORE_BUSY'],
  ['SQLITE_READONLY', 'STORE_READONLY'],
  ['SQLITE_CORRUPT', 'STORE_CORRUPT'],
  ['SQLITE_NOTADB', 'STORE_CORRUPT'],
];

/**
 * Ошибка драйвера → `EngineError` (`STORE_*`); прочее (в том числе нарушение
 * схемы — баг вызывающего) возвращается как есть.
 */
export const mapSqliteError = (error: unknown): unknown => {
  if (error instanceof EngineError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return error;
  for (const [prefix, storeCode] of STORE_CODES) {
    if (code === prefix || code.startsWith(`${prefix}_`)) {
      const options: EngineErrorOptions = {
        cause: error,
        details: { sqliteCode: code },
      };
      return new EngineError(storeCode, options);
    }
  }
  return error;
};

/** Выполняет синхронную работу с драйвером, превращая ошибки SQLite в `STORE_*`. */
export const guard = <T>(work: () => T): T => {
  try {
    return work();
  } catch (error) {
    throw mapSqliteError(error);
  }
};
