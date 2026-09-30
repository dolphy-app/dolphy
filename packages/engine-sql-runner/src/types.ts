/** Драйвер SQLite внутри раннера. */
export type DriverId = 'node-sqlite' | 'better-sqlite3';

/**
 * `full` — `node:sqlite` с `setAuthorizer` и `db.limits`: защита не зависит от
 * префильтра. `fallback` — `query_only`, read-only хэндл, префильтр и
 * обязательный наблюдатель RSS (Node 22, better-sqlite3).
 */
export type Profile = 'full' | 'fallback';

/** Каноническое значение ячейки: INTEGER — `bigint`, REAL — `number`, BLOB — `Uint8Array`. */
export type Cell = null | bigint | number | string | Uint8Array;
export type Row = Cell[];

export interface ResultSet {
  columns: string[];
  rows: Row[];
}

export interface CompareOptions {
  /** `false` (по умолчанию): строки сравниваются как мультимножество. */
  orderSensitive?: boolean;
  /** `|a − b| ≤ tol·max(1, |a|, |b|)`; по умолчанию `1e-9`, `0` — точно. */
  numericTolerance?: number;
  /** `true`: значения сравниваются по позициям, имена столбцов игнорируются. */
  ignoreColumnNames?: boolean;
  /** `strict` (по умолчанию): порядок столбцов обязателен; `any` — перестановка допустима. */
  columnOrder?: 'strict' | 'any';
}

export interface Limits {
  timeoutMs: number;
  maxRows: number;
  maxBytes: number;
  /** Длина ответа ученика в символах; выше — `failed/sqlite_limit` до любого разбора. */
  maxSqlChars: number;
}

export const MAX_SQL_CHARS = 100_000;

export const DEFAULT_LIMITS: Limits = {
  timeoutMs: 2000,
  maxRows: 10_000,
  maxBytes: 1_000_000,
  maxSqlChars: MAX_SQL_CHARS,
};

/** Ожидаемый результат; через IPC ходит только `csv` (JSON не несёт `bigint`). */
export type Expected = { csv: string } | { columns?: string[]; rows: Row[] };

export interface HardeningOptions {
  /** `PRAGMA query_only=ON` после загрузки фикстуры. */
  queryOnly: boolean;
  /** `node:sqlite` с `setAuthorizer`: белый список `SELECT/RECURSIVE/READ/FUNCTION`. */
  authorizer: boolean;
  /** `node:sqlite` ≥ 24: `enableDefensive`; на Node 22 опция молча игнорируется. */
  defensive: boolean;
  /** `db.limits.length` (Node ≥ 24.15); `null` — оставить 1e9. */
  lengthLimit: number | null;
  /** `db.limits.sqlLength` (Node ≥ 24.15). */
  sqlLengthLimit: number | null;
  /** better-sqlite3: `serialize()` → read-only хэндл. */
  readonlyHandle: boolean;
  /** Отвергнуть не-SELECT и несколько операторов до SQLite (сама по себе не защита). */
  prefilter: boolean;
  /** Дополнительные `PRAGMA` после фикстуры, до `query_only`. */
  pragmas?: string[];
  /** Таблицы, которые ученик не должен читать (только с authorizer). */
  hiddenTables?: string[];
}

export const FULL_HARDENING: HardeningOptions = {
  queryOnly: true,
  authorizer: true,
  defensive: true,
  lengthLimit: 1_000_000,
  sqlLengthLimit: MAX_SQL_CHARS,
  readonlyHandle: true,
  prefilter: true,
};

export interface CheckRequest {
  fixtureSql: string;
  learnerSql: string;
  expected: Expected;
  compare?: CompareOptions;
  limits?: Partial<Limits>;
  hardening?: Partial<HardeningOptions>;
  /** Отдавать в `detail` ожидаемые строки и тексты SQLite (режим автора). */
  revealExpected?: boolean;
}

export type FailedCode =
  | 'mismatch'
  | 'sql_error'
  | 'forbidden'
  | 'row_limit'
  | 'byte_limit'
  | 'sqlite_limit';

export type ErrorCode =
  | 'fixture_error'
  | 'expected_error'
  | 'timeout'
  | 'resource_kill'
  | 'worker_crash'
  | 'internal';

export type VerdictCode = 'ok' | FailedCode | ErrorCode;

/** Внутренний вердикт раннера; порт `Verifier` получает его как `RawVerdict`. */
export interface Verdict {
  status: 'passed' | 'failed' | 'error';
  code: VerdictCode;
  /** Наш текст (не текст SQLite). */
  reason: string;
  durationMs: number;
  rowCount: number;
  detail?: string;
}

/** Хост → раннер. */
export interface ToWorker {
  type: 'check';
  id: number;
  req: CheckRequest;
}

export interface ReadyInfo {
  driver: DriverId;
  profile: Profile;
}

/** Раннер → хост: `ready` один раз, затем `verdict` на каждый `check`. */
export type FromWorker =
  | ({ type: 'ready' } & ReadyInfo)
  | { type: 'verdict'; id: number; verdict: Verdict; rssKb: number };

export type DriverPreference = DriverId | 'auto';
