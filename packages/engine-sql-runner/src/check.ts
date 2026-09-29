/**
 * Одна проверка в процессе-раннере: фикстура → песочница → ответ ученика →
 * сравнение. Синхронная; жёсткий таймаут — забота хоста (kill процесса).
 */
import { compareResults, expectedToResultSet } from './compare.ts';
import { prefilter } from './prefilter.ts';
import {
  FixtureError,
  NotReaderError,
  openSandbox,
  type Sandbox,
} from './sandbox.ts';
import {
  DEFAULT_LIMITS,
  FULL_HARDENING,
  type Cell,
  type CheckRequest,
  type DriverId,
  type FailedCode,
  type HardeningOptions,
  type Limits,
  type ResultSet,
  type Row,
  type Verdict,
  type VerdictCode,
} from './types.ts';

/** Прерывание итерации по лимиту (строки, байты, кооперативный дедлайн). */
class LimitAbort extends Error {
  readonly code: 'row_limit' | 'byte_limit' | 'timeout';
  constructor(code: LimitAbort['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Код ошибки SQLite: `errcode` у `node:sqlite`, `code` у better-sqlite3. */
const SQLITE_READONLY = 8;
const SQLITE_TOOBIG = 18;
const SQLITE_AUTH = 23;
const SQLITE_NOMEM = 7;

const NAMED_CODES: Record<string, FailedCode> = {
  SQLITE_AUTH: 'forbidden',
  SQLITE_READONLY: 'forbidden',
  SQLITE_TOOBIG: 'sqlite_limit',
  SQLITE_NOMEM: 'sqlite_limit',
};
const NUMERIC_CODES: Record<number, FailedCode> = {
  [SQLITE_AUTH]: 'forbidden',
  [SQLITE_READONLY]: 'forbidden',
  [SQLITE_TOOBIG]: 'sqlite_limit',
  [SQLITE_NOMEM]: 'sqlite_limit',
};

const FORBIDDEN_RE =
  /not authorized|authorization denied|readonly database|read-only|more than one statement|only execute one statement|attempt to write|cannot .* in a|extension/iu;
const LIMIT_RE =
  /too big|too long|too large|string or blob|SQL statement too long|too many|expression tree is too large/iu;

const codeOfError = (error: unknown): FailedCode | null => {
  if (typeof error !== 'object' || error === null) return null;
  const { code, errcode } = error as { code?: unknown; errcode?: unknown };
  if (typeof code === 'string' && Object.hasOwn(NAMED_CODES, code)) {
    return NAMED_CODES[code] as FailedCode;
  }
  if (typeof errcode === 'number') {
    // расширенные коды: младший байт — основной
    const primary = errcode & 0xff;
    if (Object.hasOwn(NUMERIC_CODES, primary)) {
      return NUMERIC_CODES[primary] as FailedCode;
    }
  }
  return null;
};

/** По коду SQLite, затем по тексту: тексты различаются между драйверами и версиями. */
const classify = (error: unknown): { code: FailedCode; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof NotReaderError) return { code: 'forbidden', message };
  const byCode = codeOfError(error);
  if (byCode !== null) return { code: byCode, message };
  if (FORBIDDEN_RE.test(message)) return { code: 'forbidden', message };
  if (LIMIT_RE.test(message)) return { code: 'sqlite_limit', message };
  return { code: 'sql_error', message };
};

const cellBytes = (cell: Cell): number => {
  if (cell === null) return 1;
  if (typeof cell === 'string') return Buffer.byteLength(cell);
  if (cell instanceof Uint8Array) return cell.byteLength;
  return 8;
};

const DEADLINE_STRIDE_MASK = 255;

interface Collected {
  columns: string[];
  rows: Row[];
}

const collect = (
  statementSql: string,
  sandbox: Sandbox,
  limits: Limits,
  deadline: number,
): Collected => {
  const statement = sandbox.prepare(statementSql);
  const columns = statement.columns();
  if (columns.length === 0) throw new NotReaderError();
  const rows: Row[] = [];
  let bytes = 0;
  for (const row of statement.iterate()) {
    if (rows.length >= limits.maxRows) {
      throw new LimitAbort('row_limit', `more than ${limits.maxRows} rows`);
    }
    for (const cell of row) bytes += cellBytes(cell);
    if (bytes > limits.maxBytes) {
      throw new LimitAbort(
        'byte_limit',
        `result larger than ${limits.maxBytes} bytes`,
      );
    }
    rows.push(row);
    // кооперативный дедлайн помогает только запросу, который отдаёт строки
    if (
      (rows.length & DEADLINE_STRIDE_MASK) === 0 &&
      performance.now() > deadline
    ) {
      throw new LimitAbort('timeout', 'cooperative deadline exceeded');
    }
  }
  return { columns, rows };
};

export const runCheck = (request: CheckRequest, driver: DriverId): Verdict => {
  const started = performance.now();
  const limits: Limits = { ...DEFAULT_LIMITS, ...request.limits };
  const hardening: HardeningOptions = {
    ...FULL_HARDENING,
    ...request.hardening,
  };
  const done = (
    status: Verdict['status'],
    code: VerdictCode,
    reason: string,
    rowCount = 0,
    detail?: string,
  ): Verdict => ({
    status,
    code,
    reason,
    durationMs: performance.now() - started,
    rowCount,
    ...(detail === undefined ? {} : { detail }),
  });
  const reveal = (detail: string) =>
    request.revealExpected === true ? detail : undefined;

  let expected: ResultSet;
  try {
    expected = expectedToResultSet(request.expected);
  } catch (error) {
    return done(
      'error',
      'expected_error',
      'expected result cannot be parsed',
      0,
      reveal(error instanceof Error ? error.message : String(error)),
    );
  }
  if (request.learnerSql.length > limits.maxSqlChars) {
    return done(
      'failed',
      'sqlite_limit',
      `SQL longer than ${limits.maxSqlChars} characters`,
    );
  }
  if (hardening.prefilter) {
    const outcome = prefilter(request.learnerSql, limits.maxSqlChars);
    if (!outcome.ok) {
      const code =
        outcome.code === 'sql_too_long'
          ? 'sqlite_limit'
          : (outcome.code ?? 'forbidden');
      return done('failed', code, outcome.reason ?? 'rejected');
    }
  }
  let sandbox: Sandbox;
  try {
    sandbox = openSandbox(driver, request.fixtureSql, hardening);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof FixtureError) {
      return done(
        'error',
        'fixture_error',
        'fixture cannot be loaded',
        0,
        reveal(message),
      );
    }
    return done(
      'error',
      'internal',
      'sandbox cannot be opened',
      0,
      reveal(message),
    );
  }
  try {
    let collected: Collected;
    try {
      collected = collect(
        request.learnerSql,
        sandbox,
        limits,
        started + limits.timeoutMs,
      );
    } catch (error) {
      if (error instanceof LimitAbort) {
        return done(
          error.code === 'timeout' ? 'error' : 'failed',
          error.code,
          error.message,
        );
      }
      const { code, message } = classify(error);
      return done(
        'failed',
        code,
        `query rejected: ${code}`,
        0,
        reveal(message),
      );
    }
    const outcome = compareResults(collected, expected, request.compare ?? {});
    if (outcome.equal) return done('passed', 'ok', 'ok', collected.rows.length);
    return done(
      'failed',
      'mismatch',
      outcome.reason,
      collected.rows.length,
      reveal(outcome.detail),
    );
  } finally {
    sandbox.close();
  }
};
