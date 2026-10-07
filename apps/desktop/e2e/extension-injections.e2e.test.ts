import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  catalogEnv,
  seedCatalogInstall,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { anchorSelector } from '@dolphy-app/extension-api';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { course } from './support/courses.ts';
import { readExtensionData } from './support/journal.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const INJECTION_ID = 'acme.injection';
/** Расширение собирается `dolphy-ext build`: вставка — компонент Vue на vue/vuetify приложения. */
let built: BuiltExtension | null = null;
let built11: BuiltExtension | null = null;
const injectionDir = () => built!.dir;
const injection11Dir = () => built11!.dir;
/** Предел размера бандла: vue и vuetify в него не входят. */
const BUNDLE_LIMIT_BYTES = 20 * 1024;
const VICTIM_ID = 'acme.victim';
const VICTIM_DIR = fixture('commands-victim-extension');

const injectionSource = (dir: string): CatalogSource => ({
  dir,
  name: 'Injection',
  description: 'Вставки для проверки',
  author: 'acme',
});

const ALPHA = 'Alpha (KnowledgeBase)';
const LIBRARY: Record<string, string> = {
  ...course('alpha_kb', ALPHA, 'Alpha question\n'),
  ...course('beta_kb', 'Beta (KnowledgeBase)', 'Beta question\n'),
};

const PANEL_ROUTE = `#/ext/${INJECTION_ID}/acme.injection.main`;

beforeAll(async () => {
  built = await buildFixtureExtension(fixture('injection-extension'));
  built11 = await buildFixtureExtension(fixture('injection-extension-1.1.0'));
}, 180_000);

afterAll(async () => {
  await built?.dispose();
  await built11?.dispose();
});

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;
let devRoot: string | null = null;

interface Windows {
  client: Client;
  commands: CommandsClient;
  catalog: CatalogClient;
}

const operate = (page: Page): Windows => ({
  client: new Client(page),
  commands: new CommandsClient(page),
  catalog: new CatalogClient(page),
});

const waitForShell = (page: Page) =>
  page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });

const prepare = async (
  extensions: Record<string, string> = { [INJECTION_ID]: injectionDir() },
  env?: Record<string, string>,
): Promise<Windows> => {
  workspace = await createWorkspace({ extensions, libraryFiles: LIBRARY });
  app = await launchApp(workspace.userData, env);
  await waitForShell(app.page);
  return operate(app.page);
};

const host = (page: Page, id: string): Locator =>
  page.locator(
    `[data-testid="extension-injection"][data-ext-injection="${INJECTION_ID}/${id}"]`,
  );
const roleOf = (page: Page, id: string, role: string): Locator =>
  host(page, id).locator(`[data-role="${role}"]`);
const anchor = (page: Page): Locator =>
  page.locator(anchorSelector('dailyPlan'));

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
  if (devRoot !== null) await rm(devRoot, { recursive: true, force: true });
  devRoot = null;
});

