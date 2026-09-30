import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  seedCatalogInstall,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import {
  expectAttribute,
  expectCount,
  expectDisabled,
  expectText,
  expectVisible,
} from './support/locator.ts';

const fixture = (name: string) => join(CATALOG_FIXTURES, name);

const SUNRISE_1_0: CatalogSource = {
  dir: fixture('sunrise-1.0.0'),
  name: 'Sunrise',
  description: 'Тёплая светлая тема «Рассвет»',
  author: 'acme',
};
const SUNRISE_1_1: CatalogSource = {
  ...SUNRISE_1_0,
  dir: fixture('sunrise-1.1.0'),
};
const SUNSET: CatalogSource = {
  dir: fixture('sunset'),
  name: 'Sunset',
  description: 'Тёмная тема «Закат»',
  author: 'dana-k',
};
const FUTURE: CatalogSource = {
  dir: fixture('future'),
  name: 'Future',
  description: 'Тема для будущей версии приложения',
  author: 'acme',
};
const WINDOWS_ONLY: CatalogSource = {
  dir: fixture('windows-only'),
  name: 'Windows only',
  description: 'Тема только для другой платформы',
  author: 'acme',
  platforms: ['win32'],
};
const ECHO: CatalogSource = {
  dir: fileURLToPath(new URL('./fixtures/echo-extension', import.meta.url)),
  name: 'Echo',
  description: 'Вид заданий «эхо» для проверки',
  author: 'acme',
};

const SUNRISE_THEME = 'Рассвет';
const SUNRISE_NEW_THEME = 'Зарево';
const ID = 'acme.sunrise';

let server: CatalogServer | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

const launch = async (userData: string, catalogUrl: string) => {
  app = await launchApp(userData, catalogEnv(catalogUrl));
  return { client: new Client(app.page), catalog: new CatalogClient(app.page) };
};

const relaunch = async (userData: string, catalogUrl: string) => {
  await app?.close();
  app = null;
  return launch(userData, catalogUrl);
};

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const serve = async (...sources: CatalogSource[]) => {
  server = await startCatalogServer(sources);
  return server;
};

const extensionsDir = (userData: string) => join(userData, 'extensions');

