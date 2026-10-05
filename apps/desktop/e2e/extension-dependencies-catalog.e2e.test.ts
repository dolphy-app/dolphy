import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { expectText, expectVisible } from './support/locator.ts';

const NEEDY: CatalogSource = {
  dir: join(CATALOG_FIXTURES, 'needy'),
  name: 'Needy',
  description: 'Тема, которой нужны другие расширения',
  author: 'acme',
};
const ID = 'acme.needy';
const MIDNIGHT = fileURLToPath(
  new URL('./fixtures/theme-extension', import.meta.url),
);

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

const exists = (id: string) =>
  access(join(workspace!.userData, 'extensions', id)).then(
    () => true,
    () => false,
  );

describe('зависимости в каталоге и диалоге установки', () => {
  it('карточка и диалог показывают зависимости с отметками «установлено / не установлено»; установка не блокируется и зависимости не ставит', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.midnight': MIDNIGHT },
    });
    server = await startCatalogServer([NEEDY]);
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    const catalog = new CatalogClient(app.page);
    await new Client(app.page).openSettingsExtensions();
    await catalog.openCatalogTab();

    const card = catalog.catalogCard(ID);
    const cardDeps = card.locator('[data-point="dependencies"]');
    await expectVisible(cardDeps);
    await expectText(
      cardDeps.locator('[data-dependency="acme.midnight"]'),
      'установлено',
    );
    await expectText(
      cardDeps.locator('[data-dependency="acme.midnight"]'),
      '>=1.0.0 <2.0.0',
    );
    await expectText(
      cardDeps.locator('[data-dependency="acme.absent"]'),
      'не установлено',
    );
    await expectText(cardDeps, 'Зависимости');

    // кнопка доступна, диалог повторяет список
    const install = catalog.installButton(ID);
    expect(await install.isEnabled()).toBe(true);
    await install.click();
    await expectVisible(catalog.dialog);
    const dialogDeps = catalog.dialog.locator('[data-point="dependencies"]');
    await expectVisible(dialogDeps);
    await expectText(
      dialogDeps.locator('[data-dependency="acme.midnight"]'),
      'установлено',
    );
    await expectText(
      dialogDeps.locator('[data-dependency="acme.absent"]'),
      'не установлено',
    );
    const confirm = catalog.dialog.getByTestId('install-confirm');
    expect(await confirm.isEnabled()).toBe(true);

    // установка проходит; недостающая зависимость не поставлена
    await catalog.confirmInstall();
    await expectText(catalog.dialog.getByTestId('install-done'), 'Установлено');
    expect(await exists(ID)).toBe(true);
    expect(await exists('acme.absent')).toBe(false);
    await catalog.closeDialog();

    // расширение установлено, но ждёт зависимость
    await catalog.openInstalledTab();
    await expect
      .poll(() => catalog.installedText(ID), { timeout: 30_000 })
      .toContain('Зависимости не выполнены');
    expect(await catalog.installedText(ID)).toContain('acme.absent');
  });
});
