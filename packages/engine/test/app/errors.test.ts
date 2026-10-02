import { createCapturingLogger } from '@dolphy-app/testkit';
import { describe, expect, it } from 'vitest';
import { ERRORS, EngineError, createErrorMapper } from '../../src/app/index.ts';

describe('EngineError', () => {
  it('has all 27 codes (API §8, repositories and extensions) with the documented default retryable', () => {
    expect(Object.keys(ERRORS)).toHaveLength(27);
    const retryable = Object.entries(ERRORS)
      .filter(([, spec]) => spec.retryable)
      .map(([code]) => code)
      .sort();
    expect(retryable).toEqual([
      'CATALOG_UNAVAILABLE',
      'ENGINE_CLOSED',
      'EXERCISE_TYPE_UNAVAILABLE',
      'INTERNAL',
      'STORE_BUSY',
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

  it('EXTENSION_INSTALL_FAILED is retryable only for network failures', () => {
    const retryable = (reason: string) =>
      new EngineError('EXTENSION_INSTALL_FAILED', { details: { reason } })
        .retryable;
    expect(retryable('network')).toBe(true);
    expect(
      ['incompatible', 'integrity', 'limits', 'invalid', 'conflict'].map(
        retryable,
      ),
    ).toEqual([false, false, false, false, false]);
  });

  it('EXERCISE_TYPE_UNAVAILABLE is not retryable for an unknown type', () => {
    const unknown = new EngineError('EXERCISE_TYPE_UNAVAILABLE', {
      details: { cause: 'unknown-type', type: 'x.y' },
    });
    const hostDown = new EngineError('EXERCISE_TYPE_UNAVAILABLE', {
      details: { cause: 'host-down' },
    });
    expect(unknown.retryable).toBe(false);
    expect(hostDown.retryable).toBe(true);
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
