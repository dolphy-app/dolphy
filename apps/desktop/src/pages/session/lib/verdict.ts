import type {
  ErrorReason,
  FailedReason,
  VerdictDto,
} from '@lms/engine-contract';

export interface VerdictView {
  type: 'success' | 'warning' | 'error';
  titleKey: string;
  reasonKey: string | null;
  /** Текст раннера: данные движка, не переводится. */
  feedback: string | null;
  retryable: boolean;
}

const FAILED_REASON_KEY: Record<FailedReason, string> = {
  mismatch: 'session.verdict.failedReason.mismatch',
  sql_error: 'session.verdict.failedReason.sql_error',
  forbidden: 'session.verdict.failedReason.forbidden',
  row_limit: 'session.verdict.failedReason.row_limit',
  byte_limit: 'session.verdict.failedReason.byte_limit',
  sqlite_limit: 'session.verdict.failedReason.sqlite_limit',
};

const ERROR_REASON_KEY: Record<ErrorReason, string> = {
  fixture_error: 'session.verdict.errorReason.fixture_error',
  expected_error: 'session.verdict.errorReason.expected_error',
  internal: 'session.verdict.errorReason.internal',
  timeout: 'session.verdict.errorReason.timeout',
  resource_kill: 'session.verdict.errorReason.resource_kill',
  worker_crash: 'session.verdict.errorReason.worker_crash',
};

export const describeVerdict = (verdict: VerdictDto): VerdictView => {
  switch (verdict.outcome) {
    case 'passed':
      return {
        type: 'success',
        titleKey: 'session.verdict.passed',
        reasonKey: null,
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    case 'failed':
      return {
        type: 'warning',
        titleKey: 'session.verdict.failed',
        reasonKey: FAILED_REASON_KEY[verdict.reason],
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    default:
      return {
        type: 'error',
        titleKey: 'session.verdict.error',
        reasonKey: ERROR_REASON_KEY[verdict.reason],
        feedback: null,
        retryable: true,
      };
  }
};
