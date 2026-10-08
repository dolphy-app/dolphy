import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import { catalogEnv, startCatalogServer } from './support/catalog-server.ts';
import type { CatalogServer } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import { switchLanguage } from './support/palette.ts';

const ID = 'acme.echo';
const TIMEOUT = 30_000;

let server: CatalogServer | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

/** Запись с русскими текстами в `i18n.ru` и английскими строками в `name` и `description`. */
const serve = async () => {
  server = await startCatalogServer([
    {
      dir: fileURLToPath(new URL('./fixtures/echo-extension', import.meta.url)),
      name: 'Echo',
      description: 'The echo exercise type for checks',
      author: 'acme',
      i18n: {
        ru: {
          name: 'Эхо',
          description: 'Вид заданий «эхо» для проверки',
        },
      },
    },
    {
      dir: fileURLToPath(new URL('./fixtures/catalog/sunset', import.meta.url)),
      name: 'Sunset',
      description: 'A dark sunset theme',
      author: 'dana-k',
    },
  ]);
  return server;
};

/** Карточка и название на любом языке интерфейса: язык задаёт окно. */
const card = (page: Page, id: string) =>
  page
    .getByRole('list', {
      name: /^(Расширения из каталога|Catalog extensions)$/,
    })
    .locator(`[data-extension-id="${id}"]`);

const shown = async (page: Page, id: string) => [
  (await card(page, id).locator('h3.name').innerText()).trim(),
  (await card(page, id).locator('p.text-body-medium').innerText()).trim(),
];

const search = (page: Page) => page.getByRole('searchbox');

describe('запись каталога с русскими текстами', () => {
  it('карточка, поиск и диалог установки показывают язык окна; поиск находит по обоим языкам; смена языка без перезапуска', async () => {
    const catalogServer = await serve();
    workspace = await createWorkspace();
    app = await launchApp(workspace.userData, catalogEnv(catalogServer.url));
    const client = new Client(app.page);
    const { page } = client;
    await client.openSettingsExtensions();
    await new CatalogClient(page).openCatalogTab();

    await expect
      .poll(() => shown(page, ID), { timeout: TIMEOUT })
      .toEqual(['Эхо', 'Вид заданий «эхо» для проверки']);
    // запись без перевода остаётся английской строкой
    expect(await shown(page, 'acme.sunset')).toEqual([
      'Sunset',
      'A dark sunset theme',
    ]);

    // и английский, и русский запрос находят запись
    await search(page).fill('echo exercise');
    await expect.poll(() => card(page, ID).count()).toBe(1);
    expect(await card(page, 'acme.sunset').count()).toBe(0);
    await search(page).fill('ЭХО');
    await expect.poll(() => card(page, ID).count()).toBe(1);
    await search(page).fill('');

    await card(page, ID).getByTestId(`install-${ID}`).click();
    const dialog = page.getByTestId('install-dialog');
    await expect
      .poll(() => dialog.locator('#extension-install-title').innerText())
      .toContain('Эхо');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });

    const stillSameWindow = await client.markWindow();
    await switchLanguage(page, 'Язык: English');
    await expect
      .poll(() => shown(page, ID), { timeout: TIMEOUT })
      .toEqual(['Echo', 'The echo exercise type for checks']);
    // найденное по-русски находится и в английском окне
    await search(page).fill('эхо');
    await expect.poll(() => card(page, ID).count()).toBe(1);
    await search(page).fill('');

    await card(page, ID).getByTestId(`install-${ID}`).click();
    await expect
      .poll(() => dialog.locator('#extension-install-title').innerText())
      .toContain('Echo');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
    await stillSameWindow();
  });
});
