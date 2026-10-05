import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator } from 'playwright-core';
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
const PICTURED: CatalogSource = {
  dir: fixture('pictured'),
  name: 'Pictured',
  description: 'Тема с ресурсами и значком',
  author: 'acme',
};
const ECHO: CatalogSource = {
  dir: fileURLToPath(new URL('./fixtures/echo-extension', import.meta.url)),
  name: 'Echo',
  description: 'Вид заданий «эхо» для проверки',
  author: 'acme',
};

const STATE: CatalogSource = {
  dir: fileURLToPath(new URL('./fixtures/state-extension', import.meta.url)),
  name: 'State',
  description: 'Настройки и события обучения',
  author: 'acme',
};
const COMMANDS: CatalogSource = {
  dir: fileURLToPath(new URL('./fixtures/commands-extension', import.meta.url)),
  name: 'Commands',
  description: 'Команды и панель для проверки',
  author: 'acme',
};
/** Единственная тема, название которой совпадает с названием расширения. */
const SUNSET_SAME_NAME: CatalogSource = { ...SUNSET, name: 'Закат' };

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

/** Каталог без `index.v2.json`: на него 404, `index.json` сервер не отдаёт. */
const serveWithoutIndex = async (...sources: CatalogSource[]) => {
  server = await startCatalogServer(sources, { publishIndex: false });
  return server;
};

