import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { runAxe } from './support/axe.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  seedCatalogInstall,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const fixture = (name: string) => join(CATALOG_FIXTURES, name);

const DOCUMENTED_1_0: CatalogSource = {
  dir: fixture('documented-1.0.0'),
  name: 'Documented',
  description: 'Тема с README и журналом изменений',
  author: 'acme',
};
const DOCUMENTED_1_1: CatalogSource = {
  ...DOCUMENTED_1_0,
  dir: fixture('documented-1.1.0'),
};
const HOSTILE: CatalogSource = {
  dir: fixture('hostile-readme'),
  name: 'Hostile readme',
  description: 'Тема с враждебным README',
  author: 'mallory',
};
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

const DOCUMENTED = 'acme.documented';
const HOSTILE_ID = 'acme.hostile-readme';
const SUNRISE = 'acme.sunrise';
const TIMEOUT = 30_000;

let server: CatalogServer | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

interface Ui {
  page: Page;
  client: Client;
  catalog: CatalogClient;
}

const launch = async (userData: string, catalogUrl: string): Promise<Ui> => {
  app = await launchApp(userData, catalogEnv(catalogUrl));
  return {
    page: app.page,
    client: new Client(app.page),
    catalog: new CatalogClient(app.page),
  };
};

const serve = async (...sources: CatalogSource[]) => {
  server = await startCatalogServer(sources);
  return server;
};

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

const details = (page: Page) => page.getByTestId('extension-details');
const readme = (page: Page) =>
  page.getByTestId('details-readme').getByTestId('readme-body');

/** Со вкладки «Каталог» на страницу расширения. */
const openFromCatalog = async ({ client, catalog, page }: Ui, id: string) => {
  await client.openSettingsExtensions();
  await catalog.openCatalogTab();
  await catalog.catalogCard(id).getByTestId(`details-${id}`).click();
  await details(page).waitFor({ timeout: TIMEOUT });
};

