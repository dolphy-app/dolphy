import { describe, expect, it } from 'vitest';
import {
  deprecationFor,
  isRevoked,
  latestUpdate,
  resolveVersion,
} from '../src/index.ts';
import type { ResolveContext } from '../src/index.ts';
import { entry, version } from './fixtures.ts';

const context = (overrides: Partial<ResolveContext> = {}): ResolveContext => ({
  apiVersion: 1,
  appVersion: '1.5.0',
  platform: 'darwin',
  ...overrides,
});

const v = (number: string, overrides = {}) =>
  version({ version: number, ...overrides });

describe('resolveVersion', () => {
  it('побеждает новейшая версия', () => {
    const e = entry({ versions: [v('2.0.0'), v('1.0.0')] });
    expect(resolveVersion(e, context())).toMatchObject({
      ok: true,
      version: { version: '2.0.0' },
    });
  });

  it('minAppVersion новее приложения — откат на старую версию как fallback', () => {
    const e = entry({
      versions: [
        v('2.0.0', { minAppVersion: '1.6.0' }),
        v('1.0.0', { minAppVersion: '1.5.0' }),
      ],
    });
    const result = resolveVersion(e, context());
    expect(result).toMatchObject({
      ok: false,
      reason: 'app',
      detail: 'requires app >= 1.6.0',
      fallback: { version: '1.0.0' },
    });
  });

  it('minAppVersion равна версии приложения — подходит', () => {
    const e = entry({ versions: [v('1.0.0', { minAppVersion: '1.5.0' })] });
    expect(resolveVersion(e, context()).ok).toBe(true);
  });

  it('неизвестная версия приложения — проверка пропускается', () => {
    const e = entry({ versions: [v('1.0.0', { minAppVersion: '99.0.0' })] });
    expect(resolveVersion(e, context({ appVersion: undefined })).ok).toBe(true);
  });

  it('платформа: пустой список — любая; иначе уровень записи', () => {
    const e = entry({ platforms: ['linux'] });
    expect(resolveVersion(e, context({ platform: 'linux' })).ok).toBe(true);
    expect(resolveVersion(entry(), context({ platform: 'win32' })).ok).toBe(
      true,
    );
    expect(resolveVersion(e, context())).toEqual({
      ok: false,
      reason: 'platform',
      detail: 'not available on darwin',
      fallback: null,
    });
  });

  it('другая apiVersion', () => {
    const e = entry({ versions: [v('2.0.0', { apiVersion: 2 }), v('1.0.0')] });
    expect(resolveVersion(e, context())).toMatchObject({
      ok: false,
      reason: 'api',
      detail: 'requires extension API 2',
      fallback: { version: '1.0.0' },
    });
  });

  it('причина — по новейшей версии; совместимых нет — fallback null', () => {
    const e = entry({
      versions: [
        v('2.0.0', { minAppVersion: '3.0.0' }),
        v('1.0.0', { apiVersion: 2 }),
      ],
    });
    expect(resolveVersion(e, context())).toMatchObject({
      ok: false,
      reason: 'app',
      fallback: null,
    });
  });
});

describe('isRevoked', () => {
  const revoked = [
    { id: 'acme.a', versions: '<1.2.0', reason: 'bug' },
    { id: 'acme.b', versions: '>=1.0.0 <1.1.0', reason: 'leak' },
  ];

  it('возвращает запись при совпадении диапазона', () => {
    expect(isRevoked(revoked, 'acme.a', '1.1.9')?.reason).toBe('bug');
    expect(isRevoked(revoked, 'acme.b', '1.0.5')?.reason).toBe('leak');
  });

  it('нет совпадения — null', () => {
    expect(isRevoked(revoked, 'acme.a', '1.2.0')).toBeNull();
    expect(isRevoked(revoked, 'acme.b', '1.1.0')).toBeNull();
    expect(isRevoked(revoked, 'acme.c', '0.0.1')).toBeNull();
  });
});

describe('latestUpdate', () => {
  const e = entry({
    versions: [v('2.0.0', { minAppVersion: '2.0.0' }), v('1.1.0'), v('1.0.0')],
  });

  it('предлагает строго более новую совместимую версию', () => {
    expect(latestUpdate('1.0.0', e, context())?.version).toBe('1.1.0');
  });

  it('установленная равна лучшей совместимой — null', () => {
    expect(latestUpdate('1.1.0', e, context())).toBeNull();
  });

  it('установленная новее каталога — null', () => {
    expect(latestUpdate('3.0.0', e, context())).toBeNull();
  });

  it('новейшая доступна при достаточной версии приложения', () => {
    expect(
      latestUpdate('1.1.0', e, context({ appVersion: '2.0.0' }))?.version,
    ).toBe('2.0.0');
  });

  it('несовместимая платформа — null', () => {
    expect(
      latestUpdate('1.0.0', entry({ platforms: ['linux'] }), context()),
    ).toBeNull();
  });
});

describe('resolveVersion и отзыв', () => {
  const revoked = [{ id: 'acme.quiz', versions: '>=2.0.0', reason: 'leak' }];

  it('отозванная новейшая версия пропускается, fallback — прежняя', () => {
    const e = entry({ versions: [v('2.0.0'), v('1.0.0')] });
    expect(resolveVersion(e, context({ revoked }))).toMatchObject({
      ok: false,
      reason: 'revoked',
      detail: 'leak',
      fallback: { version: '1.0.0' },
    });
  });

  it('отзыв другого расширения не влияет', () => {
    const e = entry({ versions: [v('2.0.0')] });
    const other = [{ id: 'acme.other', versions: '>=0.0.0', reason: 'x' }];
    expect(resolveVersion(e, context({ revoked: other })).ok).toBe(true);
  });

  it('latestUpdate не предлагает отозванную версию', () => {
    const e = entry({ versions: [v('2.0.0'), v('1.1.0'), v('1.0.0')] });
    expect(latestUpdate('1.0.0', e, context({ revoked }))?.version).toBe(
      '1.1.0',
    );
  });
});

describe('deprecationFor', () => {
  const deprecated = (versions: string | null) =>
    entry({
      versions: [v('2.0.0'), v('1.0.0')],
      deprecated: { versions, reason: 'Replaced', alternatives: ['acme.new'] },
    });

  it('без диапазона действует на все версии, с диапазоном — только на подходящие', () => {
    expect(deprecationFor(deprecated(null), '2.0.0')?.reason).toBe('Replaced');
    expect(deprecationFor(deprecated('<2.0.0'), '1.0.0')?.reason).toBe(
      'Replaced',
    );
    expect(deprecationFor(deprecated('<2.0.0'), '2.0.0')).toBeNull();
    expect(deprecationFor(entry(), '1.0.0')).toBeNull();
  });
});
