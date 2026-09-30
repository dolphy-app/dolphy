import { describe, expect, it } from 'vitest';
import type { VerdictDto } from '@spirula-app/engine-contract';
import { describeVerdict } from '@/widgets/exercise-panel/lib/verdict.ts';

const verdict = (dto: Record<string, unknown>) => dto as unknown as VerdictDto;

describe('describeVerdict', () => {
  it('maps passed to success without a reason', () => {
    expect(describeVerdict(verdict({ outcome: 'passed' }))).toEqual({
      type: 'success',
      titleKey: 'exercisePanel.verdict.passed',
      reasonKey: null,
      reasonRaw: null,
      feedback: null,
      retryable: false,
    });
  });

  it.each([
    'mismatch',
    'sql_error',
    'forbidden',
    'row_limit',
    'byte_limit',
    'sqlite_limit',
  ])('maps failed/%s to a warning with its reason key', (reason) => {
    const view = describeVerdict(verdict({ outcome: 'failed', reason }));
    expect(view.type).toBe('warning');
    expect(view.titleKey).toBe('exercisePanel.verdict.failed');
    expect(view.reasonKey).toBe(`exercisePanel.verdict.failedReason.${reason}`);
    expect(view.retryable).toBe(false);
  });

  it.each([
    'fixture_error',
    'expected_error',
    'internal',
    'timeout',
    'resource_kill',
    'worker_crash',
  ])('maps error/%s to a retryable error', (reason) => {
    const view = describeVerdict(verdict({ outcome: 'error', reason }));
    expect(view.type).toBe('error');
    expect(view.titleKey).toBe('exercisePanel.verdict.error');
    expect(view.reasonKey).toBe(`exercisePanel.verdict.errorReason.${reason}`);
    expect(view.retryable).toBe(true);
  });

  it('passes runner feedback through for passed and failed', () => {
    expect(
      describeVerdict(verdict({ outcome: 'passed', feedback: 'fb' })).feedback,
    ).toBe('fb');
    const failed = describeVerdict(
      verdict({ outcome: 'failed', reason: 'mismatch', feedback: 'fb' }),
    );
    expect(failed.feedback).toBe('fb');
    expect(failed.reasonKey).toBe(
      'exercisePanel.verdict.failedReason.mismatch',
    );
  });

  it('keeps the raw reason when the extension reason has no translation', () => {
    const failed = describeVerdict(
      verdict({ outcome: 'failed', reason: 'acme_custom' }),
    );
    expect(failed.reasonKey).toBeNull();
    expect(failed.reasonRaw).toBe('acme_custom');
    const error = describeVerdict(
      verdict({ outcome: 'error', reason: 'acme_broken' }),
    );
    expect(error.reasonKey).toBeNull();
    expect(error.reasonRaw).toBe('acme_broken');
    expect(error.retryable).toBe(true);
  });
});
