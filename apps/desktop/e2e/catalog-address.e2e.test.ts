import { access, readFile } from 'node:fs/promises';
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
  settingCatalogEnv,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import {
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
const ID = 'acme.sunrise';
const TIMEOUT = 30_000;

const servers: CatalogServer[] = [];
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

const serve = async (...sources: CatalogSource[]) => {
  const started = await startCatalogServer(sources);
  servers.push(started);
  return started;
};

const launch = async (userData: string, env: Record<string, string>) => {
  app = await launchApp(userData, env);
  return {
    page: app.page,
    client: new Client(app.page),
    catalog: new CatalogClient(app.page),
  };
};

beforeEach(async () => {
  workspace = await createWorkspace();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await Promise.all(servers.splice(0).map((item) => item.close()));
  await workspace?.dispose();
  workspace = null;
});

const input = (page: Page) =>
  page.getByTestId('catalog-url-input').locator('input');

/** «Каталог → Дополнительно» раскрыт. */
const openAdvanced = async (page: Page) => {
  const toggle = page.getByTestId('catalog-advanced-toggle');
  await toggle.waitFor({ timeout: TIMEOUT });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await input(page).waitFor({ timeout: TIMEOUT });
  // «Применить» доступна, только когда действующий адрес прочитан
  await page.getByTestId('catalog-url-current').waitFor({ timeout: TIMEOUT });
};

const applyAddress = async (page: Page, url: string) => {
  await input(page).fill(url);
  await page.getByTestId('catalog-url-apply').click();
};

const currentUrl = (page: Page) => page.getByTestId('catalog-url-value');

describe('Адрес каталога', () => {
  it('смена на второй каталог, ошибка неверного адреса, перезапуск и сброс', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { client, catalog, page } = await launch(
      workspace!.userData,
      settingCatalogEnv(),
    );
    await client.openSettingsExtensions();
    await catalog.page
      .getByRole('tab', { name: 'Каталог', exact: true })
      .click();
    await openAdvanced(page);
    await expectVisible(page.getByTestId('catalog-url-default'));
    await expectDisabled(page.getByTestId('catalog-url-apply'), true);
    await expectDisabled(page.getByTestId('catalog-url-reset'), true);

    // неверный адрес: ошибка рядом с полем, действующий адрес прежний
    const before = await currentUrl(page).innerText();
    for (const [bad, text] of [
      ['not a url', 'Это не адрес'],
      ['ftp://catalog.test/index.json', 'Нужен адрес https'],
      ['https://user:pw@catalog.test/index.json', 'логин и пароль'],
      ['https://catalog.test/index.json#x', 'фрагмент'],
      ['https://catalog.test/catalog/', 'файл .json'],
    ] as const) {
      await applyAddress(page, bad);
      await expectText(page.getByTestId('catalog-advanced-body'), text);
      expect(await currentUrl(page).innerText()).toBe(before);
    }

    // верный адрес действует сразу: список каталога перечитан
    await applyAddress(page, catalogServer.url);
    await expectVisible(page.getByTestId('catalog-url-applied'));
    await expectVisible(page.getByTestId('catalog-url-setting'));
    await expectText(currentUrl(page), catalogServer.url);
    await expectVisible(catalog.catalogCard(ID));

    // перезапуск: адрес сохранён
    await app!.close();
    app = null;
    const again = await launch(workspace!.userData, settingCatalogEnv());
    await again.client.openSettingsExtensions();
    await again.page.getByRole('tab', { name: 'Каталог', exact: true }).click();
    await expectVisible(again.catalog.catalogCard(ID));
    await openAdvanced(again.page);
    await expectText(currentUrl(again.page), catalogServer.url);

    // сброс возвращает умолчание
    await again.page.getByTestId('catalog-url-reset').click();
    await expectVisible(again.page.getByTestId('catalog-url-default'));
    await expect
      .poll(() => currentUrl(again.page).innerText(), { timeout: TIMEOUT })
      .not.toBe(catalogServer.url);
    await expectDisabled(again.page.getByTestId('catalog-url-reset'), true);
  });

  it('адрес из окружения важнее настройки: поле неактивно с пояснением', async () => {
    const catalogServer = await serve(SUNRISE_1_0);
    const { client, catalog, page } = await launch(
      workspace!.userData,
      catalogEnv(catalogServer.url),
    );
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await openAdvanced(page);
    await expectDisabled(input(page), true);
    await expectDisabled(page.getByTestId('catalog-url-apply'), true);
    await expectVisible(page.getByTestId('catalog-url-env-note'));
    await expectText(currentUrl(page), catalogServer.url);
  });

  it('расширения прежнего каталога остаются с пометкой, без обновлений; запись нового каталога неактивна; возврат возвращает обновления', async () => {
    const first = await serve(SUNRISE_1_0);
    await first.publish(SUNRISE_1_1);
    const second = await serve(SUNRISE_1_1, SUNSET);
    const { userData } = workspace!;
    await seedCatalogInstall(userData, {
      id: ID,
      dir: fixture('sunrise-1.0.0'),
      version: '1.0.0',
      catalogUrl: first.url,
    });
    const metaPath = join(userData, 'extensions', ID, '.dolphy-install.json');
    const metaBefore = await readFile(metaPath, 'utf8');

    const { client, catalog, page } = await launch(
      userData,
      settingCatalogEnv(),
    );
    await client.openSettingsExtensions();
    await catalog.page
      .getByRole('tab', { name: 'Каталог', exact: true })
      .click();
    await openAdvanced(page);
    await applyAddress(page, first.url);
    await expectVisible(page.getByTestId('catalog-url-applied'));

    // прежний каталог: «Из каталога», есть обновление
    await catalog.page
      .getByRole('tab', { name: 'Установленные', exact: true })
      .click();
    await expectVisible(catalog.installedRow(ID).getByTestId('from-catalog'));
    await expectVisible(catalog.updatesBanner());

    // другой каталог: пометка, ни обновления, ни действия каталога
    await catalog.page
      .getByRole('tab', { name: 'Каталог', exact: true })
      .click();
    await openAdvanced(page);
    await applyAddress(page, second.url);
    await expectVisible(page.getByTestId('catalog-url-applied'));
    await expectVisible(catalog.catalogCard('acme.sunset'));
    const card = catalog.catalogCard(ID);
    await expectText(card, 'Уже установлено из другого источника');
    await expectText(card, 'удалите установленное расширение');
    await expectDisabled(card.getByTestId(`install-${ID}`), true);
    await expectCount(
      catalog.catalogCard('acme.sunset').getByTestId('elsewhere'),
      0,
    );

    await catalog.page
      .getByRole('tab', { name: 'Установленные', exact: true })
      .click();
    const row = catalog.installedRow(ID);
    await expectVisible(row.getByTestId('from-other-catalog'));
    await expectText(row, 'Из другого каталога');
    await expectCount(row.getByTestId('from-catalog'), 0);
    await expectCount(catalog.updatesBanner(), 0);
    // расширение продолжает работать
    await expectText(row, 'Загружено');
    await access(join(userData, 'extensions', ID));
    expect(await readFile(metaPath, 'utf8')).toBe(metaBefore);

    // страница расширения: пометка и неактивная кнопка
    await row.getByTestId(`details-${ID}`).click();
    const details = page.getByTestId('extension-details');
    await details.waitFor({ timeout: TIMEOUT });
    await expectVisible(details.getByTestId('from-other-catalog'));
    await expectText(details, 'Уже установлено из другого источника');
    await expectDisabled(details.getByTestId(`install-${ID}`), true);
    expect(await runAxe(page)).toEqual([]);
    await page.goBack();

    // возврат к прежнему адресу: обновление и «Из каталога»
    await catalog.page
      .getByRole('tab', { name: 'Каталог', exact: true })
      .click();
    await openAdvanced(page);
    await applyAddress(page, first.url);
    await expectVisible(page.getByTestId('catalog-url-applied'));
    await catalog.page
      .getByRole('tab', { name: 'Установленные', exact: true })
      .click();
    await expectVisible(catalog.installedRow(ID).getByTestId('from-catalog'));
    await expectVisible(catalog.updatesBanner());
    expect(await readFile(metaPath, 'utf8')).toBe(metaBefore);
  });
});