beforeEach(async () => {
  workspace = await createWorkspace();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

describe('Настройки → Расширения → Каталог', () => {
  it('список, поиск без учёта регистра, фильтр по виду вклада; недоступное на платформе скрыто', async () => {
    const catalogServer = await serve(
      SUNRISE_1_0,
      SUNSET,
      FUTURE,
      WINDOWS_ONLY,
      ECHO,
    );
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    const all = await catalog.catalogNames();
    expect(all).toEqual(
      expect.arrayContaining(['Echo', 'Future', 'Sunrise', 'Sunset']),
    );
    if (process.platform !== 'win32') expect(all).not.toContain('Windows only');

    await catalog.search('ЗАКАТ');
    await expect.poll(() => catalog.catalogNames()).toEqual(['Sunset']);
    await catalog.search('dana-K');
    await expect.poll(() => catalog.catalogNames()).toEqual(['Sunset']);
    await catalog.search('');

    await catalog.toggleKind('Виды заданий');
    await expect.poll(() => catalog.catalogNames()).toEqual(['Echo']);
    await catalog.toggleKind('Виды заданий');
    await catalog.search('нет такого расширения');
    await expect
      .poll(() =>
        catalog.page
          .getByText('Ничего не найдено', { exact: false })
          .first()
          .isVisible(),
      )
      .toBe(true);
  });

  it('повторный запрос индекса идёт условным (ETag → 304)', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await catalog.refreshCatalog();
    await expect
      .poll(() => catalogServer.requests.includes('GET /index.json 304'))
      .toBe(true);
  });

  it('установка через диалог: разрешения видны, после перезагрузки тема на месте, метка «Из каталога»', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNSET);
    const { userData } = workspace!;
    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    await catalog.installButton(ID).click();
    await expectText(catalog.dialog, 'Sunrise');
    await expectText(catalog.dialog, '@acme');
    await expectText(catalog.dialog, 'Чтение библиотеки курсов');
    await expectText(catalog.dialog, 'Расширение будет работать в изоляции');
    await expectText(catalog.dialog, ID);

    await catalog.confirmInstall();
    await expectText(
      catalog.dialog,
      'Установлено. Чтобы расширение заработало, перезагрузите окно',
    );
    const installed = join(extensionsDir(userData), ID);
    expect(await readdir(installed)).toEqual(
      expect.arrayContaining(['extension.json', '.dolphy-install.json']),
    );
    const meta = JSON.parse(
      await readFile(join(installed, '.dolphy-install.json'), 'utf8'),
    );
    expect(meta).toMatchObject({
      catalogUrl: catalogServer.url,
      version: '1.0.0',
    });

    await catalog.applyFromDialog();
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(true);

    await client.openSettingsExtensions();
    const row = await catalog.installedText(ID);
    expect(row).toContain('Из каталога v1.0.0');
    expect(row).toContain('@acme');
    expect(row).toContain('Тёплая светлая тема');
    await catalog.openCatalogTab();
    await expectText(catalog.catalogCard(ID), 'Установлено v1.0.0');
  });

  it('«Позже» оставляет сообщение на вкладке «Установленные» до перезагрузки', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await catalog.installButton(ID).click();
    await catalog.confirmInstall();
    await catalog.postpone();

    await catalog.openInstalledTab();
    await expectText(
      catalog.page.getByTestId('extensions-apply'),
      'Изменения вступят в силу после перезагрузки',
    );
    await catalog.applyFromBanner();
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(true);
  });

  it('обновление: запуск показывает «Доступно обновлений: 1», «Обновить» ставит новую версию', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: ID,
      dir: SUNRISE_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    await catalogServer.publish(SUNRISE_1_1);

    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(true);

    await client.openSettingsExtensions();
    await expectText(catalog.updatesBanner(), 'Доступно обновлений: 1');
    await catalog.updateFromRow(ID);
    await expectText(catalog.dialog, 'v1.0.0 → v1.1.0');
    await catalog.confirmInstall();
    await catalog.applyFromDialog();

    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_NEW_THEME)).toBe(true);
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(false);
    await client.openSettingsExtensions();
    expect(await catalog.installedText(ID)).toContain('Из каталога v1.1.0');
    await expectCount(catalog.updatesBanner(), 0);
  });

  it('обновление каталога после перезапуска показывает новую версию на карточке и баннер', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { userData } = workspace!;
    let ui = await launch(userData, catalogServer.url);
    await ui.client.openSettingsExtensions();
    await ui.catalog.openCatalogTab();
    await ui.catalog.installButton(ID).click();
    await ui.catalog.confirmInstall();
    await ui.catalog.applyFromDialog();

    await catalogServer.publish(SUNRISE_1_1);
    ui = await relaunch(userData, catalogServer.url);
    await ui.client.openSettingsExtensions();
    await ui.catalog.openCatalogTab();
    await ui.catalog.refreshCatalog();
    await expectText(ui.catalog.catalogCard(ID), 'Обновить до v1.1.0');

    await ui.catalog.openInstalledTab();
    await expectText(ui.catalog.updatesBanner(), 'Доступно обновлений: 1');
  });

  it('несовместимое расширение: кнопка отключена, причина из движка', async () => {
    const catalogServer = await serve(FUTURE, SUNRISE_1_0);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    const card = catalog.catalogCard('acme.future');
    await expectDisabled(
      card.getByRole('button', { name: /^Установить/ }),
      true,
    );
    await expectText(card, 'Несовместимо: requires app >= 99.0.0');
    await expectDisabled(catalog.installButton(ID), false);
  });

  it('удаление: каталог расширения исчезает, строка и тема пропадают после перезагрузки', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: ID,
      dir: SUNRISE_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(true);

    await client.openSettingsExtensions();
    await catalog.openRemoveDialog(ID);
    await expectText(
      catalog.dialog,
      'Данные расширения, ваши курсы и прогресс не затрагиваются',
    );
    await catalog.confirmRemove();

    expect(await exists(join(extensionsDir(userData), ID))).toBe(false);
    await expectText(catalog.installedRow(ID), 'Удалено');
    await catalog.applyFromBanner();

    await client.openSettingsExtensions();
    await expectCount(catalog.installedRow(ID), 0);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(false);
  });

  it('расширения из поставки удалить нельзя', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.installedText('dolphy.sql');
    await expectCount(
      catalog
        .installedRow('dolphy.sql')
        .getByRole('button', { name: /^Удалить/ }),
      0,
    );
  });
});

