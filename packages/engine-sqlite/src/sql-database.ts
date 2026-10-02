import Database from 'better-sqlite3';

export type SqlParam = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, unknown>;

export interface SqlStatement<Row = SqlRow> {
  run(...params: SqlParam[]): { changes: number };
  get(...params: SqlParam[]): Row | undefined;
  all(...params: SqlParam[]): Row[];
  iterate(...params: SqlParam[]): IterableIterator<Row>;
}

/**
 * Узкий синхронный порт SQL-драйвера: хранилище журнала
 * не знает про better-sqlite3, и замена на `node:sqlite` затрагивает только
 * адаптер. Строки — обычные объекты, epoch-ms и `seq` — `INTEGER` ≤ 2^53.
 */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare<Row = SqlRow>(sql: string): SqlStatement<Row>;
  /** `BEGIN IMMEDIATE` … `COMMIT`; исключение — `ROLLBACK`. */
  transaction<T>(work: () => T): T;
  /** Значение первого столбца первой строки: `pragma('user_version')`. */
  pragma(statement: string): unknown;
  close(): void;
}

export interface OpenDatabaseOptions {
  path: string;
  readOnly?: boolean;
  /** Ожидание блокировки писателя до `SQLITE_BUSY`, мс. */
  busyTimeoutMs?: number;
}

export const openBetterSqliteDatabase = ({
  path,
  readOnly = false,
  busyTimeoutMs,
}: OpenDatabaseOptions): SqlDatabase => {
  const db = new Database(path, {
    readonly: readOnly,
    ...(busyTimeoutMs !== undefined && { timeout: busyTimeoutMs }),
  });
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: <Row>(sql: string): SqlStatement<Row> => {
      const statement = db.prepare<SqlParam[], Row>(sql);
      return {
        run: (...params) => statement.run(...params),
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params),
        iterate: (...params) => statement.iterate(...params),
      };
    },
    transaction: (work) => db.transaction(work).immediate(),
    pragma: (statement) => db.pragma(statement, { simple: true }),
    close: () => {
      db.close();
    },
  };
};