describe('инъекции в окно (R9)', () => {
  it('без расширения вставок нет; с расширением они появляются у якоря «Плана на сегодня» на своих позициях', async () => {
    const empty = await prepare({});
    await expectCount(empty.client.page.getByTestId('extension-injection'), 0);
    await app?.close();
    app = null;
    await workspace?.dispose();

    const { client } = await prepare();
    const { page } = client;
    await expectVisible(anchor(page));
    await expectText(
      roleOf(page, 'acme.injection.card', 'version'),
      'Карточка v1.0.0',
    );
    // append: внутри якоря, в конце
    await expectText(roleOf(page, 'acme.injection.card', 'position'), 'append');
    await expectCount(
      anchor(page).locator(
        '[data-ext-injection="acme.injection/acme.injection.card"]',
      ),
      1,
    );
    // prepend: внутри якоря, в начале
    await expectCount(
      anchor(page).locator(
        '[data-ext-injection="acme.injection/acme.injection.short"]',
      ),
      1,
    );
    expect(
      await anchor(page).evaluate((node) =>
        node.firstElementChild?.getAttribute('data-ext-injection'),
      ),
    ).toBe('acme.injection/acme.injection.short');
    // after: рядом с якорем, не внутри
    await expectCount(host(page, 'acme.injection.tall'), 1);
    await expectCount(
      anchor(page).locator(
        '[data-ext-injection="acme.injection/acme.injection.tall"]',
      ),
      0,
    );
    expect(
      await anchor(page).evaluate((node) =>
        node.nextElementSibling?.getAttribute('data-ext-injection'),
      ),
    ).toBe('acme.injection/acme.injection.tall');
    // вставка — компонент в дереве окна: рамки нет
    await expectCount(page.locator('iframe'), 0);
  });

  it('вставка по произвольному селектору: пункты боковых панелей расширений получают заметку после списка', async () => {
    const { client } = await prepare();
    const { page } = client;
    const note = roleOf(page, 'acme.injection.nav', 'nav-note');
    await expectText(note, 'Заметка у меню');
    expect(
      await page
        .getByTestId('extension-nav')
        .evaluate((node) =>
          node.nextElementSibling?.getAttribute('data-ext-injection'),
        ),
    ).toBe('acme.injection/acme.injection.nav');
  });

  it('цель исчезает со сменой маршрута вместе со вставкой и возвращается с ней без перезагрузки окна', async () => {
    const { client } = await prepare();
    const { page } = client;
    await expectVisible(host(page, 'acme.injection.card'));
    const stillSameWindow = await client.markWindow();

    await client.openCourses();
    await expectCount(anchor(page), 0);
    await expectCount(host(page, 'acme.injection.card'), 0);
    await expectCount(host(page, 'acme.injection.tall'), 0);
    // вставка по селектору боковой панели живёт на любом маршруте
    await expectVisible(host(page, 'acme.injection.nav'));

    await client.openPlan();
    await expectVisible(host(page, 'acme.injection.card'));
    await expectVisible(host(page, 'acme.injection.tall'));
    await expectCount(host(page, 'acme.injection.card'), 1);
    await stillSameWindow();
  });

  it('сбой компонента вставки не роняет страницу: остальные вставки и сам «План на сегодня» целы', async () => {
    const { client } = await prepare();
    const { page } = client;
    await expectVisible(host(page, 'acme.injection.card'));
    await expectVisible(host(page, 'acme.injection.short'));
    await expectVisible(anchor(page));
    await expectVisible(
      page.getByRole('link', { name: 'План на сегодня', exact: true }),
    );
    // страница отвечает: переход работает
    await client.openCourses();
    await client.openPlan();
    await expectVisible(host(page, 'acme.injection.card'));
  });

  it('компонент вставки видит тему приложения', async () => {
    const { client } = await prepare();
    const { page } = client;
    const theme = roleOf(page, 'acme.injection.card', 'theme');
    await expect
      .poll(async () => (await theme.textContent())?.replace('Тема: ', ''))
      .toBe(
        await page.evaluate(
          () =>
            document
              .querySelector('.v-theme--light, .v-theme--dark')
              ?.className.match(/v-theme--(\S+)/)?.[1],
        ),
      );
  });

  it('бандл не включает vue и vuetify: client.mjs не больше 20 КиБ gzip', async () => {
    const bundle = await readFile(join(injectionDir(), 'client.mjs'));
    expect(gzipSync(bundle).length).toBeLessThanOrEqual(BUNDLE_LIMIT_BYTES);
  });

  it('панель вызывает команды своего расширения; чужая отклоняется и ничего не меняет', async () => {
    const { client, commands } = await prepare({
      [INJECTION_ID]: injectionDir(),
      [VICTIM_ID]: VICTIM_DIR,
    });
    await client.openCourses();
    await commands.navItem('Панель инъекций').click();
    const result = commands.panelRole('result');
    await commands.pressPanelButton('Прибавить');
    await expectText(result, 'ok {"count":1}');
    await commands.pressPanelButton('Прибавить');
    await expectText(result, 'ok {"count":2}');
    expect(
      readExtensionData(workspace!.userData, INJECTION_ID).storage,
    ).toEqual({ count: 2 });

    await commands.pressPanelButton('Чужая команда');
    await expectText(result, 'Ошибка: unknown command: acme.victim.mark');
    expect(readExtensionData(workspace!.userData, VICTIM_ID).storage).toEqual(
      {},
    );
  });

  it('панель получает курс в фокусе при открытии', async () => {
    const { client, commands } = await prepare();
    await client.openCourses();
    await client.focusCourse(ALPHA);
    await commands.navItem('Панель инъекций').click();
    await expect.poll(() => commands.route()).toBe(PANEL_ROUTE);
    await expectText(commands.panelRole('course'), 'Курс: alpha_kb');
  });

  it('отключение и включение расширения в другом окне убирают и возвращают вставки без перезагрузки окна', async () => {
    const first = await prepare();
    await expectVisible(host(first.client.page, 'acme.injection.card'));
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app!.openWindow());
    await second.client.openSettingsExtensions();
    await second.client.setExtensionSwitch(INJECTION_ID, 'enabled', false);
    await expectCount(first.client.page.getByTestId('extension-injection'), 0);

    await second.client.setExtensionSwitch(INJECTION_ID, 'enabled', true);
    await expectVisible(host(first.client.page, 'acme.injection.card'));
    await expectVisible(host(first.client.page, 'acme.injection.tall'));
    await stillSameWindow();
  });

  it('удаление расширения убирает вставки без перезагрузки окна', async () => {
    server = await startCatalogServer([injectionSource(injectionDir())]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: INJECTION_ID,
      dir: injectionDir(),
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    await expectVisible(host(first.client.page, 'acme.injection.card'));
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.openRemoveDialog(INJECTION_ID);
    await second.catalog.confirmRemove();

    await expectCount(first.client.page.getByTestId('extension-injection'), 0);
    await stillSameWindow();
  });

  it('обновление расширения пересоздаёт вставки (новая revision) без перезагрузки окна', async () => {
    server = await startCatalogServer([injectionSource(injection11Dir())]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: INJECTION_ID,
      dir: injectionDir(),
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    const version = roleOf(first.client.page, 'acme.injection.card', 'version');
    await expectText(version, 'v1.0.0');
    await host(first.client.page, 'acme.injection.card').evaluate((node) =>
      Reflect.set(node, '__old', true),
    );
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.updateFromRow(INJECTION_ID);
    await second.catalog.confirmInstall();
    await second.catalog.closeDialog();

    await expectText(version, 'v1.1.0', 30_000);
    expect(
      await host(first.client.page, 'acme.injection.card').evaluate((node) =>
        Reflect.get(node, '__old'),
      ),
    ).toBeUndefined();
    await stillSameWindow();
  });

  it('режим разработчика: правка client.mjs пересоздаёт компонент', async () => {
    devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-injection-'));
    await cp(injectionDir(), join(devRoot, INJECTION_ID), { recursive: true });
    const { client } = await prepare({}, { DOLPHY_DEV_EXTENSIONS: devRoot });
    const version = roleOf(client.page, 'acme.injection.card', 'version');
    await expectText(version, 'v1.0.0');
    const stillSameWindow = await client.markWindow();

    const file = join(devRoot, INJECTION_ID, 'client.mjs');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('1.0.0', 'dev-edit'),
    );
    await expectText(version, 'vdev-edit', 30_000);
    await stillSameWindow();
  });
});

describe('значки команд и панелей (R10)', () => {
  it('боковое меню и палитра показывают значок из закрытого списка декоративно, без него — puzzle', async () => {
    const { commands } = await prepare();
    const item = commands.navItem('Панель инъекций');
    await expectVisible(item);
    const navIcon = item.locator('.v-icon');
    expect(await navIcon.getAttribute('aria-hidden')).toBe('true');
    expect(await navIcon.getAttribute('class')).toContain('mdi-trophy-outline');

    await commands.openPalette();
    const glyphOf = async (title: string) => {
      const icon = commands.option(title).locator('.v-icon.glyph');
      expect(await icon.getAttribute('aria-hidden')).toBe('true');
      return icon.getAttribute('class');
    };
    expect(await glyphOf('Открыть панель инъекций')).toContain('mdi-fire');
    expect(await glyphOf('Команда без значка')).toContain('mdi-puzzle-outline');
    // название несёт смысл: значок не попадает в имя строки
    await expectText(
      commands.option('Открыть панель инъекций'),
      'Открыть панель инъекций',
    );
    // команды приложения значка не имеют
    await expectCount(commands.option('Перейти: Курсы').locator('.v-icon'), 0);
  });
});