describe('Каталог без связи', () => {
  it('сервер остановлен: показан сохранённый каталог, установленное работает', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNSET);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: ID,
      dir: SUNRISE_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    let ui = await launch(userData, catalogServer.url);
    await ui.client.openSettingsExtensions();
    await ui.catalog.openCatalogTab();
    await expectVisible(ui.catalog.catalogCard('acme.sunset'));
    // индекс дописывается в кэш на диск после ответа: ждём файл
    await expect
      .poll(() =>
        exists(join(extensionsDir(userData), '.catalog', 'index.json')),
      )
      .toBe(true);

    await catalogServer.close();
    ui = await relaunch(userData, catalogServer.url);
    await ui.client.openSettingsExtensions();
    await ui.catalog.openCatalogTab();
    await ui.catalog.refreshCatalog();

    await expectText(
      ui.catalog.page.getByTestId('catalog-offline'),
      'Нет связи с каталогом. Показаны сохранённые данные',
    );
    await expectVisible(ui.catalog.catalogCard('acme.sunset'));

    await ui.client.openSettingsAppearance();
    expect(await ui.client.themeTileExists(SUNRISE_THEME)).toBe(true);
  });

  it('свежий профиль и каталог недоступен: состояние ошибки, «Повторить» работает', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    catalogServer.setOffline(true);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    const failure = catalog.page.getByTestId('catalog-unavailable');
    await expectText(failure, 'Каталог недоступен');
    await failure.getByRole('button', { name: 'Повторить' }).click();
    await expectVisible(failure);

    catalogServer.setOffline(false);
    await failure.getByRole('button', { name: 'Повторить' }).click();
    await expectVisible(catalog.catalogCard(ID));
    await expectCount(failure, 0);
  });
});

describe('Отзыв и целостность', () => {
  it('отозванная версия: предупреждение в строке, переключателей нет, тема пропадает после перезапуска', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNRISE_1_1);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: ID,
      dir: SUNRISE_1_1.dir,
      version: '1.1.0',
      catalogUrl: catalogServer.url,
    });
    catalogServer.revoke(ID, '<1.2.0', 'утечка токенов');

    await launch(userData, catalogServer.url);
    // индекс с отзывом попадает в кэш на диске и читается при следующем запуске
    await expect
      .poll(async () => {
        const cache = join(extensionsDir(userData), '.catalog', 'index.json');
        return (
          (await exists(cache)) &&
          (await readFile(cache, 'utf8')).includes('утечка токенов')
        );
      })
      .toBe(true);

    const ui = await relaunch(userData, catalogServer.url);
    await ui.client.openSettingsExtensions();
    const row = ui.catalog.installedRow(ID);
    await expectText(row.getByTestId('revoked'), 'Расширение отозвано');
    await expectText(row.getByTestId('revoked'), 'утечка токенов');
    expect(await ui.catalog.installedSwitchCount(ID)).toBe(0);

    await ui.client.openSettingsAppearance();
    expect(await ui.client.themeTileExists(SUNRISE_NEW_THEME)).toBe(false);
  });

  it('подменённый файл: установка отклонена по целостности, на диске ничего не осталось', async () => {
    const catalogServer = await serve(ECHO, SUNRISE_1_0);
    catalogServer.tamper('acme.echo', '1.0.0', 'main.mjs');
    const { userData } = workspace!;
    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await catalog.installButton('acme.echo').click();
    await catalog.confirmInstall();

    const failure = catalog.dialog.getByTestId('install-error');
    await expectText(failure, 'не прошли проверку целостности');
    await expectAttribute(failure, 'data-reason', 'integrity');
    await expectCount(
      catalog.dialog.getByRole('button', { name: 'Повторить' }),
      0,
    );
    expect(await exists(join(extensionsDir(userData), 'acme.echo'))).toBe(
      false,
    );

    await catalog.dialog.getByRole('button', { name: 'Закрыть' }).click();
    await catalog.openInstalledTab();
    await expectCount(catalog.installedRow('acme.echo'), 0);
    await expectCount(catalog.page.getByTestId('extensions-apply'), 0);
  });
});
