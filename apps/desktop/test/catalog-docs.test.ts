import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiscoveryHolder } from '@dolphy-app/extension-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopInstaller } from '../electron/host/installer.ts';
import {
  CATALOG_FIXTURES,
  E2E_APP_VERSION,
  startCatalogServer,
} from '../e2e/support/catalog-server.ts';
import type {
  CatalogServer,
  CatalogSource,
} from '../e2e/support/catalog-server.ts';

/**
 * Фикстуры e2e-каталога (`documented`, `hostile-readme`) и сервер каталога e2e против настоящего
 * установщика по HTTP: на них опирается страница расширения (e2e стадии 5b).
 */

const source = (dir: string, name: string): CatalogSource => ({
  dir: join(CATALOG_FIXTURES, dir),
  name,
  description: `${name}: фикстура`,
  author: 'acme',
});

const DOCUMENTED_OLD = source('documented-1.0.0', 'Documented');
const DOCUMENTED_NEW = source('documented-1.1.0', 'Documented');
const HOSTILE = source('hostile-readme', 'Hostile readme');
const SUNRISE = source('sunrise-1.0.0', 'Sunrise');

let dir: string;
let server: CatalogServer;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dolphy-catalog-docs-'));
  server = await startCatalogServer([
    DOCUMENTED_OLD,
    DOCUMENTED_NEW,
    HOSTILE,
    SUNRISE,
  ]);
});
afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

const open = () =>
  createDesktopInstaller({
    config: {
      userExtensionsDir: dir,
      extensionCatalogUrl: server.url,
      appVersion: E2E_APP_VERSION,
    },
    discovery: createDiscoveryHolder({
      extensions: [],
      overridden: [],
      diagnostics: [],
    }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

describe('фикстуры каталога с README и CHANGELOG.md', () => {
  it('запись каталога несёт версии, журнал изменений и совместимость', async () => {
    const installer = open();
    const entries = (await installer.catalog()).entries;
    const documented = entries.find((entry) => entry.id === 'acme.documented');
    expect(
      documented?.versions.map((v) => [
        v.version,
        v.compatible,
        v.hasChangelog,
      ]),
    ).toEqual([
      ['1.1.0', true, true],
      ['1.0.0', true, true],
    ]);
    const sunrise = entries.find((entry) => entry.id === 'acme.sunrise');
    expect(sunrise?.versions.map((v) => v.hasChangelog)).toEqual([false]);
  });

  it('docs и docImage берут файлы версии с сервера и кладут их в кэш', async () => {
    const installer = open();
    const docs = await installer.docs('acme.documented');
    expect(docs).toMatchObject({
      version: '1.1.0',
      source: 'catalog',
      truncated: false,
    });
    expect(docs.readme).toContain('![Снимок](docs/shot.png)');
    expect(docs.changelog).toContain('## [1.1.0] - 2026-10-01');
    const image = await installer.docImage(
      'acme.documented',
      '1.1.0',
      'docs/shot.png',
    );
    expect(image).toMatch(/^data:image\/png;base64,/);
    const before = server.requests.length;
    await installer.docs('acme.documented');
    await installer.docImage('acme.documented', '1.1.0', 'docs/shot.png');
    expect(
      server.requests.slice(before).filter((r) => r.includes('/extensions/')),
    ).toEqual([]);
  });

  it('после установки README читается с диска без обращения к серверу', async () => {
    const installer = open();
    await installer.install('acme.documented', '1.0.0');
    server.setOffline(true);
    const docs = await installer.docs('acme.documented');
    expect(docs).toMatchObject({ version: '1.0.0', source: 'installed' });
    expect(docs.changelog).toContain('Первая версия');
    expect(
      await installer.docImage('acme.documented', '1.0.0', 'docs/shot.png'),
    ).toMatch(/^data:image\/png/);
  });

  it('без сети то, что уже смотрели, берётся из кэша; остальное — ошибка сети', async () => {
    const installer = open();
    await installer.docs('acme.documented', '1.1.0');
    server.setOffline(true);
    const offline = open();
    await offline.checkForUpdates();
    expect(await offline.docs('acme.documented', '1.1.0')).toMatchObject({
      source: 'cache',
    });
    await expect(offline.docs('acme.hostile-readme')).rejects.toMatchObject({
      cause: 'network',
    });
  });

  it('подмена README на сервере — integrity', async () => {
    server.tamper('acme.hostile-readme', '1.0.0', 'README.md');
    await expect(open().docs('acme.hostile-readme')).rejects.toMatchObject({
      cause: 'integrity',
    });
  });
});

describe('сервер каталога: deprecated', () => {
  it('пометка попадает в запись индекса и снимается', async () => {
    server.deprecate('acme.sunrise', {
      versions: '<2.0.0',
      reason: 'Replaced by Documented',
      alternatives: ['acme.documented'],
    });
    const installer = open();
    const find = async () =>
      (await installer.catalog({ refresh: true })).entries.find(
        (entry) => entry.id === 'acme.sunrise',
      );
    expect((await find())?.deprecated).toEqual({
      versions: '<2.0.0',
      reason: 'Replaced by Documented',
      alternatives: [{ id: 'acme.documented', name: 'Documented' }],
    });
    expect(installer.deprecationOf('acme.sunrise', '1.0.0')?.reason).toBe(
      'Replaced by Documented',
    );
    server.undeprecate('acme.sunrise');
    expect((await find())?.deprecated).toBeNull();
    expect(installer.deprecationOf('acme.sunrise', '1.0.0')).toBeNull();
  });
});
