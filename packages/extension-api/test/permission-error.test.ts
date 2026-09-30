import { describe, expect, it } from 'vitest';
import { PermissionError } from '../src/index.ts';

describe('PermissionError', () => {
  it('несёт разрешение и стабильный код, сообщение по умолчанию называет разрешение', () => {
    const error = new PermissionError('library.read');
    expect(error).toBeInstanceOf(Error);
    expect(error.permission).toBe('library.read');
    expect(error.code).toBe('EXT_PERMISSION');
    expect(error.name).toBe('PermissionError');
    expect(error.message).toContain('library.read');
  });

  it('явное сообщение заменяет сообщение по умолчанию', () => {
    expect(new PermissionError('network', 'nope').message).toBe('nope');
  });
});
