import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import { readJournal } from './support/journal.ts';
import { expectCount, expectText } from './support/locator.ts';
import { SafeModeClient } from './support/safe-mode-client.ts';

const THEME_EXTENSION = fileURLToPath(
  new URL('./fixtures/theme-extension', import.meta.url),
);
const MIDNIGHT = 'Полночь';
const CHOICE = 'Choice (KnowledgeBase)';
const CHOICE_RIGHT: Record<string, string[]> = {
  'Which statement reads data from a table?': ['SELECT'],
  'Which of these are SQL join types? Select all that apply.': [
    'INNER',
    'LEFT',
    'FULL',
  ],
  'Pick the second option.': ['b'],
};

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;

interface Windows {
  client: Client;
  safeMode: SafeModeClient;
}

const launch = async (
  options: { env?: Record<string, string>; args?: string[] } = {},
): Promise<Windows> => {
  if (workspace === null) {
    workspace = await createWorkspace({
      extensions: { 'acme.midnight': THEME_EXTENSION },
    });
  }
  app = await launchApp(workspace.userData, options.env, options.args);
  return {
    client: new Client(app.page),
    safeMode: new SafeModeClient(app.page),
  };
};

const relaunch = async (options?: Parameters<typeof launch>[0]) => {
  await app?.close();
  app = null;
  return launch(options);
};

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

describe('безопасный режим: запуск с флагом', () => {
  it('расширение пользователя отключено с пояснением, его тема пропала, поставляемый вид задания работает; кнопки на баннере нет', async () => {
    const { client, safeMode } = await launch({ args: ['--safe-mode'] });

    await safeMode.banner.waitFor({ timeout: 30_000 });
    await expectText(safeMode.banner, '--safe-mode');
    expect(await safeMode.disableButton.count()).toBe(0);

    await client.openSettingsAppearance();
    expect(await client.themeTileExists(MIDNIGHT)).toBe(false);

    await client.openSettingsExtensions();
    const [row] = await client.readExtensions('acme.midnight');
    expect(row).toContain('Отключено');
    expect(row).toContain('Отключено в безопасном режиме');
    expect(await safeMode.toggle.isChecked()).toBe(false);

    await client.openCourses();
    await client.focusCourse(CHOICE);
    await client.startSession();
    const summary = await client.runSession(({ prompt }) => ({
      choose: CHOICE_RIGHT[prompt] ?? [],
    }));
    expect(summary.count).toBe(3);
    expect(readJournal(workspace!.userData)).toHaveLength(3);
  });

  it('установка из каталога и удаление работают; установленное остаётся отключённым', async () => {
    server = await startCatalogServer([
      {
        dir: join(CATALOG_FIXTURES, 'sunrise-1.0.0'),
        name: 'Sunrise',
        description: 'Sunrise',
        author: 'acme',
      },
    ]);
    const { client, safeMode } = await launch({
      env: catalogEnv(server.url),
      args: ['--safe-mode'],
    });
    const catalog = new CatalogClient(app!.page);
    await safeMode.banner.waitFor({ timeout: 30_000 });

    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await catalog.installButton('acme.sunrise').click();
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await catalog.openInstalledTab();

    const row = app!.page
      .getByRole('list', { name: 'Установленные расширения', exact: true })
      .locator('[data-extension-id="acme.sunrise"]');
    await expectText(row, 'Отключено в безопасном режиме');

    await app!.page.getByTestId('remove-acme.sunrise').click();
    await app!.page.getByTestId('remove-confirm').click();
    await expectCount(row, 0);
  });

  it('снять режим можно только запуском: без флага расширение работает снова', async () => {
    const { safeMode } = await launch({ args: ['--safe-mode'] });
    await safeMode.banner.waitFor({ timeout: 30_000 });

    const { client } = await relaunch();
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(MIDNIGHT)).toBe(true);
    expect(await new SafeModeClient(app!.page).banner.count()).toBe(0);
  });
});

describe('безопасный режим: переменная окружения', () => {
  it('DOLPHY_SAFE_MODE=1 включает режим; баннер называет переменную, кнопки нет', async () => {
    const { client, safeMode } = await launch({
      env: { DOLPHY_SAFE_MODE: '1' },
    });

    await safeMode.banner.waitFor({ timeout: 30_000 });
    await expectText(safeMode.banner, 'DOLPHY_SAFE_MODE');
    expect(await safeMode.disableButton.count()).toBe(0);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(MIDNIGHT)).toBe(false);
  });
});

describe('безопасный режим: настройка', () => {
  it('переключатель включает режим сразу, кнопка баннера выключает без перезапуска окна', async () => {
    const { client, safeMode } = await launch();
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(MIDNIGHT)).toBe(true);
    expect(await safeMode.banner.count()).toBe(0);
    const stillSameWindow = await client.markWindow();

    await client.openSettingsExtensions();
    await safeMode.setToggle(true);
    await safeMode.banner.waitFor({ timeout: 15_000 });
    await expectText(safeMode.banner, 'кроме встроенных');
    await client.openSettingsAppearance();
    await expect
      .poll(() => client.themeTileExists(MIDNIGHT), { timeout: 15_000 })
      .toBe(false);

    await safeMode.disableButton.click();
    await safeMode.banner.waitFor({ state: 'detached', timeout: 15_000 });
    await expect
      .poll(() => client.themeTileExists(MIDNIGHT), { timeout: 15_000 })
      .toBe(true);
    await stillSameWindow();
  });

  it('настройка переживает перезапуск; установка работает, а установленное остаётся отключённым', async () => {
    const { client, safeMode } = await launch();
    await client.openSettingsExtensions();
    await safeMode.setToggle(true);

    const reopened = await relaunch();
    await reopened.safeMode.banner.waitFor({ timeout: 30_000 });
    await reopened.client.openSettingsExtensions();
    expect(await reopened.safeMode.toggle.isChecked()).toBe(true);
    const [row] = await reopened.client.readExtensions('acme.midnight');
    expect(row).toContain('Отключено в безопасном режиме');

    await reopened.safeMode.disableButton.click();
    await reopened.safeMode.banner.waitFor({ state: 'detached' });
    const again = await relaunch();
    await again.client.openSettingsAppearance();
    expect(await again.client.themeTileExists(MIDNIGHT)).toBe(true);
    expect(await again.safeMode.banner.count()).toBe(0);
  });
});