/** Значок показан и загружен: `<img>` с `data:`-адресом и ненулевой натуральной шириной. */
const expectLoadedIcon = async (image: Locator) => {
  await expect
    .poll(() => image.first().getAttribute('src'), { timeout: 30_000 })
    .toMatch(/^data:image\/png;base64,/);
  await expect
    .poll(
      () =>
        image
          .first()
          .evaluate((element: HTMLImageElement) =>
            element.complete ? element.naturalWidth : 0,
          ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  expect(await image.first().getAttribute('alt')).toBe('');
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
      .poll(() => catalogServer.requests.includes('GET /index.v2.json 304'))
      .toBe(true);
  });

  it('установка через диалог: разрешения видны, тема появляется без перезагрузки окна, метка «Из каталога»', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNSET);
    const { userData } = workspace!;
    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(false);
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    const stillSameWindow = await client.markWindow();

    await catalog.installButton(ID).click();
    await expectText(catalog.dialog, 'Sunrise');
    await expectText(catalog.dialog, '@acme');
    await expectText(catalog.dialog, 'Чтение библиотеки курсов');
    await expectText(catalog.dialog, 'Расширение будет работать в изоляции');
    await expectText(catalog.dialog, ID);

    await catalog.confirmInstall();
    await expectText(catalog.dialog, 'Установлено. Расширение уже работает.');
    // диалог не предлагает перезагрузку, баннеров нет
    await expectCount(
      catalog.dialog.getByRole('button', { name: /Перезагрузить/ }),
      0,
    );
    await expectCount(catalog.page.getByTestId('extensions-reload'), 0);
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

    await catalog.closeDialog();
    await client.openSettingsAppearance();
    await expect.poll(() => client.themeTileExists(SUNRISE_THEME)).toBe(true);

    await client.openSettingsExtensions();
    const row = await catalog.installedText(ID);
    expect(row).toContain('Из каталога v1.0.0');
    expect(row).toContain('@acme');
    expect(row).toContain('Тёплая светлая тема');
    expect(row).not.toContain('после перезагрузки');
    await catalog.openCatalogTab();
    await expectText(catalog.catalogCard(ID), 'Установлено v1.0.0');
    await stillSameWindow();
  });

  it('две установки подряд: обе действуют без перезагрузки, остальное окно не мигает', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNSET);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    const stillSameWindow = await client.markWindow();

    await catalog.installButton(ID).click();
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await catalog.installButton('acme.sunset').click();
    await catalog.confirmInstall();
    await catalog.closeDialog();

    await client.openSettingsAppearance();
    await expect.poll(() => client.themeTileExists(SUNRISE_THEME)).toBe(true);
    await expect.poll(() => client.themeTileExists('Закат')).toBe(true);
    await stillSameWindow();
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
    const stillSameWindow = await client.markWindow();
    await expectText(catalog.updatesBanner(), 'Доступно обновлений: 1');
    await catalog.updateFromRow(ID);
    await expectText(catalog.dialog, 'v1.0.0 → v1.1.0');
    await catalog.confirmInstall();
    await catalog.closeDialog();

    await client.openSettingsAppearance();
    await expect
      .poll(() => client.themeTileExists(SUNRISE_NEW_THEME))
      .toBe(true);
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(false);
    await client.openSettingsExtensions();
    expect(await catalog.installedText(ID)).toContain('Из каталога v1.1.0');
    await expectCount(catalog.updatesBanner(), 0);
    await stillSameWindow();
  });

  it('обновление каталога после перезапуска показывает новую версию на карточке и баннер', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { userData } = workspace!;
    let ui = await launch(userData, catalogServer.url);
    await ui.client.openSettingsExtensions();
    await ui.catalog.openCatalogTab();
    await ui.catalog.installButton(ID).click();
    await ui.catalog.confirmInstall();
    await ui.catalog.closeDialog();

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

  it('удаление: каталог расширения исчезает, строка и тема пропадают без перезагрузки окна', async () => {
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
    const stillSameWindow = await client.markWindow();
    await catalog.openRemoveDialog(ID);
    await expectText(catalog.dialog, 'Ваши курсы и прогресс не затрагиваются');
    await catalog.confirmRemove();

    expect(await exists(join(extensionsDir(userData), ID))).toBe(false);
    await expectCount(catalog.installedRow(ID), 0);
    await expectCount(catalog.page.getByTestId('extensions-reload'), 0);
    await client.openSettingsAppearance();
    await expect.poll(() => client.themeTileExists(SUNRISE_THEME)).toBe(false);
    await stillSameWindow();
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
        exists(join(extensionsDir(userData), '.catalog', 'index.v2.json')),
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
        const cache = join(
          extensionsDir(userData),
          '.catalog',
          'index.v2.json',
        );
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
    await expectCount(catalog.page.getByTestId('extensions-reload'), 0);
  });

  it('значок и ресурсы: значок виден на карточке, в диалоге и в списке установленных, файлы версии лежат байт в байт', async () => {
    const catalogServer = await serve(PICTURED, SUNRISE_1_0);
    const { userData } = workspace!;
    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    // каталог читается из полного индекса: index.json не запрашивался
    expect(catalogServer.requests).toContain('GET /index.v2.json');
    expect(catalogServer.requests).not.toContain('GET /index.json');
    await expectLoadedIcon(
      catalog.catalogCard('acme.pictured').getByTestId('extension-icon'),
    );
    await expectCount(catalog.catalogCard(ID).getByTestId('extension-icon'), 0);

    await catalog.installButton('acme.pictured').click();
    await expectLoadedIcon(catalog.dialog.getByTestId('extension-icon'));
    await catalog.confirmInstall();
    await expectText(catalog.dialog, 'Установлено. Расширение уже работает.');
    await catalog.closeDialog();

    await catalog.openInstalledTab();
    await expectLoadedIcon(
      catalog.installedRow('acme.pictured').getByTestId('extension-icon'),
    );

    const installed = join(extensionsDir(userData), 'acme.pictured');
    for (const file of ['icon.png', 'logo.png', 'font.woff2', 'panel.css']) {
      expect(await readFile(join(installed, 'assets', file))).toEqual(
        await readFile(join(PICTURED.dir, 'assets', file)),
      );
    }
    const meta = JSON.parse(
      await readFile(join(installed, '.dolphy-install.json'), 'utf8'),
    );
    expect(meta.catalogUrl).toBe(catalogServer.url);
  });

  it('каталог без index.v2.json недоступен: на index.json запрос не уходит', async () => {
    const catalogServer = await serveWithoutIndex(SUNRISE_1_0);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    await expectText(
      catalog.page.getByTestId('catalog-unavailable'),
      'Каталог недоступен',
    );
    expect(catalogServer.requests).toContain('GET /index.v2.json 404');
    expect(catalogServer.requests).not.toContain('GET /index.json');
  });
});

