import { describe, expect, it } from 'vitest';
import {
  entryAction,
  filterEntries,
  hasActiveFilters,
  targetFromEntry,
  targetFromUpdate,
} from '@/pages/settings/lib/catalog.ts';
import type { ContributionPoint } from '@/pages/settings/lib/catalog.ts';
import { describeInstallFailure } from '@/pages/settings/lib/install-error.ts';
import {
  NO_CONTRIBUTES,
  catalogEntry,
  catalogVersion,
  extensionInfo,
} from './support/extensions-fakes.ts';

const NO_KINDS: ReadonlySet<ContributionPoint> = new Set();

const ENTRIES = [
  catalogEntry('acme.sunrise', {
    name: 'Рассвет',
    description: 'Светлая тема «Рассвет»',
    author: 'Alice',
  }),
  catalogEntry('acme.quiz', {
    name: 'Quiz',
    description: 'Вид заданий с вариантами',
    author: 'bob',
    contributes: { ...NO_CONTRIBUTES, exerciseTypes: ['acme.quiz'] },
  }),
  catalogEntry('acme.win', {
    name: 'Win only',
    status: 'incompatible',
    latest: null,
    incompatible: {
      reason: 'platform',
      detail: 'not available',
      fallback: null,
    },
  }),
];

const names = (
  query: string,
  kinds: ReadonlySet<ContributionPoint> = NO_KINDS,
) => filterEntries(ENTRIES, { query, kinds }).map((entry) => entry.id);

describe('filterEntries', () => {
  it('ищет по названию, id, описанию и автору без учёта регистра, в том числе по-русски', () => {
    expect(names('РАССВЕТ')).toEqual(['acme.sunrise']);
    expect(names('рассвет')).toEqual(['acme.sunrise']);
    expect(names('вариантами')).toEqual(['acme.quiz']);
    expect(names('ACME.QU')).toEqual(['acme.quiz']);
    expect(names('alice')).toEqual(['acme.sunrise']);
    expect(names('  bob  ')).toEqual(['acme.quiz']);
  });

  it('пустой запрос оставляет все доступные на этой платформе', () => {
    expect(names('')).toEqual(['acme.sunrise', 'acme.quiz']);
  });

  it('недоступные на платформе скрыты, а несовместимые по другой причине остаются', () => {
    const incompatible = catalogEntry('acme.new', {
      status: 'incompatible',
      latest: null,
      incompatible: {
        reason: 'app',
        detail: 'requires app >= 99',
        fallback: null,
      },
    });
    const result = filterEntries([...ENTRIES, incompatible], {
      query: '',
      kinds: NO_KINDS,
    });
    expect(result.map((entry) => entry.id)).toContain('acme.new');
    expect(result.map((entry) => entry.id)).not.toContain('acme.win');
  });

  it('фильтр по виду вклада: достаточно любого выбранного', () => {
    expect(names('', new Set<ContributionPoint>(['themes']))).toEqual([
      'acme.sunrise',
    ]);
    expect(names('', new Set<ContributionPoint>(['exerciseTypes']))).toEqual([
      'acme.quiz',
    ]);
    expect(
      names('', new Set<ContributionPoint>(['themes', 'exerciseTypes'])),
    ).toEqual(['acme.sunrise', 'acme.quiz']);
    expect(names('', new Set<ContributionPoint>(['gradePolicies']))).toEqual(
      [],
    );
  });

  it('запрос и фильтр действуют вместе', () => {
    expect(names('quiz', new Set<ContributionPoint>(['themes']))).toEqual([]);
  });

  it('hasActiveFilters: пробелы в запросе фильтром не считаются', () => {
    expect(hasActiveFilters({ query: '  ', kinds: NO_KINDS })).toBe(false);
    expect(hasActiveFilters({ query: 'a', kinds: NO_KINDS })).toBe(true);
    expect(
      hasActiveFilters({
        query: '',
        kinds: new Set<ContributionPoint>(['themes']),
      }),
    ).toBe(true);
  });
});

