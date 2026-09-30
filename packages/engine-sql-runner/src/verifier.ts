/**
 * `createSqlVerifier` — порт `Verifier` (`runner: 'sql'`) поверх пула
 * дочерних процессов. Читает фикстуру и ожидаемый CSV из библиотеки
 * (`CourseSource`), кэширует их по отпечатку `stat`, режет ответ по
 * `MAX_SQL_CHARS` до IPC и переводит вердикт раннера в `RawVerdict`.
 *
 * `failed` — вина ученика (событие пишет `completeAttempt`); `error` — баг
 * курса или среды: журнал не затрагивается, повтор разрешён.
 */
import { MAX_SQL_CHARS } from '@lms/engine-contract';
import type {
  CourseSource,
  RawVerdict,
  Verifier,
  VerifyRequest,
} from '@lms/engine/ports';
import { createPool } from './pool.ts';
import type { PoolOptions, PoolStats, RunnerPool } from './pool.ts';
import { DEFAULT_LIMITS } from './types.ts';
import type { CheckRequest, ReadyInfo, Verdict } from './types.ts';
import {
  CourseFileError,
  createTextCache,
  parseVerification,
} from './verification-params.ts';

export interface SqlVerifierOptions extends PoolOptions {
  /** Корень библиотеки: откуда читаются `fixture` и `expected`. */
  source: Pick<CourseSource, 'readText' | 'stat'>;
  /** Лимиты по умолчанию; `timeoutMs` берётся из запроса. */
  maxRows?: number;
  maxBytes?: number;
}

export interface SqlVerifier extends Verifier {
  readonly runner: 'sql';
  /** Поднять пул заранее (иначе процессы порождаются по требованию). */
  warm(): Promise<void>;
  /** Драйвер и профиль (`full` | `fallback`) раннера. */
  info(): Promise<ReadyInfo>;
  stats(): PoolStats;
  /** PID живых дочерних процессов. */
  pids(): number[];
}

const LEARNER_FEEDBACK: Record<string, string> = {
  sql_error: 'The query could not be executed.',
  forbidden: 'The query is not allowed: a single read-only SELECT is expected.',
};

/** Раннер → `RawVerdict`: тексты SQLite наружу только в режиме автора. */
const toRawVerdict = (verdict: Verdict, authorMode: boolean): RawVerdict => {
  const { status, code, reason, durationMs, rowCount, detail } = verdict;
  if (status === 'passed') {
    return { outcome: 'passed', durationMs, data: { rowCount } };
  }
  const learnerFeedback = LEARNER_FEEDBACK[code] ?? reason;
  let feedback: string | undefined;
  if (status === 'failed') feedback = learnerFeedback;
  else if (authorMode) feedback = reason;
  const extra = {
    ...(rowCount > 0 ? { data: { rowCount } } : {}),
    ...(feedback === undefined ? {} : { feedback }),
  };
  if (status === 'failed') {
    return {
      outcome: 'failed',
      reason: code,
      durationMs,
      ...extra,
      ...(authorMode && detail !== undefined ? { detail } : {}),
    };
  }
  return {
    outcome: 'error',
    reason: code,
    durationMs,
    ...extra,
  };
};

const errorVerdict = (
  reason: string,
  feedback: string,
  authorMode: boolean,
  startedAt: number,
): RawVerdict => ({
  outcome: 'error',
  reason,
  durationMs: performance.now() - startedAt,
  ...(authorMode ? { feedback } : {}),
});

export const createSqlVerifier = (options: SqlVerifierOptions): SqlVerifier => {
  const { source, maxRows, maxBytes, ...poolOptions } = options;
  const pool: RunnerPool = createPool(poolOptions);
  const files = createTextCache(source);
  const defaultMaxRows = maxRows ?? DEFAULT_LIMITS.maxRows;
  const defaultMaxBytes = maxBytes ?? DEFAULT_LIMITS.maxBytes;

  const check = async (request: VerifyRequest): Promise<RawVerdict> => {
    const startedAt = performance.now();
    const { exercise, submission, authorMode } = request;
    const verification = exercise.engine?.verification;
    if (verification?.runner !== 'sql') {
      return errorVerdict(
        'internal',
        'exercise is not verified by the sql runner',
        authorMode,
        startedAt,
      );
    }
    const parsed = parseVerification(verification);
    if (!parsed.ok) {
      return errorVerdict(parsed.code, parsed.message, authorMode, startedAt);
    }
    const { params } = parsed;
    if (submission.kind !== 'sql') {
      return errorVerdict(
        'internal',
        `submission kind '${submission.kind}' is not sql`,
        authorMode,
        startedAt,
      );
    }
    // кап до IPC: 50 МБ через канал дают 95 мс лага event loop хоста
    if (submission.sql.length > MAX_SQL_CHARS) {
      return {
        outcome: 'failed',
        reason: 'sqlite_limit',
        durationMs: performance.now() - startedAt,
        feedback: `SQL longer than ${MAX_SQL_CHARS} characters`,
      };
    }
    let fixtureSql: string;
    try {
      fixtureSql = await files.read(params.fixture);
    } catch (error) {
      if (!(error instanceof CourseFileError)) throw error;
      return errorVerdict(
        'fixture_error',
        error.message,
        authorMode,
        startedAt,
      );
    }
    let csv: string;
    try {
      csv = await files.read(params.expected);
    } catch (error) {
      if (!(error instanceof CourseFileError)) throw error;
      return errorVerdict(
        'expected_error',
        error.message,
        authorMode,
        startedAt,
      );
    }
    const timeoutMs =
      Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
        ? request.timeoutMs
        : DEFAULT_LIMITS.timeoutMs;
    const message: CheckRequest = {
      fixtureSql,
      learnerSql: submission.sql,
      expected: { csv },
      compare: params.compare,
      limits: {
        timeoutMs,
        maxRows: params.maxRows ?? defaultMaxRows,
        maxBytes: params.maxBytes ?? defaultMaxBytes,
        maxSqlChars: MAX_SQL_CHARS,
      },
      revealExpected: authorMode,
    };
    const { verdict } = await pool.run(message);
    return toRawVerdict(verdict, authorMode);
  };

  return {
    runner: 'sql',
    check,
    close: () => pool.close(),
    warm: () => pool.warm(),
    info: () => pool.info(),
    stats: () => pool.stats(),
    pids: () => pool.pids(),
  };
};