describe('Каталог: группы, теги и названия вкладов', () => {
  it('группы с числами, «Ещё фильтры», теги и виды: «или» в ряду, «и» между рядами и с поиском', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNSET, FUTURE, ECHO, STATE);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    // Sunset — явные теги, остальные темы — по вкладам; Echo и State — «Обучение»
    await expectVisible(catalog.groupChip('Оформление и интерфейс'));
    await expectCount(catalog.groupChip('Оформление и интерфейс'), 1);
    expect(
      await catalog
        .groupChip('Оформление и интерфейс')
        .getAttribute('aria-label'),
    ).toBe('Оформление и интерфейс: 3');
    expect(await catalog.groupChip('Обучение').getAttribute('aria-label')).toBe(
      'Обучение: 2',
    );
    // пустая группа скрыта
    await expectCount(catalog.groupChip('Для разработчиков'), 0);

    // «Ещё фильтры» свёрнуты: чипов видов и тегов не видно
    await expectAttribute(
      catalog.moreFiltersButton(),
      'aria-expanded',
      'false',
    );
    await expectCount(
      catalog.page.getByRole('button', { name: 'Виды заданий', exact: true }),
      0,
    );

    await catalog.toggleGroup('Оформление и интерфейс');
    await expectAttribute(
      catalog.groupChip('Оформление и интерфейс'),
      'aria-pressed',
      'true',
    );
    await expect
      .poll(() => catalog.catalogNames())
      .toEqual(['Future', 'Sunrise', 'Sunset']);
    await expectText(catalog.foundStatus(), 'Найдено: 3 расширения');
    // число не прыгает при выборе другого ряда или группы
    expect(await catalog.groupChip('Обучение').getAttribute('aria-label')).toBe(
      'Обучение: 2',
    );

    // «или» внутри ряда групп
    await catalog.toggleGroup('Обучение');
    await expect.poll(() => catalog.catalogNames()).toHaveLength(5);
    await catalog.toggleGroup('Обучение');

    // ряд тегов: «и» с группой (Оформление ∧ тег «Обучение» — никого)
    await catalog.openMoreFilters();
    await expectAttribute(catalog.moreFiltersButton(), 'aria-expanded', 'true');
    // теги — только присутствующие в каталоге
    await expectCount(catalog.tagChip('Разработчикам'), 0);
    await catalog.toggleTag('Обучение');
    await expect.poll(() => catalog.catalogNames()).toEqual([]);
    await catalog.toggleTag('Обучение');
    await catalog.toggleGroup('Оформление и интерфейс');

    // «или» внутри ряда тегов
    await catalog.toggleTag('Тема');
    await expect.poll(() => catalog.catalogNames()).toHaveLength(3);
    await catalog.toggleTag('Обучение');
    await expect.poll(() => catalog.catalogNames()).toHaveLength(5);
    await catalog.toggleTag('Обучение');
    await catalog.toggleTag('Тема');

    // вид вклада «и» с группой
    await catalog.toggleKind('Виды заданий');
    await expect.poll(() => catalog.catalogNames()).toEqual(['Echo', 'State']);
    await catalog.toggleGroup('Оформление и интерфейс');
    await expect.poll(() => catalog.catalogNames()).toEqual([]);
    await expectText(catalog.foundStatus(), 'ничего не найдено');
    await catalog.toggleGroup('Оформление и интерфейс');

    // поиск «и» с чипами; числа следуют за поиском
    await catalog.search('закат');
    await expect.poll(() => catalog.catalogNames()).toEqual([]);
    await catalog.toggleKind('Виды заданий');
    await expect.poll(() => catalog.catalogNames()).toEqual(['Sunset']);
    await expectCount(catalog.groupChip('Обучение'), 0);
    expect(
      await catalog
        .groupChip('Оформление и интерфейс')
        .getAttribute('aria-label'),
    ).toBe('Оформление и интерфейс: 1');
  });

  it('«Ещё фильтры» раскрыты, пока выбран тег или вид, и остаются раскрытыми после снятия; клавиатура переключает чипы', async () => {
    const catalogServer = await serve(SUNRISE_1_0, ECHO);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    await catalog.openMoreFilters();
    await catalog.toggleKind('Темы');
    await expectDisabled(catalog.moreFiltersButton(), true);
    await expectAttribute(catalog.moreFiltersButton(), 'aria-expanded', 'true');
    await catalog.toggleKind('Темы');
    await expectDisabled(catalog.moreFiltersButton(), false);
    await expectAttribute(catalog.moreFiltersButton(), 'aria-expanded', 'true');
    await catalog.moreFiltersButton().click();
    await expectAttribute(
      catalog.moreFiltersButton(),
      'aria-expanded',
      'false',
    );

    // Space и Enter переключают чип группы, фокус остаётся на нём
    const chip = catalog.groupChip('Обучение');
    await chip.focus();
    await catalog.page.keyboard.press('Space');
    await expectAttribute(chip, 'aria-pressed', 'true');
    await expect.poll(() => catalog.catalogNames()).toEqual(['Echo']);
    await catalog.page.keyboard.press('Enter');
    await expectAttribute(chip, 'aria-pressed', 'false');
    await expect.poll(() => catalog.catalogNames()).toHaveLength(2);
    expect(
      await chip.evaluate((element) => element === document.activeElement),
    ).toBe(true);
  });

  it('чипы вкладов показывают названия, а не id; события — по-русски; единственная тема с названием расширения не повторяется', async () => {
    const catalogServer = await serve(
      SUNRISE_1_0,
      STATE,
      COMMANDS,
      SUNSET_SAME_NAME,
    );
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    const point = (id: string, name: string) =>
      catalog.catalogCard(id).locator(`[data-point="${name}"]`);

    const themes = point(ID, 'themes');
    await expectText(themes, SUNRISE_THEME);
    expect(await themes.innerText()).not.toContain(ID);
    // id остаётся подсказкой
    expect(
      await themes
        .locator('.v-chip', { hasText: SUNRISE_THEME })
        .getAttribute('title'),
    ).toBe(ID);

    const commands = point('acme.commands', 'commands');
    await expectText(commands, 'Поприветствовать');
    expect(await commands.innerText()).not.toContain('acme.commands.greet');
    await expectText(point('acme.commands', 'panels'), 'Приветствия');

    const events = point('acme.state', 'events');
    await expectText(events, 'Начало занятия');
    await expectText(events, 'Конец занятия');
    await expectText(events, 'Закрытие попытки');
    expect(await events.innerText()).not.toContain('session.started');
    await expectText(point('acme.state', 'settings'), 'Приветствие');
    // виды заданий — идентификатор моноширинно
    await expectText(point('acme.state', 'exerciseTypes'), 'acme.state');

    // карточка уже называется «Закат»: строка с той же единственной темой не нужна
    await expectVisible(catalog.catalogCard('acme.sunset'));
    await expectCount(point('acme.sunset', 'themes'), 0);
  });

  it('диалог установки и список установленных показывают названия и теги', async () => {
    const catalogServer = await serve(SUNSET);
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    const card = catalog.catalogCard('acme.sunset');
    await expectText(card.locator('[data-point="tags"]'), 'Тема');
    await expectText(card.locator('[data-point="themes"]'), 'Закат');

    await catalog.installButton('acme.sunset').click();
    await expectText(
      catalog.dialog.locator('[data-point="tags"]'),
      'Интерфейс',
    );
    await expectText(catalog.dialog.locator('[data-point="themes"]'), 'Закат');
    await catalog.confirmInstall();
    await catalog.closeDialog();

    await catalog.openInstalledTab();
    const row = catalog.installedRow('acme.sunset');
    await expectText(row.locator('[data-point="themes"]'), 'Закат');
    await expectText(row.locator('[data-point="tags"]'), 'Тема');
    await expectText(row.locator('[data-point="tags"]'), 'Интерфейс');
  });
});
