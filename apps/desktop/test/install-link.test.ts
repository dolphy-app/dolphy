import { effectScope } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogDto,
  CatalogEntryDto,
  InstallResultDto,
  LearningEngine,
} from '@dolphy-app/engine-contract';
import { createInstall } from '@/pages/settings/model/install.ts';
import {
  createInstallLinks,
  resolveInstallLink,
} from '@/pages/settings/model/install-link.ts';
import type { InstallLinkMessage } from '@/pages/settings/model/install-link.ts';
import {
  FakeEngineError,
  catalogDto,
  catalogEntry,
  catalogVersion,
  flush,
} from './support/extensions-fakes.ts';

const ID = 'acme.sunrise';

describe('resolveInstallLink', () => {
  it('неизвестный id', () => {
    expect(resolveInstallLink([catalogEntry('acme.moon')], ID)).toEqual({
      kind: 'not-found',
      id: ID,
    });
  });

  it('доступное расширение — диалог установки с последней версией', () => {
    const outcome = resolveInstallLink([catalogEntry(ID)], ID);
    expect(outcome).toMatchObject({
      kind: 'review',
      target: { id: ID, version: '1.0.0', installedVersion: null },
    });
  });

  it('обновление — диалог обновления с установленной и новой версией', () => {
    const outcome = resolveInstallLink(
      [
        catalogEntry(ID, {
          status: 'update',
          installedVersion: '0.9.0',
          latest: catalogVersion('1.0.0'),
        }),
      ],
      ID,
    );
    expect(outcome).toMatchObject({
      kind: 'review',
      target: { version: '1.0.0', installedVersion: '0.9.0' },
    });
  });

  it('уже актуальное — сообщение, не диалог', () => {
    expect(
      resolveInstallLink(
        [catalogEntry(ID, { status: 'installed', installedVersion: '1.0.0' })],
        ID,
      ),
    ).toEqual({ kind: 'up-to-date', name: ID, version: '1.0.0' });
  });

  it('установленное из другого каталога — сообщение', () => {
    expect(
      resolveInstallLink([catalogEntry(ID, { elsewhere: true })], ID),
    ).toEqual({ kind: 'elsewhere', name: ID });
  });

  it('несовместимое — причина, а не диалог (в том числе платформа)', () => {
    expect(
      resolveInstallLink(
        [
          catalogEntry(ID, {
            status: 'incompatible',
            latest: null,
            incompatible: {
              reason: 'api',
              detail: 'нужен API 2',
              fallback: null,
            },
          }),
        ],
        ID,
      ),
    ).toEqual({
      kind: 'incompatible',
      id: ID,
      name: ID,
      detail: 'нужен API 2',
    });
    expect(
      resolveInstallLink(
        [
          catalogEntry(ID, {
            status: 'incompatible',
            latest: null,
            incompatible: {
              reason: 'platform',
              detail: 'только Windows',
              fallback: null,
            },
          }),
        ],
        ID,
      ),
    ).toMatchObject({ kind: 'incompatible', detail: 'только Windows' });
  });
});

