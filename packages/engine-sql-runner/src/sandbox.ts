/**
 * Песочница проверки: новая `:memory:` БД из фикстуры, затем защита (порядок:
 * фикстура → read-only хэндл → `PRAGMA` → `query_only` → limits → defensive →
 * authorizer). Ответ ученика исполняется только после этого.
 */
import {
  loadBetterSqlite3,
  loadNodeSqlite,
  type BetterDb,
  type NodeSqliteDb,
} from './drivers.ts';
import type { DriverId, HardeningOptions, Row } from './types.ts';

/** Функции, которые authorizer запрещает, даже внутри SELECT. */
const DENIED_FUNCTIONS: Record<string, true> = {
  load_extension: true,
  readfile: true,
  writefile: true,
  edit: true,
  fts3_tokenizer: true,
  zipfile: true,
  sqlar_compress: true,
  sqlar_uncompress: true,
};

export interface SandboxStatement {
  columns(): string[];
  /** Строки как массивы канонических ячеек (INTEGER — `bigint`). */
  iterate(): IterableIterator<Row>;
}

export interface Sandbox {
  driver: DriverId;
  /** Драйверный хэндл: только для батареи и тестов. */
  raw: unknown;
  /** Механизмы защиты, применённые на самом деле. */
  applied: string[];
  /** Запрошены, но недоступны в этом драйвере/рантайме. */
  unavailable: string[];
  prepare(sql: string): SandboxStatement;
  exec(sql: string): void;
  close(): void;
}

/** Ошибка фикстуры — баг курса, не вина ученика. */
export class FixtureError extends Error {}

/** Оператор ученика не возвращает данные (`WITH … DELETE` без `RETURNING`). */
export class NotReaderError extends Error {
  constructor() {
    super('statement does not return data');
  }
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const openNodeSqlite = (hardening: HardeningOptions): NodeSqliteDb => {
  const sqlite = loadNodeSqlite();
  if (sqlite === null) throw new Error('node:sqlite is not available');
  // `defensive` в конструкторе на Node 22 молча игнорируется: применённое
  // фиксируется отдельно через enableDefensive
  return new sqlite.DatabaseSync(':memory:', {
    allowExtension: false,
    defensive: hardening.defensive,
  });
};

const closeQuietly = (db: { close(): void }) => {
  try {
    db.close();
  } catch {
    // закрытие уже закрытого хэндла
  }
};

const applyNodeSqlite = (
  db: NodeSqliteDb,
  hardening: HardeningOptions,
  applied: string[],
  unavailable: string[],
) => {
  const wantsLimits =
    hardening.lengthLimit !== null || hardening.sqlLengthLimit !== null;
  if (wantsLimits) {
    if (db.limits !== undefined) {
      if (hardening.lengthLimit !== null) {
        db.limits.length = hardening.lengthLimit;
      }
      if (hardening.sqlLengthLimit !== null) {
        db.limits.sqlLength = hardening.sqlLengthLimit;
      }
      applied.push('limits');
    } else unavailable.push('limits');
  }
  if (hardening.defensive) {
    if (typeof db.enableDefensive === 'function') {
      db.enableDefensive(true);
      applied.push('defensive');
    } else unavailable.push('defensive');
  }
  if (!hardening.authorizer) return;
  const sqlite = loadNodeSqlite();
  if (typeof db.setAuthorizer !== 'function' || sqlite === null) {
    unavailable.push('authorizer');
    return;
  }
  const { constants } = sqlite;
  const OK = constants.SQLITE_OK as number;
  const DENY = constants.SQLITE_DENY as number;
  const hidden = new Set(
    (hardening.hiddenTables ?? []).map((table) => table.toLowerCase()),
  );
  db.setAuthorizer((code, arg1, arg2) => {
    if (
      code === constants.SQLITE_SELECT ||
      code === constants.SQLITE_RECURSIVE
    ) {
      return OK;
    }
    if (code === constants.SQLITE_READ) {
      return arg1 !== null && hidden.has(arg1.toLowerCase()) ? DENY : OK;
    }
    if (code === constants.SQLITE_FUNCTION) {
      const name = arg2?.toLowerCase();
      return name !== undefined && Object.hasOwn(DENIED_FUNCTIONS, name)
        ? DENY
        : OK;
    }
    return DENY;
  });
  applied.push('authorizer');
};

const openNodeSqliteSandbox = (
  fixtureSql: string,
  hardening: HardeningOptions,
): Sandbox => {
  const db = openNodeSqlite(hardening);
  try {
    db.exec(fixtureSql);
  } catch (error) {
    closeQuietly(db);
    throw new FixtureError(messageOf(error));
  }
  const applied: string[] = [];
  const unavailable: string[] = [];
  if (hardening.readonlyHandle) unavailable.push('readonlyHandle');
  for (const pragma of hardening.pragmas ?? []) db.exec(`PRAGMA ${pragma}`);
  if (hardening.queryOnly) {
    db.exec('PRAGMA query_only=ON');
    applied.push('queryOnly');
  }
  applyNodeSqlite(db, hardening, applied, unavailable);
  return {
    driver: 'node-sqlite',
    raw: db,
    applied,
    unavailable,
    exec: (sql) => db.exec(sql),
    close: () => closeQuietly(db),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      return {
        columns: () => statement.columns().map(({ name }) => name),
        iterate: () => statement.iterate() as IterableIterator<Row>,
      };
    },
  };
};

const openBetterSandbox = (
  fixtureSql: string,
  hardening: HardeningOptions,
): Sandbox => {
  const Database = loadBetterSqlite3();
  if (Database === null) throw new Error('better-sqlite3 is not installed');
  let db: BetterDb = new Database(':memory:');
  try {
    db.exec(fixtureSql);
  } catch (error) {
    closeQuietly(db);
    throw new FixtureError(messageOf(error));
  }
  const applied: string[] = [];
  const unavailable: string[] = [];
  if (hardening.readonlyHandle) {
    // :memory: нельзя открыть readonly: копия через serialize()
    const image = db.serialize();
    db.close();
    db = new Database(image, { readonly: true });
    applied.push('readonlyHandle');
  }
  for (const pragma of hardening.pragmas ?? []) db.exec(`PRAGMA ${pragma}`);
  if (hardening.queryOnly) {
    db.exec('PRAGMA query_only=ON');
    applied.push('queryOnly');
  }
  if (hardening.defensive) unavailable.push('defensive');
  if (hardening.authorizer) unavailable.push('authorizer');
  if (hardening.lengthLimit !== null) unavailable.push('limits');
  const handle = db;
  return {
    driver: 'better-sqlite3',
    raw: handle,
    applied,
    unavailable,
    exec: (sql) => void handle.exec(sql),
    close: () => closeQuietly(handle),
    prepare: (sql) => {
      const statement = handle.prepare(sql);
      if (!statement.reader) throw new NotReaderError();
      statement.safeIntegers(true);
      statement.raw(true);
      return {
        columns: () => statement.columns().map(({ name }) => name),
        iterate: () => statement.iterate(),
      };
    },
  };
};

export const openSandbox = (
  driver: DriverId,
  fixtureSql: string,
  hardening: HardeningOptions,
): Sandbox =>
  driver === 'node-sqlite'
    ? openNodeSqliteSandbox(fixtureSql, hardening)
    : openBetterSandbox(fixtureSql, hardening);
