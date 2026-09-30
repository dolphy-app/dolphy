import type { VerdictDto } from '@lms/engine-contract';

export interface VerdictView {
  type: 'success' | 'warning' | 'error';
  titleKey: string;
  /** Ключ перевода известной причины; `null` — причина расширения без перевода. */
  reasonKey: string | null;
  /** Причина как есть, если перевода нет (данные расширения, не переводятся). */
  reasonRaw: string | null;
  /** Текст расширения: данные движка, не переводится. */
  feedback: string | null;
  retryable: boolean;
}

const FAILED_REASON_KEY: Readonly<Record<string, string>> = {
  mismatch: 'session.verdict.failedReason.mismatch',
  sql_error: 'session.verdict.failedReason.sql_error',
  forbidden: 'session.verdict.failedReason.forbidden',
  row_limit: 'session.verdict.failedReason.row_limit',
  byte_limit: 'session.verdict.failedReason.byte_limit',
  sqlite_limit: 'session.verdict.failedReason.sqlite_limit',
};

const ERROR_REASON_KEY: Readonly<Record<string, string>> = {
  fixture_error: 'session.verdict.errorReason.fixture_error',
  expected_error: 'session.verdict.errorReason.expected_error',
  internal: 'session.verdict.errorReason.internal',
  timeout: 'session.verdict.errorReason.timeout',
  resource_kill: 'session.verdict.errorReason.resource_kill',
  worker_crash: 'session.verdict.errorReason.worker_crash',
};

const reasonOf = (keys: Readonly<Record<string, string>>, reason: string) => {
  const reasonKey = keys[reason] ?? null;
  return { reasonKey, reasonRaw: reasonKey === null ? reason : null };
};

export const describeVerdict = (verdict: VerdictDto): VerdictView => {
  switch (verdict.outcome) {
    case 'passed':
      return {
        type: 'success',
        titleKey: 'session.verdict.passed',
        reasonKey: null,
        reasonRaw: null,
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    case 'failed':
      return {
        type: 'warning',
        titleKey: 'session.verdict.failed',
        ...reasonOf(FAILED_REASON_KEY, verdict.reason),
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    default:
      return {
        type: 'error',
        titleKey: 'session.verdict.error',
        ...reasonOf(ERROR_REASON_KEY, verdict.reason),
        feedback: null,
        retryable: true,
      };
  }
};
