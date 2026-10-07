import { describe, expect, it } from 'vitest';
import {
  deprecationFor,
  entryAction,
  facetCounts,
  filterEntries,
  hasActiveFilters,
  targetFromEntry,
  targetFromUpdate,
} from '@/pages/settings/lib/catalog.ts';
import type { ExtensionTag, TagGroup } from '@/pages/settings/lib/tags.ts';
import { describeInstallFailure } from '@/pages/settings/lib/install-error.ts';
import {
  catalogEntry,
  catalogVersion,
  extensionInfo,
} from './support/extensions-fakes.ts';

const NO_GROUPS: ReadonlySet<TagGroup> = new Set();
const NO_TAGS: ReadonlySet<ExtensionTag> = new Set();
const NO_FILTERS = {
  query: '',
  groups: NO_GROUPS,
  tags: NO_TAGS,
};

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

const names = (query: string) =>
  filterEntries(ENTRIES, { ...NO_FILTERS, query }).map((entry) => entry.id);

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
    const result = filterEntries([...ENTRIES, incompatible], NO_FILTERS);
    expect(result.map((entry) => entry.id)).toContain('acme.new');
    expect(result.map((entry) => entry.id)).not.toContain('acme.win');
  });

  it('hasActiveFilters: пробелы в запросе фильтром не считаются', () => {
    expect(hasActiveFilters({ ...NO_FILTERS, query: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: 'a' })).toBe(true);
    expect(
      hasActiveFilters({
        ...NO_FILTERS,
        groups: new Set<TagGroup>(['learning']),
      }),
    ).toBe(true);
    expect(
      hasActiveFilters({
        ...NO_FILTERS,
        tags: new Set<ExtensionTag>(['theme']),
      }),
    ).toBe(true);
  });
});

