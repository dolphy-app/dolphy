import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type {
  CatalogDto,
  CatalogListedVersionDto,
  ExtensionDocsDto,
  ExtensionInfoDto,
  ExtensionUpdateDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import {
  authorProfileUrl,
  describeDetails,
  externalUrl,
} from '@/pages/settings/lib/extension-details.ts';
import { useExtensionDetails } from '@/pages/settings/model/extension-details.ts';
import {
  FakeEngineError,
  catalogDto,
  catalogEntry,
  catalogVersion,
  createEventBus,
  extensionInfo,
  flush,
} from './support/extensions-fakes.ts';

const listed = (
  version: string,
  override: Partial<CatalogListedVersionDto> = {},
): CatalogListedVersionDto => ({
  ...catalogVersion(version),
  compatible: true,
  incompatible: null,
  hasChangelog: false,
  ...override,
});

const DEPRECATED = {
  versions: null,
  reason: 'Abandoned',
  alternatives: [{ id: 'acme.better', name: 'Better' }],
};

describe('describeDetails: по записи каталога', () => {
  const entry = catalogEntry('acme.sunrise', {
    name: 'Sunrise',
    author: 'acme',
    source: 'https://example.test/sunrise',
    tags: ['theme'],
    latest: catalogVersion('1.1.0'),
    versions: [
      listed('1.1.0', { hasChangelog: true }),
      listed('1.0.0', {
        compatible: false,
        incompatible: { reason: 'app', detail: 'requires app >= 2.0.0' },
      }),
    ],
  });

  it('не установленное: каталожные блоки, действие «установить», версии с причинами', () => {
    const view = describeDetails('acme.sunrise', null, entry, null, null);
    expect(view).toMatchObject({
      shown: 'catalog',
      author: 'acme',
      authorUrl: 'https://github.com/acme',
      sourceUrl: 'https://example.test/sunrise',
      installedVersion: null,
      removable: false,
      tags: ['theme'],
      action: { kind: 'install', version: { version: '1.1.0' } },
    });
    expect(view?.versions.map((row) => row.version)).toEqual([
      '1.1.0',
      '1.0.0',
    ]);
    expect(view?.versions[1]?.incompatible).toEqual({
      reason: 'app',
      detail: 'requires app >= 2.0.0',
    });
    expect(view?.versions[0]?.hasChangelog).toBe(true);
  });

  it('выбранная и установленная версии помечены в списке', () => {
    const installed = catalogEntry('acme.sunrise', {
      ...entry,
      status: 'installed',
      installedVersion: '1.0.0',
    });
    const view = describeDetails(
      'acme.sunrise',
      null,
      installed,
      null,
      '1.1.0',
    );
    expect(
      view?.versions.map(({ installed, selected }) => [installed, selected]),
    ).toEqual([
      [false, true],
      [true, false],
    ]);
    expect(view?.action).toEqual({ kind: 'installed', version: '1.0.0' });
  });

  it('предупреждение об устаревании — из записи каталога', () => {
    const view = describeDetails(
      'acme.sunrise',
      null,
      catalogEntry('acme.sunrise', { deprecated: DEPRECATED }),
      null,
      null,
    );
    expect(view?.deprecation).toEqual(DEPRECATED);
  });

  it('ссылка «Исходники» только https', () => {
    const view = describeDetails(
      'a.b',
      null,
      catalogEntry('a.b', { source: 'javascript:alert(1)' }),
      null,
      null,
    );
    expect(view?.sourceUrl).toBeNull();
    expect(externalUrl('http://example.test')).toBeNull();
    expect(externalUrl(undefined)).toBeNull();
  });
});

describe('describeDetails: по установленному', () => {
  it('скопированное вручную: без каталожных блоков, но можно удалить', () => {
    const info = extensionInfo('local.theme', {
      origin: 'user',
      name: 'Local',
      removable: true,
      author: 'Jane Doe <jane@example.com>',
    });
    const view = describeDetails('local.theme', info, null, null, null);
    expect(view).toMatchObject({
      shown: 'installed',
      entry: null,
      versions: [],
      sourceUrl: null,
      action: null,
      removable: true,
      authorUrl: null,
      installedVersion: null,
    });
  });

  it('из поставки: удалить нельзя', () => {
    const bundled = describeDetails(
      'core.x',
      extensionInfo('core.x', { origin: 'bundled' }),
      null,
      null,
      null,
    );
    expect(bundled?.removable).toBe(false);
  });

  it('установленное из каталога: действие по записи, обновление — по `updates`, если записи нет', () => {
    const info = extensionInfo('acme.sunrise', {
      origin: 'user',
      removable: true,
      installed: {
        catalogUrl: 'https://example.test/',
        version: '1.0.0',
        installedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const entry = catalogEntry('acme.sunrise', {
      status: 'update',
      installedVersion: '1.0.0',
      latest: catalogVersion('1.1.0'),
    });
    expect(
      describeDetails('acme.sunrise', info, entry, null, null),
    ).toMatchObject({
      installedVersion: '1.0.0',
      action: { kind: 'update', installed: '1.0.0' },
    });
    const update: ExtensionUpdateDto = {
      id: 'acme.sunrise',
      name: 'S',
      installed: '1.0.0',
      available: catalogVersion('1.1.0'),
    };
    expect(
      describeDetails('acme.sunrise', info, null, update, null)?.action,
    ).toMatchObject({ kind: 'update', installed: '1.0.0' });
  });

  it('расширение уже есть из другого источника: кнопка каталога неактивна (действие «elsewhere»)', () => {
    const info = extensionInfo('acme.sunrise', { origin: 'user' });
    const entry = catalogEntry('acme.sunrise', { elsewhere: true });
    expect(
      describeDetails('acme.sunrise', info, entry, null, null)?.action,
    ).toEqual({ kind: 'elsewhere' });
  });

  it('предупреждение: установленной версии важнее; без него — записи каталога, кроме «из другого источника»', () => {
    const entryDeprecated = catalogEntry('a.b', { deprecated: DEPRECATED });
    const own = { ...DEPRECATED, reason: 'Installed one' };
    expect(
      describeDetails(
        'a.b',
        extensionInfo('a.b', { deprecated: own }),
        entryDeprecated,
        null,
        null,
      )?.deprecation,
    ).toBe(own);
    expect(
      describeDetails('a.b', extensionInfo('a.b'), entryDeprecated, null, null)
        ?.deprecation,
    ).toBe(DEPRECATED);
    expect(
      describeDetails(
        'a.b',
        extensionInfo('a.b'),
        catalogEntry('a.b', { deprecated: DEPRECATED, elsewhere: true }),
        null,
        null,
      )?.deprecation,
    ).toBeNull();
  });

  it('нет ни установленного, ни записи — страницы нет', () => {
    expect(describeDetails('no.such', null, null, null, null)).toBeNull();
  });
});

describe('authorProfileUrl', () => {
  it('ссылка только для логина GitHub', () => {
    expect(authorProfileUrl('dana-k')).toBe('https://github.com/dana-k');
    expect(authorProfileUrl('a'.repeat(39))).not.toBeNull();
    expect(authorProfileUrl('a'.repeat(40))).toBeNull();
    for (const author of [
      null,
      '',
      '-lead',
      'two words',
      'a/b',
      'x@example.com',
      'a?b=c',
    ]) {
      expect(authorProfileUrl(author), String(author)).toBeNull();
    }
  });
});

interface DocsCall {
  id: string;
  options: { version?: string } | undefined;
  resolve(docs: ExtensionDocsDto): void;
  reject(error: Error): void;
}

const docsDto = (
  version: string,
  override: Partial<ExtensionDocsDto> = {},
): ExtensionDocsDto => ({
  version,
  readme: `# ${version}`,
  changelog: null,
  truncated: false,
  source: 'catalog',
  ...override,
});

interface Fixture {
  list?: ExtensionInfoDto[];
  catalog?: CatalogDto | Error;
  updates?: ExtensionUpdateDto[];
}

/** `docs()` ждёт, пока тест не завершит вызов; остальное отвечает сразу. */
const setup = (
  fixture: Fixture,
  route = { id: 'acme.sunrise', version: null as string | null },
) => {
  const bus = createEventBus();
  const docsCalls: DocsCall[] = [];
  let list = fixture.list ?? [];
  let catalog = fixture.catalog ?? catalogDto([]);
  const engine = {
    subscribe: bus.subscribe,
    extensions: {
      list: () => Promise.resolve(list),
      updates: () => Promise.resolve(fixture.updates ?? []),
      catalog: () =>
        catalog instanceof Error
          ? Promise.reject(catalog)
          : Promise.resolve(catalog),
      docs: (id: string, options?: { version?: string }) =>
        new Promise<ExtensionDocsDto>((resolve, reject) => {
          docsCalls.push({ id, options, resolve, reject });
        }),
    },
  } as unknown as LearningEngine;
  const id = ref(route.id);
  const version = ref<string | null>(route.version);
  const scope = effectScope();
  const model = scope.run(() => useExtensionDetails(engine, id, version))!;
  return {
    model,
    bus,
    docsCalls,
    id,
    version,
    scope,
    setList: (next: ExtensionInfoDto[]) => {
      list = next;
    },
    setCatalog: (next: CatalogDto | Error) => {
      catalog = next;
    },
  };
};

const SUNRISE = catalogEntry('acme.sunrise', {
  name: 'Sunrise',
  versions: [listed('1.1.0'), listed('1.0.0')],
});

describe('useExtensionDetails: описание версии', () => {
  it('три состояния: загрузка, получено, недоступно с «Повторить»', async () => {
    const { model, docsCalls } = setup({ catalog: catalogDto([SUNRISE]) });
    await flush();
    expect(model.state.value).toBe('ready');
    expect(model.docs.value).toEqual({ status: 'loading' });
    expect(docsCalls).toHaveLength(1);
    expect(docsCalls[0]?.options).toBeUndefined();

    docsCalls[0]?.reject(
      new FakeEngineError('EXTENSION_INSTALL_FAILED', 'offline', {
        details: { reason: 'network' },
      }),
    );
    await flush();
    expect(model.docs.value).toEqual({
      status: 'failed',
      message: 'offline',
      reason: 'network',
    });

    const retry = model.retryDocs();
    expect(model.docs.value).toEqual({ status: 'loading' });
    docsCalls[1]?.resolve(docsDto('1.1.0'));
    await retry;
    expect(model.docs.value).toEqual({
      status: 'ready',
      docs: docsDto('1.1.0'),
    });
  });

  it('источник cache сохраняется как есть: страница пометит «Без связи с каталогом»', async () => {
    const { model, docsCalls } = setup({ catalog: catalogDto([SUNRISE]) });
    await flush();
    docsCalls[0]?.resolve(docsDto('1.1.0', { source: 'cache' }));
    await flush();
    expect(model.docs.value).toMatchObject({
      status: 'ready',
      docs: { source: 'cache' },
    });
  });

  it('выбранная версия запрашивается явно и отмечается в списке', async () => {
    const { model, docsCalls, version } = setup({
      catalog: catalogDto([SUNRISE]),
    });
    await flush();
    docsCalls[0]?.resolve(docsDto('1.1.0'));
    await flush();
    expect(model.details.value?.versions.map((row) => row.selected)).toEqual([
      true,
      false,
    ]);

    version.value = '1.0.0';
    await nextTick();
    expect(docsCalls).toHaveLength(2);
    expect(docsCalls[1]?.options).toEqual({ version: '1.0.0' });
    docsCalls[1]?.resolve(docsDto('1.0.0'));
    await flush();
    expect(model.details.value?.versions.map((row) => row.selected)).toEqual([
      false,
      true,
    ]);
  });

  it('значение version не похоже на semver — игнорируется', async () => {
    const { docsCalls } = setup(
      { catalog: catalogDto([SUNRISE]) },
      { id: 'acme.sunrise', version: '../etc/passwd' },
    );
    await flush();
    expect(docsCalls[0]?.options).toBeUndefined();
  });

  it('ответ устаревшего запроса отбрасывается', async () => {
    const { model, docsCalls, version } = setup({
      catalog: catalogDto([SUNRISE]),
    });
    await flush();
    version.value = '1.0.0';
    await nextTick();
    docsCalls[1]?.resolve(docsDto('1.0.0'));
    await flush();
    docsCalls[0]?.resolve(docsDto('1.1.0'));
    await flush();
    expect(model.docs.value).toMatchObject({
      status: 'ready',
      docs: { version: '1.0.0' },
    });
  });

  it('смена расширения сбрасывает страницу и читает всё заново', async () => {
    const other = catalogEntry('acme.other', { name: 'Other' });
    const { model, docsCalls, id } = setup({
      catalog: catalogDto([SUNRISE, other]),
    });
    await flush();
    docsCalls[0]?.resolve(docsDto('1.1.0'));
    await flush();
    expect(model.details.value?.id).toBe('acme.sunrise');

    id.value = 'acme.other';
    await nextTick();
    expect(model.state.value).toBe('loading');
    expect(model.details.value).toBeNull();
    await flush();
    expect(model.details.value?.id).toBe('acme.other');
    expect(docsCalls[1]?.id).toBe('acme.other');
  });

  it('расширения нет нигде: страницы нет и описание не запрашивается', async () => {
    const { model, docsCalls } = setup({ catalog: catalogDto([]) });
    await flush();
    expect(model.state.value).toBe('ready');
    expect(model.details.value).toBeNull();
    expect(docsCalls).toHaveLength(0);
  });

  it('изменение набора перечитывает без мигания; при выбранной версии описание не трогается', async () => {
    const { model, docsCalls, bus, setList, version } = setup({
      catalog: catalogDto([SUNRISE]),
    });
    await flush();
    docsCalls[0]?.resolve(docsDto('1.1.0'));
    await flush();

    setList([
      extensionInfo('acme.sunrise', { origin: 'user', removable: true }),
    ]);
    bus.emit({ type: 'extensions-changed' });
    await flush();
    expect(model.details.value?.info?.id).toBe('acme.sunrise');
    // описание перечитывается, но показанный текст остаётся до ответа
    expect(docsCalls).toHaveLength(2);
    expect(model.docs.value.status).toBe('ready');
    docsCalls[1]?.resolve(docsDto('1.1.0'));
    await flush();

    version.value = '1.0.0';
    await nextTick();
    docsCalls[2]?.resolve(docsDto('1.0.0'));
    await flush();
    bus.emit({ type: 'contributions-changed', generation: 3 });
    await flush();
    expect(docsCalls).toHaveLength(3);
  });
});

describe('useExtensionDetails: без каталога', () => {
  it('каталог недоступен: показано только установленное, причина сохранена', async () => {
    const { model, docsCalls } = setup({
      list: [
        extensionInfo('acme.sunrise', { origin: 'user', name: 'Sunrise' }),
      ],
      catalog: new FakeEngineError('CATALOG_UNAVAILABLE', 'no network'),
    });
    await flush();
    expect(model.state.value).toBe('ready');
    expect(model.catalogError.value).toBe('no network');
    expect(model.details.value).toMatchObject({
      shown: 'installed',
      entry: null,
      versions: [],
    });
    expect(docsCalls).toHaveLength(1);
  });

  it('индекс из кэша: запись есть, помечен устаревшим', async () => {
    const { model } = setup({
      catalog: catalogDto([SUNRISE], { stale: true, error: 'offline' }),
    });
    await flush();
    expect(model.catalogStale.value).toBe(true);
    expect(model.catalogError.value).toBeNull();
    expect(model.details.value?.entry?.id).toBe('acme.sunrise');
  });

  it('несколько записей с одним id: действующая важнее перекрытой', async () => {
    const { model } = setup({
      list: [
        extensionInfo('acme.sunrise', {
          origin: 'user',
          state: 'overridden',
          name: 'Old',
        }),
        extensionInfo('acme.sunrise', { origin: 'dev', name: 'Dev' }),
      ],
    });
    await flush();
    expect(model.details.value?.info?.name).toBe('Dev');
  });
});
