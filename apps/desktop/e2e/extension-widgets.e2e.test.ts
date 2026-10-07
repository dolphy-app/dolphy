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
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { course } from './support/courses.ts';
import { readExtensionData } from './support/journal.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const WIDGETS_ID = 'acme.widgets';
/** Расширения виджетов собираются `dolphy-ext build`: виджет — компонент Vue на vue/vuetify приложения. */
let built: BuiltExtension | null = null;
let built11: BuiltExtension | null = null;
const widgetsDir = () => built!.dir;
const widgets11Dir = () => built11!.dir;
/** Предел размера бандла виджета: vue и vuetify в него не входят. */
const BUNDLE_LIMIT_BYTES = 20 * 1024;
const VICTIM_ID = 'acme.victim';
const VICTIM_DIR = fixture('commands-victim-extension');

const widgetsSource = (dir: string): CatalogSource => ({
  dir,
  name: 'Widgets',
  description: 'Виджеты для проверки',
  author: 'acme',
});

const ALPHA = 'Alpha (KnowledgeBase)';
const LIBRARY: Record<string, string> = {
  ...course('alpha_kb', ALPHA, 'Alpha question\n'),
  ...course('beta_kb', 'Beta (KnowledgeBase)', 'Beta question\n'),
};

const PANEL_ROUTE = `#/ext/${WIDGETS_ID}/acme.widgets.main`;

