import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  launchApp,
  launchSecondInstance,
} from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const SUNRISE: CatalogSource = {
  dir: join(CATALOG_FIXTURES, 'sunrise-1.0.0'),
  name: 'Sunrise',
  description: 'Тёплая светлая тема «Рассвет»',
  author: 'acme',
};
const SUNSET: CatalogSource = {
  dir: join(CATALOG_FIXTURES, 'sunset'),
  name: 'Sunset',
  description: 'Тёмная тема «Закат»',
  author: 'dana-k',
};
const ID = 'acme.sunrise';
const link = (id: string) => `dolphy://extensions/install/${id}`;
const TIMEOUT = 30_000;

const servers: CatalogServer[] = [];
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

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

const start = async (extraArgs: readonly string[] = []) => {
  const server = await startCatalogServer([SUNRISE, SUNSET]);
  servers.push(server);
  const env = catalogEnv(server.url);
  app = await launchApp(workspace!.userData, env, extraArgs);
  return { env, catalog: new CatalogClient(app.page), page: app.page };
};

const isInstalled = (id: string) =>
  access(join(workspace!.userData, 'extensions', id)).then(
    () => true,
    () => false,
  );

describe('Ссылка установки dolphy://extensions/install/<id>', () => {
  it('второй запуск с аргументом ссылки открывает диалог в первом окне; ставит только «Установить»', async () => {
    const { env, catalog, page } = await start();
    await launchSecondInstance(workspace!.userData, [link(ID)], env);

    await expectVisible(catalog.dialog);
    await expectText(catalog.dialog, 'Установить «Sunrise»?');
    // ссылка ничего не поставила
    expect(await isInstalled(ID)).toBe(false);

    await catalog.confirmInstall();
    expect(await isInstalled(ID)).toBe(true);
    await catalog.closeDialog();

    // уже актуальное — сообщение, диалога нет
    await launchSecondInstance(workspace!.userData, [link(ID)], env);
    await expectText(
      page.getByTestId('extension-notice'),
      'Расширение «Sunrise» уже установлено: v1.0.0',
    );
    await expectCount(catalog.dialog, 0);
  });

  it('холодный запуск с аргументом ссылки открывает диалог, отмена ничего не ставит', async () => {
    const { catalog } = await start([link(ID)]);
    await expectVisible(catalog.dialog);
    await expectText(catalog.dialog, 'Установить «Sunrise»?');
    await catalog.dialog.getByRole('button', { name: 'Отмена' }).click();
    await catalog.dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
    expect(await isInstalled(ID)).toBe(false);
  });

  it('неизвестный id — сообщение, диалога нет', async () => {
    const { env, catalog, page } = await start();
    await launchSecondInstance(workspace!.userData, [link('acme.nope')], env);
    await expectText(
      page.getByTestId('extension-notice'),
      'Расширение «acme.nope» не найдено в каталоге',
    );
    await expectCount(catalog.dialog, 0);
  });

  it('недопустимые ссылки игнорируются: открывается только следующая допустимая', async () => {
    const { env, catalog } = await start();
    for (const hostile of [
      `${link(ID)}?version=1.0.0`,
      `${link(ID)}#x`,
      'dolphy://evil/install/acme.sunrise',
      'dolphy://user@extensions/install/acme.sunrise',
      'dolphy://extensions/install/Acme.Sunrise',
    ]) {
      await launchSecondInstance(workspace!.userData, [hostile], env);
    }
    await launchSecondInstance(workspace!.userData, [link('acme.sunset')], env);
    await expectVisible(catalog.dialog);
    await expectText(catalog.dialog, 'Установить «Sunset»?');
    expect(await isInstalled(ID)).toBe(false);
  });
});