describe('фильтры по группам и тегам', () => {
  // theme+interface, learning, content, developer, productivity и запись без тегов
  const TAGGED = [
    catalogEntry('a.sunset', { tags: ['theme', 'interface'] }),
    catalogEntry('a.quiz', { tags: ['learning'] }),
    catalogEntry('a.math', { tags: ['content'] }),
    catalogEntry('a.sdk', { tags: ['developer'] }),
    catalogEntry('a.cmd', { tags: ['productivity'] }),
    catalogEntry('a.bare'),
  ];
  const ids = (override: Partial<typeof NO_FILTERS>) =>
    filterEntries(TAGGED, { ...NO_FILTERS, ...override }).map((e) => e.id);

  it('группа — объединение её тегов; запись без явных тегов ни в одну не входит', () => {
    expect(ids({ groups: new Set<TagGroup>(['appearance']) })).toEqual([
      'a.sunset',
      'a.cmd',
    ]);
    expect(ids({ groups: new Set<TagGroup>(['learning']) })).toEqual([
      'a.quiz',
      'a.math',
    ]);
    expect(ids({ groups: new Set<TagGroup>(['developers']) })).toEqual([
      'a.sdk',
    ]);
  });

  it('внутри ряда «или»', () => {
    expect(
      ids({ groups: new Set<TagGroup>(['learning', 'developers']) }),
    ).toEqual(['a.quiz', 'a.math', 'a.sdk']);
    expect(ids({ tags: new Set<ExtensionTag>(['content', 'theme']) })).toEqual([
      'a.sunset',
      'a.math',
    ]);
  });

  it('между рядами и с поиском «и»', () => {
    expect(
      ids({
        groups: new Set<TagGroup>(['appearance']),
        tags: new Set<ExtensionTag>(['productivity']),
      }),
    ).toEqual(['a.cmd']);
    expect(
      ids({
        groups: new Set<TagGroup>(['appearance']),
        query: 'sunset',
      }),
    ).toEqual(['a.sunset']);
    expect(
      ids({ tags: new Set<ExtensionTag>(['theme']), query: 'quiz' }),
    ).toEqual([]);
  });

  it('числа считаются по поиску и не зависят от выбранных фильтров', () => {
    const all = facetCounts(TAGGED, '');
    expect(all.groups).toEqual({ learning: 2, appearance: 2, developers: 1 });
    expect(all.tags).toMatchObject({
      theme: 1,
      interface: 1,
      learning: 1,
      content: 1,
      productivity: 1,
      developer: 1,
      language: 0,
    });
    expect(facetCounts(TAGGED, 'sunset').groups).toEqual({
      learning: 0,
      appearance: 1,
      developers: 0,
    });
  });

  it('недоступные на платформе записи в числа не входят', () => {
    const hidden = catalogEntry('a.win', {
      tags: ['theme'],
      incompatible: { reason: 'platform', detail: 'x', fallback: null },
    });
    expect(facetCounts([hidden], '').tags.theme).toBe(0);
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

  it('elsewhere важнее остального: кнопка неактивна, даже если запись совместима', () => {
    expect(
      entryAction(catalogEntry('a.b', { latest, elsewhere: true })),
    ).toEqual({ kind: 'elsewhere' });
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
      latest: catalogVersion('2.0.0'),
      platforms: ['darwin'],
    });
    const older = catalogVersion('1.0.0', { size: 50 });
    expect(targetFromEntry(entry, older)).toMatchObject({
      id: 'a.b',
      version: '1.0.0',
      platforms: ['darwin'],
      sizeBytes: 50,
      installedVersion: null,
    });
  });

  it('эффективные теги идут в диалог установки: записи каталога, иначе установленного', () => {
    const entry = catalogEntry('a.night', { tags: ['interface', 'future'] });
    expect(targetFromEntry(entry, catalogVersion('1.0.0'))).toMatchObject({
      tags: ['interface'],
    });
    const update = {
      id: 'a.night',
      name: 'Night',
      installed: '1.0.0',
      available: catalogVersion('1.1.0'),
    };
    const info = extensionInfo('a.night', { tags: ['developer'] });
    expect(targetFromUpdate(update, info, entry)).toMatchObject({
      tags: ['interface'],
    });
    expect(targetFromUpdate(update, info, undefined)).toMatchObject({
      tags: ['developer'],
    });
    expect(targetFromUpdate(update, undefined, undefined)).toMatchObject({
      tags: [],
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

  it('targetFromUpdate: автор и платформы из каталога, иначе из установленного', () => {
    const update = {
      id: 'a.b',
      name: 'A B',
      installed: '1.0.0',
      available: catalogVersion('1.1.0'),
    };
    const info = extensionInfo('a.b', { author: 'old' });
    const entry = catalogEntry('a.b', {
      author: 'fresh',
      platforms: ['linux'],
    });

    expect(targetFromUpdate(update, info, entry)).toMatchObject({
      author: 'fresh',
      platforms: ['linux'],
      installedVersion: '1.0.0',
      version: '1.1.0',
    });
    expect(targetFromUpdate(update, info, undefined)).toMatchObject({
      author: 'old',
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

describe('устаревание: действие по диапазону', () => {
  const all = { versions: null, reason: 'Abandoned', alternatives: [] };
  const old = { versions: '<1.2.0', reason: 'Old line', alternatives: [] };

  it('без диапазона действует на любую версию, с диапазоном — только в нём', () => {
    expect(deprecationFor(null, '1.0.0')).toBeNull();
    expect(deprecationFor(all, '9.9.9')).toBe(all);
    expect(deprecationFor(old, '1.1.9')).toBe(old);
    expect(deprecationFor(old, '1.2.0')).toBeNull();
    expect(deprecationFor(old, '2.0.0')).toBeNull();
  });

  it('нечитаемый диапазон или версия не прячут предупреждение', () => {
    const broken = { versions: 'not a range', reason: 'x', alternatives: [] };
    expect(deprecationFor(broken, '1.0.0')).toBe(broken);
    expect(deprecationFor(old, 'latest')).toBe(old);
  });

  it('диалог установки берёт предупреждение для той версии, которая будет установлена', () => {
    const entry = catalogEntry('a.b', {
      latest: catalogVersion('2.0.0'),
      deprecated: old,
    });
    expect(targetFromEntry(entry, catalogVersion('1.0.0')).deprecated).toBe(
      old,
    );
    expect(
      targetFromEntry(entry, catalogVersion('2.0.0')).deprecated,
    ).toBeNull();
    const deprecatedAll = catalogEntry('a.c', { deprecated: all });
    expect(
      targetFromEntry(deprecatedAll, catalogVersion('1.0.0')).deprecated,
    ).toBe(all);
  });

  it('обновление: пометка записи каталога по целевой версии, без записи — нет', () => {
    const update = {
      id: 'a.b',
      name: 'B',
      installed: '1.0.0',
      available: catalogVersion('1.1.0'),
    };
    const entry = catalogEntry('a.b', { deprecated: old });
    expect(targetFromUpdate(update, undefined, entry).deprecated).toBe(old);
    expect(
      targetFromUpdate(
        update,
        extensionInfo('a.b', { deprecated: old }),
        undefined,
      ).deprecated,
    ).toBeNull();
  });
});
