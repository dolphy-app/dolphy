import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
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
const WIDGETS_DIR = fixture('widgets-extension');
const WIDGETS_1_1_DIR = fixture('widgets-extension-1.1.0');
const VICTIM_ID = 'acme.victim';
const VICTIM_DIR = fixture('commands-victim-extension');

const WIDGETS: CatalogSource = {
  dir: WIDGETS_DIR,
  name: 'Widgets',
  description: 'Виджеты для проверки',
  author: 'acme',
};
const WIDGETS_1_1: CatalogSource = { ...WIDGETS, dir: WIDGETS_1_1_DIR };

const ALPHA = 'Alpha (KnowledgeBase)';
const LIBRARY: Record<string, string> = {
  ...course('alpha_kb', ALPHA, 'Alpha question\n'),
  ...course('beta_kb', 'Beta (KnowledgeBase)', 'Beta question\n'),
};

/** Рамка виджета расширения (`WidgetFrame`, режим `widget`). */
const WIDGET_FRAME = 'iframe[sandbox][data-mode="widget"]';
const PANEL_ROUTE = `#/ext/${WIDGETS_ID}/acme.widgets.main`;

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
  extensions: Record<string, string> = { [WIDGETS_ID]: WIDGETS_DIR },
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
const frameOf = (page: Page, widgetId: string): Locator =>
  card(page, widgetId).locator(WIDGET_FRAME);

/** Высота рамки виджета в пикселях окна. */
const heightOf = async (page: Page, widgetId: string): Promise<number> =>
  Math.round((await frameOf(page, widgetId).boundingBox())?.height ?? -1);

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
  it('без виджетов блока нет; с расширением он появляется отдельной областью с заголовком и тремя карточками в изолированных рамках', async () => {
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
    // рамка изолирована: песочница без allow-same-origin, понятное имя
    const frame = frameOf(page, 'acme.widgets.card');
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(await frame.getAttribute('title')).toContain('Карточка');
    expect(await frame.getAttribute('title')).toContain(WIDGETS_ID);
    await expectText(
      page
        .frameLocator(`[data-widget-id="acme.widgets.card"] ${WIDGET_FRAME}`)
        .locator('[data-role="version"]'),
      'Карточка v1.0.0',
    );
  });

  it('высота рамки зажата в диапазон манифеста: по содержимому, не ниже minHeight, не выше maxHeight; длинное содержимое прокручивается внутри', async () => {
    const { client } = await prepare();
    const { page } = client;
    // содержимое 120 px, диапазон 100–200
    await expect.poll(() => heightOf(page, 'acme.widgets.card')).toBe(120);
    // содержимое ниже minHeight
    await expect.poll(() => heightOf(page, 'acme.widgets.short')).toBe(120);
    // содержимое 600 px, предел 150
    await expect.poll(() => heightOf(page, 'acme.widgets.tall')).toBe(150);
    // у рамки непрозрачный origin: документ снаружи не читается, прокрутку видно по самому содержимому
    const inner = page
      .frameLocator(`[data-widget-id="acme.widgets.tall"] ${WIDGET_FRAME}`)
      .locator('[data-role="tall"]');
    expect(
      await inner.evaluate((node) => ({
        content: node.getBoundingClientRect().height,
        view: node.ownerDocument.documentElement.clientHeight,
        scrolls:
          node.ownerDocument.documentElement.scrollHeight >
          node.ownerDocument.documentElement.clientHeight,
      })),
    ).toEqual({ content: 600, view: 150, scrolls: true });
  });

  it('рамка вызывает команды своего расширения; чужая отклоняется и ничего не меняет', async () => {
    const { client } = await prepare({
      [WIDGETS_ID]: WIDGETS_DIR,
      [VICTIM_ID]: VICTIM_DIR,
    });
    const { page } = client;
    const frame = page.frameLocator(
      `[data-widget-id="acme.widgets.card"] ${WIDGET_FRAME}`,
    );
    await frame.getByRole('button', { name: 'Прибавить', exact: true }).click();
    await expectText(frame.locator('[data-role="result"]'), 'ok {"count":1}');
    await frame.getByRole('button', { name: 'Прибавить', exact: true }).click();
    await expectText(frame.locator('[data-role="result"]'), 'ok {"count":2}');
    expect(readExtensionData(workspace!.userData, WIDGETS_ID).storage).toEqual({
      count: 2,
    });

    await frame
      .getByRole('button', { name: 'Чужая команда', exact: true })
      .click();
    await expectText(
      frame.locator('[data-role="result"]'),
      'Ошибка: unknown command: acme.victim.mark',
    );
    expect(readExtensionData(workspace!.userData, VICTIM_ID).storage).toEqual(
      {},
    );
  });

  it('курс в фокусе доходит до рамки без её пересоздания и без перезагрузки окна', async () => {
    const { client } = await prepare();
    const { page } = client;
    const course = page
      .frameLocator(`[data-widget-id="acme.widgets.card"] ${WIDGET_FRAME}`)
      .locator('[data-role="course"]');
    await expectText(course, 'Курс: все');
    await frameOf(page, 'acme.widgets.card').evaluate((node) =>
      Reflect.set(node, '__same', true),
    );
    const stillSameWindow = await client.markWindow();

    // выбор курса на самом экране плана: страница остаётся, рамки остаются
    await page.locator('.v-chip', { hasText: ALPHA }).click();
    await expectText(course, 'Курс: alpha_kb');
    await page.locator('.v-chip', { hasText: 'Все курсы' }).click();
    await expectText(course, 'Курс: все');
    expect(
      await frameOf(page, 'acme.widgets.card').evaluate((node) =>
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
    server = await startCatalogServer([WIDGETS]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: WIDGETS_ID,
      dir: WIDGETS_DIR,
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

  it('обновление расширения пересоздаёт рамки (новая revision) без перезагрузки окна', async () => {
    server = await startCatalogServer([WIDGETS_1_1]);
    workspace = await createWorkspace({ libraryFiles: LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: WIDGETS_ID,
      dir: WIDGETS_DIR,
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    const version = first.client.page
      .frameLocator(`[data-widget-id="acme.widgets.card"] ${WIDGET_FRAME}`)
      .locator('[data-role="version"]');
    await expectText(version, 'v1.0.0');
    await frameOf(first.client.page, 'acme.widgets.card').evaluate((node) =>
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
      await frameOf(first.client.page, 'acme.widgets.card').evaluate((node) =>
        Reflect.get(node, '__old'),
      ),
    ).toBeUndefined();
    await stillSameWindow();
  });

  it('режим разработчика: правка модуля виджета пересоздаёт рамку', async () => {
    devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-widget-'));
    await cp(WIDGETS_DIR, join(devRoot, WIDGETS_ID), { recursive: true });
    const { client } = await prepare({}, { DOLPHY_DEV_EXTENSIONS: devRoot });
    const version = client.page
      .frameLocator(`[data-widget-id="acme.widgets.card"] ${WIDGET_FRAME}`)
      .locator('[data-role="version"]');
    await expectText(version, 'v1.0.0');
    const stillSameWindow = await client.markWindow();

    const file = join(devRoot, WIDGETS_ID, 'widget.mjs');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace("'1.0.0'", "'dev-edit'"),
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
      const icon = commands.option(title).locator('.glyph');
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
    await expectCount(commands.option('Перейти: Курсы').locator('.glyph'), 0);
  });
});