describe('Страница расширения', () => {
  it('с карточки: сведения, README с картинкой, версии и «Что нового»; выбор версии; «Назад» на вкладку каталога', async () => {
    const catalogServer = await serve(DOCUMENTED_1_0);
    await catalogServer.publish(DOCUMENTED_1_1);
    const ui = await launch(workspace!.userData, catalogServer.url);
    const { page } = ui;
    await openFromCatalog(ui, DOCUMENTED);

    await expectText(page.getByRole('heading', { level: 2 }), 'Documented');
    await expectText(details(page), DOCUMENTED);
    await expectText(details(page), 'Тема с README и журналом изменений');
    const author = page.getByTestId('details-author');
    expect(await author.getAttribute('href')).toBe('https://github.com/acme');
    expect(await author.getAttribute('target')).toBe('_blank');
    expect(await author.getAttribute('rel')).toBe('noopener noreferrer');
    expect(await page.getByTestId('details-source').getAttribute('href')).toBe(
      `https://example.test/extensions/${DOCUMENTED}`,
    );

    // README: заголовок сдвинут под заголовки страницы, список, внешняя ссылка и картинка из версии
    await expectText(readme(page), 'первый пункт');
    expect(await readme(page).locator('h4').innerText()).toBe('Documented');
    const link = readme(page).getByRole('link', { name: 'Сайт проекта' });
    expect(await link.getAttribute('href')).toBe(
      'https://example.com/documented',
    );
    expect(await link.getAttribute('target')).toBe('_blank');
    expect(await link.getAttribute('rel')).toBe('noopener noreferrer');
    const image = readme(page).locator('img[data-src="docs/shot.png"]');
    await expect
      .poll(() => image.getAttribute('src'), { timeout: TIMEOUT })
      .toMatch(/^data:image\/png;base64,/);
    await expect
      .poll(
        () =>
          image.evaluate((element: HTMLImageElement) =>
            element.complete ? element.naturalWidth : 0,
          ),
        { timeout: TIMEOUT },
      )
      .toBeGreaterThan(0);

    // версии и журнал изменений новейшей версии
    await expectVisible(page.getByTestId('version-1.1.0'));
    await expectVisible(page.getByTestId('version-1.0.0'));
    await expectText(page.getByTestId('version-1.1.0'), 'Показано описание');
    await expectText(
      page.getByTestId('details-changelog'),
      'Добавлена тёмная подсветка',
    );

    // другая версия: адрес хранит выбор, README и журнал — этой версии
    await page.getByTestId('version-show-1.0.0').click();
    await expectText(page.getByTestId('version-1.0.0'), 'Показано описание');
    expect(page.url()).toContain('version=1.0.0');
    await expectText(page.getByTestId('details-changelog'), 'Первая версия');
    expect(
      await page.getByTestId('details-changelog').innerText(),
    ).not.toContain('Добавлена тёмная подсветка');
    await expectText(page.getByTestId('details-readme'), 'v1.0.0');

    await page.getByTestId('details-back').click();
    await expectVisible(ui.catalog.catalogCard(DOCUMENTED));
  });

  it('со строки установленного: возврат на вкладку «Установленные»; установка и удаление со страницы', async () => {
    const catalogServer = await serve(DOCUMENTED_1_0);
    const ui = await launch(workspace!.userData, catalogServer.url);
    const { page, catalog } = ui;
    await openFromCatalog(ui, DOCUMENTED);

    await page.getByTestId(`install-${DOCUMENTED}`).click();
    await expectText(catalog.dialog, 'Установить «Documented»?');
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await expectVisible(page.getByTestId(`installed-${DOCUMENTED}`));
    await expectText(details(page), 'Из каталога v1.0.0');

    await page.getByTestId('details-back').click();
    await ui.client.openSettingsExtensions();
    await catalog.openInstalledTab();
    await catalog
      .installedRow(DOCUMENTED)
      .getByTestId(`details-${DOCUMENTED}`)
      .click();
    await details(page).waitFor({ timeout: TIMEOUT });
    // README установленной версии читается из каталога расширения, без сети
    await expectText(readme(page), 'первый пункт');
    await page.getByTestId('details-back').click();
    await catalog.installedRow(DOCUMENTED).waitFor({ timeout: TIMEOUT });

    await catalog
      .installedRow(DOCUMENTED)
      .getByTestId(`details-${DOCUMENTED}`)
      .click();
    await details(page).waitFor({ timeout: TIMEOUT });
    await page.getByTestId(`remove-${DOCUMENTED}`).click();
    await catalog.confirmRemove();
    await expectVisible(page.getByTestId(`install-${DOCUMENTED}`));
    await expectCount(page.getByTestId(`remove-${DOCUMENTED}`), 0);
  });

  it('расширение вне каталога (скопировано вручную): страница без каталожных блоков', async () => {
    const catalogServer = await serve(SUNSET);
    await workspace?.dispose();
    workspace = await createWorkspace({
      extensions: { [SUNRISE]: SUNRISE_1_0.dir },
    });
    const { page, client, catalog } = await launch(
      workspace.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.installedRow(SUNRISE).waitFor({ timeout: TIMEOUT });
    await catalog
      .installedRow(SUNRISE)
      .getByTestId(`details-${SUNRISE}`)
      .click();
    await details(page).waitFor({ timeout: TIMEOUT });
    await expectText(details(page), SUNRISE);
    await expectCount(page.getByTestId('details-versions'), 0);
    await expectCount(page.getByTestId('details-source'), 0);
    await expectCount(page.getByTestId(`install-${SUNRISE}`), 0);
    await expectVisible(page.getByTestId(`remove-${SUNRISE}`));
    await expectVisible(page.getByTestId('readme-none'));
  });

  it('несуществующий id: сообщение и «Назад»', async () => {
    const catalogServer = await serve(SUNSET);
    const { page, client } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await page.evaluate(() => {
      location.hash = '#/settings/extensions/acme.nothing';
    });
    await expectText(
      page.getByTestId('details-not-found'),
      'Расширения «acme.nothing» нет',
    );
    await page.getByTestId('details-back').click();
    await expectVisible(
      page.getByTestId('extension-details').or(page.getByRole('list')),
    );
  });
});

describe('README безопасен', () => {
  it('враждебный README: ни скриптов, ни сетевых запросов, ни чужих картинок; из ссылок живёт только https', async () => {
    const catalogServer = await serve(HOSTILE);
    const ui = await launch(workspace!.userData, catalogServer.url);
    const { page } = ui;
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openFromCatalog(ui, HOSTILE_ID);

    const image = readme(page).locator('img[data-src="docs/shot.png"]');
    await expect
      .poll(() => image.getAttribute('src'), { timeout: TIMEOUT })
      .toMatch(/^data:image\/png;base64,/);
    // файл версии с допустимым путём, которого нет, заменяется своим alt
    await expectText(readme(page), 'missing');
    await expectCount(readme(page).locator('img'), 1);

    expect(
      await page.evaluate(() => [
        Reflect.get(globalThis, '__readmeScript'),
        Reflect.get(globalThis, '__readmeOnerror'),
        Reflect.get(globalThis, '__readmeLink'),
      ]),
    ).toEqual([undefined, undefined, undefined]);
    await expectCount(readme(page).locator('script'), 0);
    // сырой HTML виден текстом
    await expectText(readme(page), '<script>');
    expect(
      await readme(page)
        .locator('a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
    ).toEqual(['https://example.com/docs']);
    // остальные «ссылки», картинки вне версии и внешние — текстом alt
    for (const text of ['click', 'relative', 'external', 'inline']) {
      await expectText(readme(page), text);
    }

    // клик по тексту «ссылки» никуда не ведёт
    const hash = await page.evaluate(() => location.hash);
    await readme(page).getByText('click', { exact: false }).first().click();
    expect(await page.evaluate(() => location.hash)).toBe(hash);

    // из окна не ушло ни одного сетевого запроса (картинка идёт через движок как data:)
    expect(requests.filter((url) => /^https?:/.test(url))).toEqual([]);
    expect(requests.filter((url) => url.includes('evil.example'))).toEqual([]);
  });
});

describe('README без связи с каталогом', () => {
  it('кэш: страница показывает сохранённый README с пометкой; без кэша — «README недоступен» и «Повторить»', async () => {
    const catalogServer = await serve(DOCUMENTED_1_0, HOSTILE);
    const ui = await launch(workspace!.userData, catalogServer.url);
    const { page, catalog } = ui;
    await openFromCatalog(ui, DOCUMENTED);
    await expectText(readme(page), 'первый пункт');
    await expectCount(page.getByTestId('readme-offline'), 0);
    await page.getByTestId('details-back').click();

    catalogServer.setOffline(true);
    await catalog.refreshCatalog();
    await expectVisible(page.getByTestId('catalog-offline'));
    await catalog
      .catalogCard(DOCUMENTED)
      .getByTestId(`details-${DOCUMENTED}`)
      .click();
    await expectText(readme(page), 'первый пункт');
    await expectText(
      page.getByTestId('readme-offline'),
      'Без связи с каталогом: показаны сохранённые данные',
    );
    // остальное на странице работает
    await expectVisible(page.getByTestId(`install-${DOCUMENTED}`));
    await page.getByTestId('details-back').click();

    // README этого расширения ещё не скачивали
    await catalog
      .catalogCard(HOSTILE_ID)
      .getByTestId(`details-${HOSTILE_ID}`)
      .click();
    await expectText(
      page.getByTestId('readme-unavailable'),
      'README недоступен',
    );
    await expectVisible(page.getByTestId(`install-${HOSTILE_ID}`));

    catalogServer.setOffline(false);
    await page.getByTestId('readme-retry').click();
    await expectText(readme(page), 'Hostile');
    await expectCount(page.getByTestId('readme-unavailable'), 0);
  });
});

describe('«Что нового» при обновлении', () => {
  it('диалог показывает разделы новее установленной версии и не новее целевой', async () => {
    const catalogServer = await serve(DOCUMENTED_1_0);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: DOCUMENTED,
      dir: DOCUMENTED_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    await catalogServer.publish(DOCUMENTED_1_1);
    const { client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsExtensions();
    await expectText(catalog.updatesBanner(), 'Доступно обновлений: 1');
    await catalog.updateFromRow(DOCUMENTED);

    const notes = catalog.dialog.getByTestId('whats-new');
    await expectText(notes, 'Добавлена тёмная подсветка');
    await expectText(notes, 'Исправлен контраст ссылок');
    // раздел установленной версии не входит
    expect(await notes.innerText()).not.toContain('Первая версия');
    await expectCount(notes.getByTestId('whats-new-section'), 1);
    await catalog.confirmInstall();
  });

  it('без журнала: «Описание изменений не найдено» и ссылка на страницу расширения', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: SUNRISE,
      dir: SUNRISE_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    await catalogServer.publish(SUNRISE_1_1);
    const { page, client, catalog } = await launch(userData, catalogServer.url);
    await client.openSettingsExtensions();
    await catalog.updateFromRow(SUNRISE);

    await expectText(
      catalog.dialog.getByTestId('whats-new-empty'),
      'Описание изменений не найдено',
    );
    await catalog.dialog.getByTestId('whats-new-page').click();
    await details(page).waitFor({ timeout: TIMEOUT });
    await catalog.dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
    expect(page.url()).toContain(`/settings/extensions/${SUNRISE}`);
    expect(page.url()).toContain('version=1.1.0');
  });
});

describe('Устаревшие расширения', () => {
  it('предупреждение в карточке, диалоге, странице и строке; установка разрешена, статус и обновления не меняются', async () => {
    const catalogServer = await serve(SUNRISE_1_0, SUNSET);
    catalogServer.deprecate(SUNRISE, {
      versions: null,
      reason: 'Superseded by Sunset',
      alternatives: ['acme.sunset'],
    });
    const ui = await launch(workspace!.userData, catalogServer.url);
    const { page, client, catalog } = ui;
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();

    // карточка
    const card = catalog.catalogCard(SUNRISE);
    await expectVisible(card.getByTestId('deprecated-chip'));
    await expectText(card.getByTestId('deprecation'), 'Superseded by Sunset');
    // название альтернативы — из каталога; нажатие открывает её страницу
    await expectText(card.getByTestId('deprecation'), 'Sunset');
    await expectCount(
      catalog.catalogCard('acme.sunset').getByTestId('deprecation'),
      0,
    );
    await card.getByTestId('alternative-acme.sunset').click();
    await details(page).waitFor({ timeout: TIMEOUT });
    await expectText(page.getByRole('heading', { level: 2 }), 'Sunset');
    await page.getByTestId('details-back').click();
    await expectVisible(card);

    // диалог установки
    await catalog.installButton(SUNRISE).click();
    await expectText(
      catalog.dialog.getByTestId('deprecation'),
      'Superseded by Sunset',
    );
    await catalog.confirmInstall();
    await catalog.closeDialog();

    // строка установленного
    await catalog.openInstalledTab();
    const row = catalog.installedRow(SUNRISE);
    await expectVisible(row.getByTestId('deprecated-chip'));
    await expectText(row.getByTestId('deprecation'), 'Superseded by Sunset');
    await expectText(row, 'Загружено');
    await expectCount(catalog.updatesBanner(), 0);
    await expectCount(row.getByTestId('revoked'), 0);

    // страница
    await row.getByTestId(`details-${SUNRISE}`).click();
    await details(page).waitFor({ timeout: TIMEOUT });
    await expectVisible(page.getByTestId('deprecated-chip'));
    await expectText(page.getByTestId('deprecation'), 'Superseded by Sunset');
  });

  it('диапазон: пометка «<1.1.0» не действует на новую версию', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    await catalogServer.publish(SUNRISE_1_1);
    catalogServer.deprecate(SUNRISE, {
      versions: '<1.1.0',
      reason: 'Old line is abandoned',
      alternatives: [],
    });
    const { client, catalog } = await launch(
      workspace!.userData,
      catalogServer.url,
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await expectVisible(catalog.catalogCard(SUNRISE));
    await expectCount(
      catalog.catalogCard(SUNRISE).getByTestId('deprecated-chip'),
      0,
    );
  });
});

describe('Индикатор обновлений', () => {
  it('значок на «Настройках» и вкладке появляется после запуска без захода в раздел и исчезает после обновления', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: SUNRISE,
      dir: SUNRISE_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    await catalogServer.publish(SUNRISE_1_1);
    const { page, client, catalog } = await launch(userData, catalogServer.url);

    // значок виден на плане дня: раздел «Расширения» не открывали
    const navBadge = page.getByTestId('updates-badge-nav');
    await expectText(navBadge, '1');
    await expectText(
      page.getByTestId('updates-hint-nav'),
      'Доступно обновлений: 1',
    );
    // число — в описании ссылки, имя остаётся «Настройки»
    const link = page.getByRole('link', { name: 'Настройки', exact: true });
    const hintId = await link.getAttribute('aria-describedby');
    expect(hintId).toBe('nav-updates-hint');

    await client.openSettingsExtensions();
    await expectText(page.getByTestId('updates-badge-tab'), '1');
    await expectText(
      page.getByTestId('updates-hint-tab'),
      'Доступно обновлений: 1',
    );

    await catalog.updateAll();
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await expectCount(page.getByTestId('updates-badge-nav'), 0);
    await expectCount(page.getByTestId('updates-badge-tab'), 0);
  });
});

/** Язык интерфейса через палитру команд: на другом языке команда называется иначе. */
const switchLanguage = async (page: Page, command: string) => {
  const commands = new CommandsClient(page);
  await commands.openPalette();
  await commands.search(command);
  await expect.poll(() => commands.optionTitles()).toContain(command);
  await commands.option(command).first().click();
  await commands.palette.waitFor({ state: 'hidden' });
};

describe('Доступность', () => {
  it('axe: значки, страница расширения с README и устареванием, диалог с «Что нового» — в обеих темах и на обоих языках', async () => {
    const catalogServer = await serve(DOCUMENTED_1_0, SUNSET);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: DOCUMENTED,
      dir: DOCUMENTED_1_0.dir,
      version: '1.0.0',
      catalogUrl: catalogServer.url,
    });
    await catalogServer.publish(DOCUMENTED_1_1);
    catalogServer.deprecate(DOCUMENTED, {
      versions: null,
      reason: 'Superseded by Sunset',
      alternatives: ['acme.sunset'],
    });
    const { page, catalog } = await launch(userData, catalogServer.url);
    await expectText(page.getByTestId('updates-badge-nav'), '1');

    const check = async (screen: string) => {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        // тема Vuetify переключается по media-запросу: даём перерисоваться
        await page.waitForTimeout(300);
        const violations = await runAxe(page);
        expect(violations, `${screen} ${scheme}`).toEqual([]);
      }
    };

    // имена вкладок и пунктов зависят от языка: ищем по обоим
    const openExtensions = async () => {
      await page.getByRole('link', { name: /^(Настройки|Settings)$/ }).click();
      await page
        .getByRole('tab', { name: /^(Расширения|Extensions)$/ })
        .click();
    };
    const openTab = (name: RegExp) => page.getByRole('tab', { name }).click();
    const panel = (name: RegExp) => page.getByRole('tabpanel', { name });
    const installedPanel = panel(/^(Установленные|Installed)$/);
    const catalogPanel = panel(/^(Каталог|Catalog)$/);

    for (const language of ['Язык: Русский', 'Язык: English'] as const) {
      if (language === 'Язык: English') {
        await switchLanguage(page, language);
      }
      await openExtensions();
      await openTab(/^(Установленные|Installed)$/);
      await installedPanel
        .getByTestId(`update-${DOCUMENTED}`)
        .waitFor({ timeout: TIMEOUT });
      await check(`${language}: список`);

      await openTab(/^(Каталог|Catalog)$/);
      await catalogPanel.getByTestId(`details-${DOCUMENTED}`).click();
      await details(page).waitFor({ timeout: TIMEOUT });
      const image = readme(page).locator('img[data-src="docs/shot.png"]');
      await expect
        .poll(() => image.getAttribute('src'), { timeout: TIMEOUT })
        .toMatch(/^data:image\/png;base64,/);
      await check(`${language}: страница`);
      await page.getByTestId('details-back').click();

      await openTab(/^(Установленные|Installed)$/);
      await installedPanel.getByTestId(`update-${DOCUMENTED}`).click();
      await catalog.dialog.getByTestId('whats-new-section').waitFor({
        timeout: TIMEOUT,
      });
      await check(`${language}: диалог`);
      await page.keyboard.press('Escape');
      await catalog.dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
    }
  });
});
