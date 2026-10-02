import { describe, expect, it } from 'vitest';
import { EXTENSION_STORAGE_LIMITS, StorageQuotaError } from '../src/index.ts';

describe('StorageQuotaError', () => {
  it('carries the limit kind and its value; the default message names them', () => {
    const error = new StorageQuotaError('value-size', 65536);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'StorageQuotaError',
      code: 'EXT_STORAGE_QUOTA',
      kind: 'value-size',
      limit: 65536,
    });
    expect(error.message).toContain('value-size');
    expect(error.message).toContain('65536');
  });

  it('an explicit message replaces the default message', () => {
    expect(new StorageQuotaError('key-count', 256, 'full').message).toBe(
      'full',
    );
  });
});

describe('EXTENSION_STORAGE_LIMITS', () => {
  it('R2 limits are immutable', () => {
    expect(EXTENSION_STORAGE_LIMITS).toEqual({
      keyLength: 128,
      valueBytes: 65536,
      keys: 256,
      totalBytes: 1048576,
    });
    expect(Object.isFrozen(EXTENSION_STORAGE_LIMITS)).toBe(true);
  });
});
