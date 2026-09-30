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
  mismatch: 'exercisePanel.verdict.failedReason.mismatch',
  sql_error: 'exercisePanel.verdict.failedReason.sql_error',
  forbidden: 'exercisePanel.verdict.failedReason.forbidden',
  row_limit: 'exercisePanel.verdict.failedReason.row_limit',
  byte_limit: 'exercisePanel.verdict.failedReason.byte_limit',
  sqlite_limit: 'exercisePanel.verdict.failedReason.sqlite_limit',
};

const ERROR_REASON_KEY: Record<ErrorReason, string> = {
  fixture_error: 'exercisePanel.verdict.errorReason.fixture_error',
  expected_error: 'exercisePanel.verdict.errorReason.expected_error',
  internal: 'exercisePanel.verdict.errorReason.internal',
  timeout: 'exercisePanel.verdict.errorReason.timeout',
  resource_kill: 'exercisePanel.verdict.errorReason.resource_kill',
  worker_crash: 'exercisePanel.verdict.errorReason.worker_crash',
};

export const describeVerdict = (verdict: VerdictDto): VerdictView => {
  switch (verdict.outcome) {
    case 'passed':
      return {
        type: 'success',
        titleKey: 'exercisePanel.verdict.passed',
        reasonKey: null,
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    case 'failed':
      return {
        type: 'warning',
        titleKey: 'exercisePanel.verdict.failed',
        reasonKey: FAILED_REASON_KEY[verdict.reason],
        feedback: verdict.feedback ?? null,
        retryable: false,
      };
    default:
      return {
        type: 'error',
        titleKey: 'exercisePanel.verdict.error',
        reasonKey: ERROR_REASON_KEY[verdict.reason],
        feedback: null,
        retryable: true,
      };
  }
};
