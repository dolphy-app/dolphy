/**
 * `createSqlVerifier` — проверка SQL-ответа поверх пула дочерних процессов
 * (используется расширением `spirula.sql`). Читает фикстуру и ожидаемый CSV из библиотеки
 * (`CourseSource`), кэширует их по отпечатку `stat`, режет ответ по
 * `MAX_SQL_CHARS` до IPC и переводит вердикт раннера в `GradeResult`.
 *
 * `failed` — вина ученика (событие пишет `completeAttempt`); `error` — баг
 * курса или среды: журнал не затрагивается, повтор разрешён.
 */
import type { CourseSource } from '@spirula/engine/ports';
import type { GradeResult } from '@spirula/extension-api';
import { createPool } from './pool.ts';
import type { PoolOptions, PoolStats, RunnerPool } from './pool.ts';
import { DEFAULT_LIMITS, MAX_SQL_CHARS } from './types.ts';
import type { CheckRequest, ReadyInfo, Verdict } from './types.ts';
import {
  CourseFileError,
  createTextCache,
  parseSpec,
} from './verification-params.ts';

export interface SqlVerifierOptions extends PoolOptions {
  /** Корень библиотеки: откуда читаются `fixture` и `expected`. */
  source: Pick<CourseSource, 'readText' | 'stat'>;
  /** Лимиты по умолчанию; `timeoutMs` берётся из запроса. */
  maxRows?: number;
  maxBytes?: number;
}

export interface SqlCheckInput {
  spec: unknown;
  answer: unknown;
  timeoutMs: number;
  authorMode: boolean;
}

export interface SqlVerifier {
  check(input: SqlCheckInput): Promise<GradeResult>;
  close(): Promise<void>;
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
const toRawVerdict = (verdict: Verdict, authorMode: boolean): GradeResult => {
  const { status, code, reason, rowCount, detail } = verdict;
  if (status === 'passed') {
    return { outcome: 'passed', data: { rowCount } };
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
      ...extra,
      ...(authorMode && detail !== undefined ? { detail } : {}),
    };
  }
  return {
    outcome: 'error',
    reason: code,
    ...extra,
  };
};

const errorVerdict = (
  reason: string,
  feedback: string,
  authorMode: boolean,
): GradeResult => ({
  outcome: 'error',
  reason,
  ...(authorMode ? { feedback } : {}),
});

export const createSqlVerifier = (options: SqlVerifierOptions): SqlVerifier => {
  const { source, maxRows, maxBytes, ...poolOptions } = options;
  const pool: RunnerPool = createPool(poolOptions);
  const files = createTextCache(source);
  const defaultMaxRows = maxRows ?? DEFAULT_LIMITS.maxRows;
  const defaultMaxBytes = maxBytes ?? DEFAULT_LIMITS.maxBytes;

  const check = async (input: SqlCheckInput): Promise<GradeResult> => {
    const { authorMode } = input;
    const parsed = parseSpec(input.spec);
    if (!parsed.ok) {
      return errorVerdict(parsed.code, parsed.message, authorMode);
    }
    const { params } = parsed;
    if (typeof input.answer !== 'string') {
      return errorVerdict('internal', 'answer is not a string', authorMode);
    }
    const learnerSql = input.answer;
    // кап до IPC: 50 МБ через канал дают 95 мс лага event loop хоста
    if (learnerSql.length > MAX_SQL_CHARS) {
      return {
        outcome: 'failed',
        reason: 'sqlite_limit',
        feedback: `SQL longer than ${MAX_SQL_CHARS} characters`,
      };
    }
    let fixtureSql: string;
    try {
      fixtureSql = await files.read(params.fixture);
    } catch (error) {
      if (!(error instanceof CourseFileError)) throw error;
      return errorVerdict('fixture_error', error.message, authorMode);
    }
    let csv: string;
    try {
      csv = await files.read(params.expected);
    } catch (error) {
      if (!(error instanceof CourseFileError)) throw error;
      return errorVerdict('expected_error', error.message, authorMode);
    }
    const timeoutMs =
      Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
        ? input.timeoutMs
        : DEFAULT_LIMITS.timeoutMs;
    const message: CheckRequest = {
      fixtureSql,
      learnerSql,
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
    check,
    close: () => pool.close(),
    warm: () => pool.warm(),
    info: () => pool.info(),
    stats: () => pool.stats(),
    pids: () => pool.pids(),
  };
};