beforeAll(async () => {
  built = await buildFixtureExtension(fixture('widgets-extension'));
  built11 = await buildFixtureExtension(fixture('widgets-extension-1.1.0'));
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
  extensions: Record<string, string> = { [WIDGETS_ID]: widgetsDir() },
  env?: Record<string, string>,
): Promise<Windows> => {
  workspace = await createWorkspace({ extensions, libraryFiles: LIBRARY });
  app = await launchApp(workspace.userData, env);
  await waitForShell(app.page);
  return operate(app.page);
};

const block = (page: Page): Locator => page.getByTestId('extension-widgets');
const card = (page: Page, widgetId: string): Locator =>
  block(page).locator(`[data-widget-id="${widgetId}"]`);
/** Тело карточки: компонент виджета рисуется прямо в дереве окна, без рамки. */
const bodyOf = (page: Page, widgetId: string): Locator =>
  card(page, widgetId).getByTestId('extension-widget-body');
const roleOf = (page: Page, widgetId: string, role: string): Locator =>
  bodyOf(page, widgetId).locator(`[data-role="${role}"]`);

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

describe('виджеты на экране «План дня» (R9)', () => {
  it('без виджетов блока нет; с расширением он появляется отдельной областью с заголовком и тремя карточками-компонентами без рамки', async () => {
    const empty = await prepare({});
    await expectCount(block(empty.client.page), 0);
    await app?.close();
    app = null;
    await workspace?.dispose();

    const { client } = await prepare();
    const { page } = client;
    await expectVisible(block(page));
    const region = page.getByRole('region', { name: 'Виджеты расширений' });
    await expectCount(region, 1);
    await expectCount(region.locator('[data-testid="extension-widget"]'), 3);
    expect(
      await region.getByRole('heading', { level: 3 }).allInnerTexts(),
    ).toEqual(['Карточка', 'Короткий', 'Длинный']);
    await expectText(
      roleOf(page, 'acme.widgets.card', 'version'),
      'Карточка v1.0.0',
    );
    // виджет — компонент в дереве окна: рамки нет
    await expectCount(page.locator('iframe'), 0);
  });

  it('компонент виджета видит тему приложения', async () => {
    const { client } = await prepare();
    const { page } = client;
    const theme = roleOf(page, 'acme.widgets.card', 'theme');
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

  it('бандл виджета не включает vue и vuetify: widget.mjs не больше 20 КиБ gzip', async () => {
    const bundle = await readFile(join(widgetsDir(), 'widget.mjs'));
    expect(gzipSync(bundle).length).toBeLessThanOrEqual(BUNDLE_LIMIT_BYTES);
  });

  it('виджет вызывает команды своего расширения; чужая отклоняется и ничего не меняет', async () => {
    const { client } = await prepare({
      [WIDGETS_ID]: widgetsDir(),
      [VICTIM_ID]: VICTIM_DIR,
    });
    const { page } = client;
    const body = bodyOf(page, 'acme.widgets.card');
    const result = roleOf(page, 'acme.widgets.card', 'result');
    await body.getByRole('button', { name: 'Прибавить', exact: true }).click();
    await expectText(result, 'ok {"count":1}');
    await body.getByRole('button', { name: 'Прибавить', exact: true }).click();
    await expectText(result, 'ok {"count":2}');
    expect(readExtensionData(workspace!.userData, WIDGETS_ID).storage).toEqual({
      count: 2,
    });

    await body
      .getByRole('button', { name: 'Чужая команда', exact: true })
      .click();
    await expectText(result, 'Ошибка: unknown command: acme.victim.mark');
    expect(readExtensionData(workspace!.userData, VICTIM_ID).storage).toEqual(
      {},
    );
  });

  it('курс в фокусе доходит до виджета без его пересоздания и без перезагрузки окна', async () => {
    const { client } = await prepare();
    const { page } = client;
    const course = roleOf(page, 'acme.widgets.card', 'course');
    await expectText(course, 'Курс: все');
    await bodyOf(page, 'acme.widgets.card').evaluate((node) =>
      Reflect.set(node, '__same', true),
    );
    const stillSameWindow = await client.markWindow();

    // выбор курса на самом экране плана: страница остаётся, карточки остаются
    await page.locator('.v-chip', { hasText: ALPHA }).click();
    await expectText(course, 'Курс: alpha_kb');
    await page.locator('.v-chip', { hasText: 'Все курсы' }).click();
    await expectText(course, 'Курс: все');
    expect(
      await bodyOf(page, 'acme.widgets.card').evaluate((node) =>
        Reflect.get(node, '__same'),
      ),
    ).toBe(true);
    await stillSameWindow();
  });

  it('панель получает курс в фокусе при открытии', async () => {
    const { client, commands } = await prepare();
    await client.openCourses();
    await client.focusCourse(ALPHA);
    await commands.navItem('Панель виджетов').click();
    await expect.poll(() => commands.route()).toBe(PANEL_ROUTE);
    await expectText(commands.panelRole('course'), 'Курс: alpha_kb');
  });

  it('отключение и включение расширения в другом окне убирают и возвращают блок без перезагрузки окна', async () => {
    const first = await prepare();
    await expectVisible(block(first.client.page));
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app!.openWindow());
    await second.client.openSettingsExtensions();
    await second.client.setExtensionSwitch(WIDGETS_ID, 'enabled', false);
    await expectCount(block(first.client.page), 0);

    await second.client.setExtensionSwitch(WIDGETS_ID, 'enabled', true);
    await expectVisible(block(first.client.page));
    await expectCount(
      block(first.client.page).locator('[data-testid="extension-widget"]'),
      3,
    );
    await stillSameWindow();
  });

  it('удаление расширения убирает блок без перезагрузки окна', async () => {
    server = await startCatalogServer([widgetsSource(widgetsDir())]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: WIDGETS_ID,
      dir: widgetsDir(),
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    await expectVisible(block(first.client.page));
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.openRemoveDialog(WIDGETS_ID);
    await second.catalog.confirmRemove();

    await expectCount(block(first.client.page), 0);
    await stillSameWindow();
  });

  it('обновление расширения пересоздаёт виджеты (новая revision) без перезагрузки окна', async () => {
    server = await startCatalogServer([widgetsSource(widgets11Dir())]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: WIDGETS_ID,
      dir: widgetsDir(),
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    const version = roleOf(first.client.page, 'acme.widgets.card', 'version');
    await expectText(version, 'v1.0.0');
    await bodyOf(first.client.page, 'acme.widgets.card').evaluate((node) =>
      Reflect.set(node, '__old', true),
    );
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.updateFromRow(WIDGETS_ID);
    await second.catalog.confirmInstall();
    await second.catalog.closeDialog();

    await expectText(version, 'v1.1.0', 30_000);
    expect(
      await bodyOf(first.client.page, 'acme.widgets.card').evaluate((node) =>
        Reflect.get(node, '__old'),
      ),
    ).toBeUndefined();
    await stillSameWindow();
  });

  it('режим разработчика: правка модуля виджета пересоздаёт компонент', async () => {
    devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-widget-'));
    await cp(widgetsDir(), join(devRoot, WIDGETS_ID), { recursive: true });
    const { client } = await prepare({}, { DOLPHY_DEV_EXTENSIONS: devRoot });
    const version = roleOf(client.page, 'acme.widgets.card', 'version');
    await expectText(version, 'v1.0.0');
    const stillSameWindow = await client.markWindow();

    const file = join(devRoot, WIDGETS_ID, 'widget.mjs');
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
    const item = commands.navItem('Панель виджетов');
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
    expect(await glyphOf('Открыть панель виджетов')).toContain('mdi-fire');
    expect(await glyphOf('Команда без значка')).toContain('mdi-puzzle-outline');
    // название несёт смысл: значок не попадает в имя строки
    await expectText(
      commands.option('Открыть панель виджетов'),
      'Открыть панель виджетов',
    );
    // команды приложения значка не имеют
    await expectCount(commands.option('Перейти: Курсы').locator('.v-icon'), 0);
  });
});