describe('createInstallLinks', () => {
  const setup = (
    options: {
      entries?: CatalogEntryDto[];
      catalog?: () => Promise<CatalogDto>;
    } = {},
  ) => {
    const installs: { id: string; version: string | undefined }[] = [];
    const catalogCalls = { count: 0 };
    const engine = {
      extensions: {
        catalog: () => {
          catalogCalls.count += 1;
          return (
            options.catalog?.() ??
            Promise.resolve(catalogDto(options.entries ?? []))
          );
        },
        docs: () => Promise.reject(new Error('no docs')),
        install: async (
          id: string,
          version?: string,
        ): Promise<InstallResultDto> => {
          installs.push({ id, version });
          return { id, version: version ?? '1.0.0', previousVersion: null };
        },
      },
    } as unknown as LearningEngine;
    const install = effectScope().run(() => createInstall(engine))!;
    const notify = vi.fn<(message: InstallLinkMessage) => void>();
    const openPage = vi.fn<(id: string) => void>();
    const links = createInstallLinks({ engine, install, notify, openPage });
    return { links, install, notify, openPage, installs, catalogCalls };
  };

  it('открывает диалог установки и ничего не ставит до подтверждения', async () => {
    const { links, install, installs, notify } = setup({
      entries: [catalogEntry(ID)],
    });
    await links.handle(ID);
    expect(install.phase.value).toBe('confirm');
    expect(install.items.value[0]?.target.id).toBe(ID);
    expect(installs).toEqual([]);
    expect(notify).not.toHaveBeenCalled();

    await install.confirm();
    expect(installs).toEqual([{ id: ID, version: '1.0.0' }]);
  });

  it('неизвестный id — сообщение с id, диалога нет', async () => {
    const { links, install, notify } = setup({
      entries: [catalogEntry('acme.moon')],
    });
    await links.handle(ID);
    expect(notify).toHaveBeenCalledWith({
      key: 'notFound',
      params: { id: ID },
    });
    expect(install.phase.value).toBe('idle');
  });

  it('актуальное — сообщение; установленное из другого источника — сообщение', async () => {
    const current = setup({
      entries: [
        catalogEntry(ID, { status: 'installed', installedVersion: '1.0.0' }),
      ],
    });
    await current.links.handle(ID);
    expect(current.notify).toHaveBeenCalledWith({
      key: 'upToDate',
      params: { name: ID, version: '1.0.0' },
    });
    expect(current.install.phase.value).toBe('idle');

    const elsewhere = setup({
      entries: [catalogEntry(ID, { elsewhere: true })],
    });
    await elsewhere.links.handle(ID);
    expect(elsewhere.notify).toHaveBeenCalledWith({
      key: 'elsewhere',
      params: { name: ID },
    });
    expect(elsewhere.install.phase.value).toBe('idle');
  });

  it('несовместимое — причина в сообщении и страница расширения', async () => {
    const { links, install, notify, openPage } = setup({
      entries: [
        catalogEntry(ID, {
          status: 'incompatible',
          latest: null,
          incompatible: {
            reason: 'api',
            detail: 'нужен API 2',
            fallback: null,
          },
        }),
      ],
    });
    await links.handle(ID);
    expect(notify).toHaveBeenCalledWith({
      key: 'incompatible',
      params: { name: ID, detail: 'нужен API 2' },
    });
    expect(openPage).toHaveBeenCalledWith(ID);
    expect(install.phase.value).toBe('idle');
  });

  it('во время установки ссылка отбрасывается, каталог не запрашивается', async () => {
    const { links, install, notify, catalogCalls } = setup({
      entries: [catalogEntry(ID), catalogEntry('acme.moon')],
    });
    await links.handle(ID);
    const running = install.confirm();
    expect(install.phase.value).toBe('running');

    await links.handle('acme.moon');
    expect(notify).toHaveBeenCalledWith({ key: 'busy', params: {} });
    expect(catalogCalls.count).toBe(1);
    expect(install.items.value.map((item) => item.target.id)).toEqual([ID]);
    await running;
  });

  it('установка началась, пока читался каталог, — ссылка отбрасывается', async () => {
    let release: (catalog: CatalogDto) => void = () => undefined;
    const { links, install, notify } = setup({
      catalog: () =>
        new Promise<CatalogDto>((resolve) => {
          release = resolve;
        }),
    });
    install.review([
      {
        id: 'acme.other',
        name: 'Other',
        author: null,
        version: '1.0.0',
        installedVersion: null,
        permissions: [],
        contributes: catalogEntry('x').contributes,
        titles: {},
        tags: [],
        platforms: [],
        sizeBytes: 1,
        icon: null,
        deprecated: null,
      },
    ]);
    const handled = links.handle(ID);
    void install.confirm();
    release(catalogDto([catalogEntry(ID)]));
    await handled;
    expect(notify).toHaveBeenCalledWith({ key: 'busy', params: {} });
    expect(install.items.value.map((item) => item.target.id)).toEqual([
      'acme.other',
    ]);
  });

  it('новая ссылка вытесняет прежнюю, пока читается каталог', async () => {
    const releases: ((catalog: CatalogDto) => void)[] = [];
    const { links, install } = setup({
      catalog: () =>
        new Promise<CatalogDto>((resolve) => {
          releases.push(resolve);
        }),
    });
    const first = links.handle(ID);
    const second = links.handle('acme.moon');
    const catalog = catalogDto([catalogEntry(ID), catalogEntry('acme.moon')]);
    releases[1]?.(catalog);
    releases[0]?.(catalog);
    await Promise.all([first, second]);
    expect(install.items.value.map((item) => item.target.id)).toEqual([
      'acme.moon',
    ]);
  });

  it('каталог недоступен — сообщение с причиной', async () => {
    const { links, install, notify } = setup({
      catalog: () =>
        Promise.reject(
          new FakeEngineError('EXTENSION_CATALOG_UNAVAILABLE', 'нет сети'),
        ),
    });
    await links.handle(ID);
    await flush();
    expect(notify).toHaveBeenCalledWith({
      key: 'failed',
      params: { message: expect.stringContaining('нет сети') },
    });
    expect(install.phase.value).toBe('idle');
  });
});
