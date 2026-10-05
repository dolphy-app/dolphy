import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDiscoveryHolder,
  createExtensionPolicy,
  createExtensionRegistry,
  discoverExtensions,
} from '@dolphy-app/extension-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXTENSION_CATALOG_URL,
  createDesktopInstaller,
  createUnavailableInstaller,
  envCatalogUrl,
} from '../electron/host/installer.ts';

const logger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const CATALOG = 'https://catalog.test/index.json';

describe('envCatalogUrl', () => {
  it('без настройки окружения — ничего', () => {
    const log = logger();
    expect(envCatalogUrl(undefined, log)).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('принимает http(s)-адрес, в том числе локальный сервер e2e', () => {
    expect(envCatalogUrl('http://127.0.0.1:4010/index.json', logger())).toBe(
      'http://127.0.0.1:4010/index.json',
    );
  });

  it.each(['not a url', 'file:///etc/passwd', 'ftp://host/index.json'])(
    'адрес %s игнорируется с предупреждением',
    (bad) => {
      const log = logger();
      expect(envCatalogUrl(bad, log)).toBeUndefined();
      expect(log.warn).toHaveBeenCalledOnce();
    },
  );
});

describe('адрес каталога установщика', () => {
  const holder = () =>
    createDiscoveryHolder({ extensions: [], overridden: [], diagnostics: [] });
  const open = (
    config: { extensionCatalogUrl?: string },
    settingUrl: string | null,
  ) =>
    createDesktopInstaller({
      config: { userExtensionsDir: '/nonexistent', ...config },
      settingUrl,
      discovery: holder(),
      logger: logger(),
    });

  it('окружение важнее настройки, настройка важнее умолчания', () => {
    expect(open({}, null).catalogSource()).toEqual({
      url: DEFAULT_EXTENSION_CATALOG_URL,
      default: DEFAULT_EXTENSION_CATALOG_URL,
      origin: 'default',
    });
    expect(
      open({}, 'https://own.test/index.json').catalogSource(),
    ).toMatchObject({ url: 'https://own.test/index.json', origin: 'setting' });
    expect(
      open(
        { extensionCatalogUrl: 'http://127.0.0.1:4010/index.json' },
        'https://own.test/index.json',
      ).catalogSource(),
    ).toMatchObject({
      url: 'http://127.0.0.1:4010/index.json',
      origin: 'env',
    });
  });

  it('испорченное окружение не мешает настройке', () => {
    expect(
      open(
        { extensionCatalogUrl: 'nope' },
        'https://own.test/index.json',
      ).catalogSource(),
    ).toMatchObject({ url: 'https://own.test/index.json', origin: 'setting' });
  });
});

describe('установщик без пользовательского каталога', () => {
  it('каталог и установка недоступны, обновлений и отзывов нет', async () => {
    const installer = createDesktopInstaller({
      config: {},
      settingUrl: null,
      discovery: createDiscoveryHolder({
        extensions: [],
        overridden: [],
        diagnostics: [],
      }),
      logger: logger(),
    });
    await installer.ready();
    await expect(installer.catalog()).rejects.toMatchObject({
      cause: 'catalog-unavailable',
    });
    await expect(installer.install('acme.x')).rejects.toMatchObject({
      cause: 'catalog-unavailable',
    });
    await expect(installer.uninstall('acme.x')).rejects.toMatchObject({
      cause: 'catalog-unavailable',
    });
    expect(await installer.updates()).toEqual([]);
    expect(await installer.checkForUpdates()).toBe(0);
    expect(installer.revocationOf('acme.x', '1.0.0', CATALOG)).toBeNull();
    expect(installer.deprecationOf('acme.x', '1.0.0', CATALOG)).toBeNull();
    for (const call of [
      () => installer.docs('acme.x'),
      () => installer.docImage('acme.x', '1.0.0', 'a.png'),
      () => installer.versionFile('acme.x', '1.0.0', 'README.md'),
    ]) {
      await expect(call()).rejects.toMatchObject({
        cause: 'catalog-unavailable',
      });
    }
  });

  it('createUnavailableInstaller — тот же набор поведения', async () => {
    await expect(createUnavailableInstaller().catalog()).rejects.toMatchObject({
      cause: 'catalog-unavailable',
    });
  });
});

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

const manifest = JSON.stringify({
  id: 'acme.theme',
  version: '1.0.0',
  apiVersion: 1,
  name: 'Acme theme',
  description: 'A theme',
  author: 'acme',
  contributes: {
    themes: [
      {
        id: 'acme.theme.night',
        label: 'Night',
        dark: true,
        colors: { background: '#000000' },
      },
    ],
  },
});

const indexOf = (revoked: { id: string; versions: string; reason: string }[]) =>
  JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-10-01T12:00:00Z',
    extensions: [
      {
        id: 'acme.theme',
        name: 'Acme theme',
        description: 'A theme',
        author: 'acme',
        source: 'https://github.com/dolphy-app/dolphy-extensions',
        platforms: [],
        contributes: {
          exerciseTypes: [],
          themes: ['acme.theme.night'],
          markdownRenderers: [],
          gradePolicies: [],
          settings: [],
          events: [],
          commands: [],
          panels: [],
          importers: [],
          exporters: [],
        },
        versions: [
          {
            version: '1.0.0',
            apiVersion: 1,
            minAppVersion: null,
            permissions: [],
            publishedAt: '2026-10-01T00:00:00Z',
            baseUrl: 'extensions/acme.theme/1.0.0/',
            files: [
              {
                path: 'extension.json',
                size: Buffer.byteLength(manifest),
                sha256: sha256(manifest),
              },
            ],
          },
        ],
      },
    ],
    revoked,
  });

