import type { VerdictDto } from '@spirula/engine-contract';

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
  mismatch: 'exercisePanel.verdict.failedReason.mismatch',
  sql_error: 'exercisePanel.verdict.failedReason.sql_error',
  forbidden: 'exercisePanel.verdict.failedReason.forbidden',
  row_limit: 'exercisePanel.verdict.failedReason.row_limit',
  byte_limit: 'exercisePanel.verdict.failedReason.byte_limit',
  sqlite_limit: 'exercisePanel.verdict.failedReason.sqlite_limit',
  invalid_answer: 'exercisePanel.verdict.failedReason.invalid_answer',
};

const ERROR_REASON_KEY: Readonly<Record<string, string>> = {
  fixture_error: 'exercisePanel.verdict.errorReason.fixture_error',
  expected_error: 'exercisePanel.verdict.errorReason.expected_error',
  invalid_spec: 'exercisePanel.verdict.errorReason.invalid_spec',
  internal: 'exercisePanel.verdict.errorReason.internal',
  timeout: 'exercisePanel.verdict.errorReason.timeout',
  resource_kill: 'exercisePanel.verdict.errorReason.resource_kill',
  worker_crash: 'exercisePanel.verdict.errorReason.worker_crash',
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
        titleKey: 'exercisePanel.verdict.passed',
        reasonKey: null,
        reasonRaw: null,
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    case 'failed':
      return {
        type: 'warning',
        titleKey: 'exercisePanel.verdict.failed',
        ...reasonOf(FAILED_REASON_KEY, verdict.reason),
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    default:
      return {
        type: 'error',
        titleKey: 'exercisePanel.verdict.error',
        ...reasonOf(ERROR_REASON_KEY, verdict.reason),
        feedback: null,
        retryable: true,
      };
  }
};