describe('entryAction', () => {
  const latest = catalogVersion('1.1.0');

  it('available → install с последней версией', () => {
    expect(entryAction(catalogEntry('a.b', { latest }))).toEqual({
      kind: 'install',
      version: latest,
    });
  });

  it('installed → установленная версия', () => {
    expect(
      entryAction(
        catalogEntry('a.b', { status: 'installed', installedVersion: '1.1.0' }),
      ),
    ).toEqual({ kind: 'installed', version: '1.1.0' });
  });

  it('update → что стоит и до чего обновить', () => {
    expect(
      entryAction(
        catalogEntry('a.b', {
          status: 'update',
          installedVersion: '1.0.0',
          latest,
        }),
      ),
    ).toEqual({ kind: 'update', installed: '1.0.0', version: latest });
  });

  it('incompatible → причина движка и ближайшая совместимая версия', () => {
    const fallback = catalogVersion('0.9.0');
    expect(
      entryAction(
        catalogEntry('a.b', {
          status: 'incompatible',
          latest: null,
          incompatible: {
            reason: 'app',
            detail: 'requires app >= 99.0.0',
            fallback,
          },
        }),
      ),
    ).toEqual({
      kind: 'incompatible',
      reason: 'app',
      detail: 'requires app >= 99.0.0',
      fallback,
    });
  });
});

describe('цели установки', () => {
  it('targetFromEntry берёт разрешения выбранной версии, а не последней', () => {
    const entry = catalogEntry('a.b', {
      latest: catalogVersion('2.0.0', { permissions: ['network'] }),
      platforms: ['darwin'],
    });
    const older = catalogVersion('1.0.0', { permissions: [], size: 50 });
    expect(targetFromEntry(entry, older)).toMatchObject({
      id: 'a.b',
      version: '1.0.0',
      permissions: [],
      platforms: ['darwin'],
      sizeBytes: 50,
      installedVersion: null,
    });
  });

  it('the install dialog gets the icon: from the catalog entry, else from the installed copy, else none', () => {
    const icon = 'data:image/png;base64,AAAA';
    const version = catalogVersion('1.0.0');
    expect(targetFromEntry(catalogEntry('a.b', { icon }), version).icon).toBe(
      icon,
    );
    expect(targetFromEntry(catalogEntry('a.b'), version).icon).toBeNull();
    const update = {
      id: 'a.b',
      name: 'A B',
      installed: '1.0.0',
      available: catalogVersion('1.1.0'),
    };
    const installed = extensionInfo('a.b', {
      icon: 'data:image/png;base64,BBBB',
    });
    expect(
      targetFromUpdate(update, installed, catalogEntry('a.b', { icon })).icon,
    ).toBe(icon);
    expect(targetFromUpdate(update, installed, undefined).icon).toBe(
      'data:image/png;base64,BBBB',
    );
    expect(targetFromUpdate(update, undefined, undefined).icon).toBeNull();
  });

  it('targetFromUpdate: вклады и автор из каталога, иначе из установленного', () => {
    const update = {
      id: 'a.b',
      name: 'A B',
      installed: '1.0.0',
      available: catalogVersion('1.1.0', { permissions: ['network'] }),
    };
    const info = extensionInfo('a.b', {
      author: 'old',
      contributes: { ...NO_CONTRIBUTES, themes: ['old'] },
    });
    const entry = catalogEntry('a.b', {
      author: 'fresh',
      contributes: { ...NO_CONTRIBUTES, themes: ['fresh'] },
      platforms: ['linux'],
    });

    expect(targetFromUpdate(update, info, entry)).toMatchObject({
      author: 'fresh',
      contributes: { themes: ['fresh'] },
      platforms: ['linux'],
      installedVersion: '1.0.0',
      version: '1.1.0',
      permissions: ['network'],
    });
    expect(targetFromUpdate(update, info, undefined)).toMatchObject({
      author: 'old',
      contributes: { themes: ['old'] },
      platforms: [],
    });
    expect(targetFromUpdate(update, undefined, undefined).author).toBeNull();
  });
});

describe('describeInstallFailure', () => {
  const error = (code: string, details?: Record<string, unknown>) =>
    ({
      code,
      message: 'boom',
      retryable: true,
      ...(details && { details }),
    }) as never;

  it.each([
    'network',
    'integrity',
    'incompatible',
    'limits',
    'invalid',
    'conflict',
  ])('EXTENSION_INSTALL_FAILED %s → причина как есть', (reason) => {
    expect(
      describeInstallFailure(error('EXTENSION_INSTALL_FAILED', { reason })),
    ).toEqual({ reason, message: 'boom', retryable: true });
  });

  it('незнакомая причина и прочие коды → общий текст', () => {
    expect(
      describeInstallFailure(
        error('EXTENSION_INSTALL_FAILED', { reason: 'new-reason' }),
      ).reason,
    ).toBe('unknown');
    expect(describeInstallFailure(error('INTERNAL')).reason).toBe('unknown');
  });

  it('CATALOG_UNAVAILABLE и NOT_FOUND имеют свои тексты', () => {
    expect(describeInstallFailure(error('CATALOG_UNAVAILABLE')).reason).toBe(
      'unavailable',
    );
    expect(describeInstallFailure(error('NOT_FOUND')).reason).toBe('notFound');
  });
});
