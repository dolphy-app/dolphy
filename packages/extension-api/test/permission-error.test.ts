import { describe, expect, it } from 'vitest';
import { PermissionError } from '../src/index.ts';

describe('PermissionError', () => {
  it('carries the permission and a stable code; the default message names the permission', () => {
    const error = new PermissionError('library.read');
    expect(error).toBeInstanceOf(Error);
    expect(error.permission).toBe('library.read');
    expect(error.code).toBe('EXT_PERMISSION');
    expect(error.name).toBe('PermissionError');
    expect(error.message).toContain('library.read');
  });

  it('an explicit message replaces the default message', () => {
    expect(new PermissionError('network', 'nope').message).toBe('nope');
  });
});