describe('установка из каталога → обнаружение → отзыв', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'dolphy-desktop-installer-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('установленное расширение несёт метаданные установки; отзыв отключает его и не отключает руками скопированное', async () => {
    let revoked: { id: string; versions: string; reason: string }[] = [];
    const fetchFake: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://catalog.test/index.v2.json') {
        return new Response(indexOf(revoked));
      }
      if (url.endsWith('/extension.json')) return new Response(manifest);
      return new Response('not found', { status: 404 });
    };
    const log = logger();
    const discovery = createDiscoveryHolder({
      extensions: [],
      overridden: [],
      diagnostics: [],
    });
    const installer = createDesktopInstaller({
      config: { userExtensionsDir: dir, extensionCatalogUrl: CATALOG },
      settingUrl: null,
      discovery,
      logger: log,
      fetch: fetchFake,
    });
    await installer.ready();
    expect(await installer.install('acme.theme')).toMatchObject({
      id: 'acme.theme',
      version: '1.0.0',
      previousVersion: null,
    });

    const found = await discoverExtensions({
      roots: [{ dir, origin: 'user' }],
      logger: log,
    });
    const [extension] = found.extensions;
    expect(found.diagnostics).toEqual([]);
    expect(extension).toMatchObject({
      id: 'acme.theme',
      name: 'Acme theme',
      install: { catalogUrl: CATALOG, version: '1.0.0' },
    });

    const policy = createExtensionPolicy(
      createDiscoveryHolder(found),
      installer.revocationOf,
    );
    const registry = createExtensionRegistry(
      createDiscoveryHolder(found),
      policy,
      installer.revocationOf,
    );
    expect(registry.list()[0]).toMatchObject({
      state: 'loaded',
      revoked: null,
      deprecated: null,
    });

    revoked = [{ id: 'acme.theme', versions: '<2.0.0', reason: 'malware' }];
    await installer.catalog({ refresh: true });
    expect(registry.list()[0]).toMatchObject({
      state: 'disabled',
      revoked: 'malware',
      toggleable: false,
    });
    expect(policy.isEnabled('acme.theme')).toBe(false);
    expect(registry.contributions().themes).toEqual([]);
  });

  it('после смены адреса отзыв нового каталога не отключает установленное из прежнего, а возврат адреса возвращает отзыв', async () => {
    const OTHER = 'https://other.test/index.json';
    let formerRevokes = false;
    const revoke = [
      { id: 'acme.theme', versions: '<2.0.0', reason: 'malware' },
    ];
    const fetchFake: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://catalog.test/index.v2.json') {
        return new Response(indexOf(formerRevokes ? revoke : []));
      }
      if (url === 'https://other.test/index.v2.json') {
        return new Response(indexOf(revoke));
      }
      if (
        url ===
        'https://catalog.test/extensions/acme.theme/1.0.0/extension.json'
      ) {
        return new Response(manifest);
      }
      return new Response('not found', { status: 404 });
    };
    const log = logger();
    const discovery = createDiscoveryHolder({
      extensions: [],
      overridden: [],
      diagnostics: [],
    });
    const installer = createDesktopInstaller({
      config: { userExtensionsDir: dir },
      settingUrl: CATALOG,
      discovery,
      logger: log,
      fetch: fetchFake,
    });
    await installer.ready();
    await installer.install('acme.theme');
    const found = await discoverExtensions({
      roots: [{ dir, origin: 'user' }],
      logger: log,
    });
    const holder = createDiscoveryHolder(found);
    const policy = createExtensionPolicy(holder, installer.revocationOf);
    const registry = createExtensionRegistry(
      holder,
      policy,
      installer.revocationOf,
    );

    // the other catalog revokes the same id: that is not about an install from the former one
    await installer.useCatalog(OTHER);
    await installer.catalog({ refresh: true });
    expect(registry.list()[0]).toMatchObject({
      state: 'loaded',
      revoked: null,
    });
    expect(policy.isEnabled('acme.theme')).toBe(true);

    // back to the former address: its revocation applies again
    formerRevokes = true;
    await installer.useCatalog(CATALOG);
    await installer.catalog({ refresh: true });
    expect(registry.list()[0]).toMatchObject({
      state: 'disabled',
      revoked: 'malware',
    });
    expect(policy.isEnabled('acme.theme')).toBe(false);
  });
});
