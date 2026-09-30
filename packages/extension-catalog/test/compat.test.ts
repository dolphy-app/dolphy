import { describe, expect, it } from 'vitest';
import { checkCompatibility, parseInstallMeta } from '../src/index.ts';

describe('checkCompatibility', () => {
  const ctx = { appVersion: '1.5.0', platform: 'darwin' };

  it('совместимо', () => {
    expect(
      checkCompatibility({ minAppVersion: '1.5.0', platforms: [] }, ctx),
    ).toBeNull();
    expect(
      checkCompatibility({ minAppVersion: null, platforms: ['darwin'] }, ctx),
    ).toBeNull();
  });

  it('версия приложения неизвестна — не проверяется', () => {
    expect(
      checkCompatibility(
        { minAppVersion: '99.0.0', platforms: [] },
        { ...ctx, appVersion: undefined },
      ),
    ).toBeNull();
  });

  it('тексты причин совпадают со спекой', () => {
    expect(
      checkCompatibility({ minAppVersion: '2.0.0', platforms: [] }, ctx),
    ).toEqual({ reason: 'app', detail: 'requires app >= 2.0.0' });
    expect(
      checkCompatibility({ minAppVersion: null, platforms: ['linux'] }, ctx),
    ).toEqual({ reason: 'platform', detail: 'not available on darwin' });
  });
});

describe('parseInstallMeta', () => {
  const meta = {
    catalogUrl: 'https://example.github.io/index.json',
    version: '1.0.0',
    installedAt: '2026-10-01T12:00:00Z',
  };

  it('принимает корректные метаданные', () => {
    expect(parseInstallMeta(meta).version).toBe('1.0.0');
  });

  it.each([
    { catalogUrl: 'file:///etc/passwd' },
    { catalogUrl: 'javascript:alert(1)' },
    { version: '01.0.0' },
    { extra: 1 },
  ])('отвергает %j', (patch) => {
    expect(() => parseInstallMeta({ ...meta, ...patch })).toThrow();
  });
});
