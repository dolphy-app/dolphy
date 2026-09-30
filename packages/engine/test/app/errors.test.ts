import { createCapturingLogger } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { ERRORS, EngineError, createErrorMapper } from '../../src/app/index.ts';

describe('EngineError', () => {
  it('has all 25 codes (API §8 and repositories) with the documented default retryable', () => {
    expect(Object.keys(ERRORS)).toHaveLength(25);
    const retryable = Object.entries(ERRORS)
      .filter(([, spec]) => spec.retryable)
      .map(([code]) => code)
      .sort();
    expect(retryable).toEqual([
      'ENGINE_CLOSED',
      'INTERNAL',
      'STORE_BUSY',
      'VERIFIER_TIMEOUT',
      'VERIFIER_UNAVAILABLE',
    ]);
  });

  it('GIT_FETCH_FAILED is retryable only for network, timeout and cancellation', () => {
    const retryable = (reason: string) =>
      new EngineError('GIT_FETCH_FAILED', { details: { reason } }).retryable;
    expect(['network', 'timeout', 'cancelled'].map(retryable)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      ['not-found', 'auth-required', 'ref-not-found', 'too-large'].map(
        retryable,
      ),
    ).toEqual([false, false, false, false]);
  });

  it('VERIFIER_UNAVAILABLE is not retryable without a runner', () => {
    const noRunner = new EngineError('VERIFIER_UNAVAILABLE', {
      details: { cause: 'no-runner', runner: 'sql' },
    });
    const notStarted = new EngineError('VERIFIER_UNAVAILABLE', {
      details: { cause: 'pool-stopped' },
    });
    expect(noRunner.retryable).toBe(false);
    expect(notStarted.retryable).toBe(true);
  });

  it('toDto carries code, message, retryable and details only when set', () => {
    expect(new EngineError('NOT_FOUND').toDto()).toEqual({
      code: 'NOT_FOUND',
      message: 'Not found',
      retryable: false,
    });
    const dto = new EngineError('NOT_FOUND', {
      details: { id: 'x' },
      cause: new Error('secret'),
    }).toDto();
    expect(dto).toEqual({
      code: 'NOT_FOUND',
      message: 'Not found',
      retryable: false,
      details: { id: 'x' },
    });
    expect(JSON.stringify(dto)).not.toContain('secret');
  });
});

describe('createErrorMapper', () => {
  it('passes operational errors through untouched', () => {
    const { logger, records } = createCapturingLogger();
    let dirty = false;
    const map = createErrorMapper({
      logger,
      markDirty: () => {
        dirty = true;
      },
    });
    const error = new EngineError('NOT_FOUND');
    expect(map(error, 'x.y')).toBe(error);
    expect(dirty).toBe(false);
    expect(records).toEqual([]);
  });

  it('turns a programming error into INTERNAL, logs it and marks dirty', () => {
    const { logger, records } = createCapturingLogger();
    let dirty = false;
    const map = createErrorMapper({
      logger,
      markDirty: () => {
        dirty = true;
      },
    });
    const bug = new TypeError('boom');
    const mapped = map(bug, 'practice.getBatch');
    expect(mapped.code).toBe('INTERNAL');
    expect(mapped.cause).toBe(bug);
    expect(mapped.details).toEqual({ path: 'practice.getBatch' });
    expect(dirty).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('error');
  });
});
