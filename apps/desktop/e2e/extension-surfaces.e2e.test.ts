import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
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
import {
  COMMANDS_ID,
  CommandsClient,
  PANEL_TITLE,
  VICTIM_ID,
} from './support/commands-client.ts';
import { readExtensionData } from './support/journal.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';
import { PLAIN_COURSE, PLAIN_LIBRARY } from './support/state-client.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const COMMANDS_DIR = fixture('commands-extension');
const COMMANDS_1_1_DIR = fixture('commands-extension-1.1.0');
const VICTIM_DIR = fixture('commands-victim-extension');
const SLOW_START_DIR = fixture('slow-start-extension');

const COMMANDS: CatalogSource = {
  dir: COMMANDS_DIR,
  name: 'Commands',
  description: 'Команды и панель для проверки',
  author: 'acme',
};
const COMMANDS_1_1: CatalogSource = { ...COMMANDS, dir: COMMANDS_1_1_DIR };

const PANEL_ROUTE = `#/ext/${COMMANDS_ID}/acme.commands.main`;
const GREETING = 'Привет, <b>мир</b>';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;
let devRoot: string | null = null;

interface Windows {
  client: Client;
  catalog: CatalogClient;
  commands: CommandsClient;
}

const operate = (page: DolphyApp['page']): Windows => ({
  client: new Client(page),
  catalog: new CatalogClient(page),
  commands: new CommandsClient(page),
});

/** Приложение смонтировано: боковое меню на месте, обработчик Ctrl+K уже слушает. */
const waitForShell = (page: DolphyApp['page']) =>
  page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });

const prepare = async (
  extensions: Record<string, string> = { [COMMANDS_ID]: COMMANDS_DIR },
  env?: Record<string, string>,
): Promise<Windows> => {
  workspace = await createWorkspace({
    extensions,
    libraryFiles: PLAIN_LIBRARY,
  });
  app = await launchApp(workspace.userData, env);
  await waitForShell(app.page);
  return operate(app.page);
};

/** Открывает панель командой палитры и ждёт маршрут панели. */
const openPanelFromPalette = async ({ commands }: Windows) => {
  await commands.openPalette();
  await commands.search('панель приветствий');
  await commands.combobox.press('Enter');
  await expect
    .poll(() => commands.route(), { timeout: 30_000 })
    .toBe(PANEL_ROUTE);
  await commands.panelRole('panel-id').waitFor({ timeout: 30_000 });
};

const victimData = () => readExtensionData(workspace!.userData, VICTIM_ID);

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

describe('палитра команд (R4, R8)', () => {
  it('Ctrl+K открывает палитру на странице; поиск без учёта регистра; Enter выполняет, уведомление — текстом с role=status; Escape возвращает фокус', async () => {
    const { commands, client } = await prepare();
    const planLink = client.page.getByRole('link', {
      name: 'План на сегодня',
      exact: true,
    });
    await planLink.focus();
    const stillSameWindow = await client.markWindow();

    await commands.openPalette();
    expect(await commands.combobox.getAttribute('aria-expanded')).toBe('true');
    const listId = await commands.combobox.getAttribute('aria-controls');
    await expectCount(commands.palette.getByRole('listbox'), 1);
    expect(await commands.palette.getByRole('listbox').getAttribute('id')).toBe(
      listId,
    );
    // одна роль combobox — на поле ввода: вложенный combobox без aria-expanded нарушает ARIA
    await expectCount(commands.palette.locator('[role="combobox"]'), 1);
    // команда с palette:false в палитре не показывается
    expect(await commands.extensionTitles()).toEqual([
      'Открыть панель приветствий',
      'Поприветствовать',
      'Зависнуть',
      'Сломаться',
    ]);
    // `Mod+Shift+G` показывается с учётом платформы: ⇧⌘G на macOS, Ctrl+Shift+G на остальных
    await expectText(
      commands.option('Поприветствовать'),
      process.platform === 'darwin' ? '⇧⌘G' : 'Ctrl+Shift+G',
    );
    await expectText(
      commands.option('Поприветствовать'),
      'Показывает уведомление',
    );
    await expectText(commands.option('Поприветствовать'), COMMANDS_ID);

    // выбранная строка связана с полем через aria-activedescendant
    const first = await commands.options.first().getAttribute('id');
    expect(await commands.combobox.getAttribute('aria-activedescendant')).toBe(
      first,
    );
    await commands.combobox.press('ArrowDown');
    const second = await commands.options.nth(1).getAttribute('id');
    expect(await commands.combobox.getAttribute('aria-activedescendant')).toBe(
      second,
    );
    expect(await commands.options.nth(1).getAttribute('aria-selected')).toBe(
      'true',
    );

    // поиск без учёта регистра по названию, категории и id расширения
    await commands.search('СБОИ');
    expect(await commands.extensionTitles()).toEqual([
      'Зависнуть',
      'Сломаться',
    ]);
    await commands.search('ACME.COMMANDS');
    expect((await commands.optionTitles()).length).toBe(4);
    await commands.search('нет такой команды');
    await expectVisible(commands.palette.getByText('Нет подходящих команд'));
    await commands.search('');

    await commands.combobox.press('Escape');
    await commands.palette.waitFor({ state: 'hidden' });
    await expect
      .poll(() =>
        client.page.evaluate(() => document.activeElement?.textContent),
      )
      .toContain('План на сегодня');

    await commands.openPalette();
    await commands.search('ПРИВЕТСТВОВАТЬ');
    await commands.combobox.press('Enter');
    await commands.palette.waitFor({ state: 'hidden' });
    await expectVisible(commands.notice);
    // текст расширения — данные: разметка не разбирается
    await expectText(commands.notice, GREETING);
    expect(await commands.notice.locator('b').count()).toBe(0);
    await stillSameWindow();
  });

  it('в боковом меню кнопки палитры нет; Ctrl+K работает и в учебной сессии', async () => {
    const { commands, client } = await prepare();
    await expectCount(
      client.page.getByRole('button', { name: /палитр|команд/i }),
      0,
    );
    await commands.openPalette();
    expect((await commands.extensionTitles()).length).toBe(4);
    await commands.combobox.press('Escape');
    await commands.palette.waitFor({ state: 'hidden' });

    await client.openCourses();
    await client.focusCourse(PLAIN_COURSE);
    await client.startSession();
    await client.page
      .getByRole('button', { name: 'Показать ответ', exact: true })
      .waitFor({ timeout: 30_000 });
    expect(commands.route()).toMatch(/^#\/session/);

    await commands.openPalette();
    await commands.search('поприветствовать');
    await commands.combobox.press('Enter');
    await expectText(commands.notice, GREETING);
    // экран сессии остался на месте
    expect(commands.route()).toMatch(/^#\/session/);
    await client.page
      .getByRole('button', { name: 'Показать ответ', exact: true })
      .waitFor();
  });

  it('на низком окне прокручивается только список: поле поиска и верх палитры не сдвигаются', async () => {
    const { commands, client } = await prepare();
    const cdp = await client.page.context().newCDPSession(client.page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 900,
      height: 340,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await commands.openPalette();
    const top = async () => (await commands.combobox.boundingBox())?.y;
    // переход диалога закончился: положение поля больше не меняется
    await expect
      .poll(async () => {
        const first = await top();
        await client.page.waitForTimeout(150);
        return (await top()) === first;
      })
      .toBe(true);
    const before = await top();
    // список выше окна: он прокручивается, поле поиска остаётся на месте
    for (let i = 0; i < 3; i++) await commands.combobox.press('ArrowDown');
    expect(await top()).toBe(before);
    const last = commands.options.nth(3);
    const list = await commands.palette.locator('.list-wrap').boundingBox();
    const row = await last.boundingBox();
    expect(row!.y + row!.height).toBeLessThanOrEqual(
      list!.y + list!.height + 1,
    );
    // фильтр меняет число строк, но не верх палитры
    await commands.search('сломаться');
    expect(await top()).toBe(before);
    await commands.search('нет такой команды');
    expect(await top()).toBe(before);
  });

  it('ошибка команды — понятное сообщение с текстом расширения; пока команда выполняется, повторный запуск отключён; таймаут — отдельное сообщение', async () => {
    const { commands } = await prepare();
    await commands.openPalette();
    await commands.search('сломаться');
    await commands.combobox.press('Enter');
    await expectText(
      commands.notice,
      'Не удалось выполнить команду: кубик сломан',
    );

    await commands.openPalette();
    await commands.search('зависнуть');
    await commands.combobox.press('Enter');
    await commands.palette.waitFor({ state: 'hidden' });
    // команда ещё выполняется: в палитре она отключена
    await commands.openPalette();
    await commands.search('зависнуть');
    await expect
      .poll(() => commands.options.first().getAttribute('aria-disabled'))
      .toBe('true');
    await commands.combobox.press('Enter');
    expect(await commands.palette.isVisible()).toBe(true);
    await commands.combobox.press('Escape');
    await expectText(commands.notice, 'Время ожидания команды истекло', 30_000);
    await commands.openPalette();
    await commands.search('зависнуть');
    await expect
      .poll(() => commands.options.first().getAttribute('aria-disabled'))
      .toBe('false');
  });
});

describe('срок активации (R4, R5, R7)', () => {
  it('расширение с вечным activate(): команда из палитры — «не запустилось за 10 с», повтор отвечает сразу тем же сообщением', async () => {
    const { commands } = await prepare({ 'acme.slowstart': SLOW_START_DIR });
    const run = async () => {
      await commands.openPalette();
      await commands.search('медленное расширение');
      await commands.combobox.press('Enter');
    };
    const started = Date.now();
    await run();
    await expectText(
      commands.notice,
      'Расширение не запустилось за 10 с',
      30_000,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_000);

    // сбой запомнен: новая активация не запускается, ответ приходит без ожидания срока
    const again = Date.now();
    await commands.notice.getByRole('button', { name: 'Закрыть' }).click();
    await run();
    await expectText(commands.notice, 'Расширение не запустилось за 10 с');
    expect(Date.now() - again).toBeLessThan(5_000);
  });
});

describe('панель (R5, R7, R8)', () => {
  it('команда палитры открывает панель со свойствами; страница в iframe sandbox="allow-scripts"; пункт меню; заголовок получает фокус; «Назад»', async () => {
    const { commands, client } = await prepare();
    // пункт бокового меню есть и ведёт на панель
    await expectVisible(commands.navItem(PANEL_TITLE));

    await openPanelFromPalette({ commands, client } as Windows);
    expect(await commands.frameElement.getAttribute('sandbox')).toBe(
      'allow-scripts',
    );
    await expectText(commands.panelHeading, PANEL_TITLE);
    await expect
      .poll(() => client.page.evaluate(() => document.activeElement?.tagName))
      .toBe('H1');
    await expectText(
      commands.panelRole('props'),
      'Свойства: {"from":"command","opened":1}',
    );
    await expectText(commands.panelRole('panel-id'), 'acme.commands.main');
    expect(
      await commands.navItem(PANEL_TITLE).getAttribute('aria-current'),
    ).toBe('page');

    await commands.backButton.click();
    await expect.poll(() => commands.route()).not.toBe(PANEL_ROUTE);
  });

  it('пункт меню открывает панель без свойств; панель вызывает команды своего расширения, в том числе с palette:false; эффекты исполняет приложение', async () => {
    const { commands, client } = await prepare();
    await commands.navItem(PANEL_TITLE).click();
    await expect.poll(() => commands.route()).toBe(PANEL_ROUTE);
    await expectText(commands.panelRole('props'), 'Свойства: null');
    const stillSameWindow = await client.markWindow();

    await commands.panelButton('Прибавить').click();
    await expectText(commands.panelRole('count'), 'Счётчик: 1');
    await commands.panelButton('Прибавить').click();
    await expectText(commands.panelRole('count'), 'Счётчик: 2');
    expect(readExtensionData(workspace!.userData, COMMANDS_ID).storage).toEqual(
      {
        count: 2,
      },
    );

    // notify из панели показывает приложение
    await commands.panelButton('Уведомить').click();
    await expectText(commands.notice, GREETING);

    // openPanel из панели обновляет свойства, рамка остаётся прежней
    await commands.frameElement.evaluate((node) =>
      Reflect.set(node, '__same', true),
    );
    await commands.panelButton('Открыть снова').click();
    await expectText(
      commands.panelRole('props'),
      'Свойства: {"from":"command","opened":1}',
    );
    await commands.panelButton('Открыть снова').click();
    await expectText(
      commands.panelRole('props'),
      'Свойства: {"from":"command","opened":2}',
    );
    expect(
      await commands.frameElement.evaluate((node) =>
        Reflect.get(node, '__same'),
      ),
    ).toBe(true);

    // ошибка обработчика приходит панели отклонённым промисом
    await commands.panelButton('Сломать').click();
    await expectText(commands.panelRole('result'), 'Ошибка: кубик сломан');
    await stillSameWindow();
  });

  it('Ctrl+K при фокусе внутри рамки панели открывает палитру; после Escape фокус возвращается в рамку', async () => {
    const { commands, client } = await prepare();
    await commands.navItem(PANEL_TITLE).click();
    const input = commands.frame.getByLabel('Поле панели');
    await input.click();
    await input.fill('текст');
    await client.page.keyboard.press('Control+K');
    await commands.combobox.waitFor({ timeout: 15_000 });
    // сочетание не попало в поле панели
    expect(await input.inputValue()).toBe('текст');
    await commands.combobox.press('Escape');
    await commands.palette.waitFor({ state: 'hidden' });
    await expect
      .poll(() => client.page.evaluate(() => document.activeElement?.tagName))
      .toBe('IFRAME');
  });

  it('подделка: панель не может вызвать команду чужого расширения ни через call, ни сообщением с чужим extensionId', async () => {
    const { commands } = await prepare({
      [COMMANDS_ID]: COMMANDS_DIR,
      [VICTIM_ID]: VICTIM_DIR,
    });
    await commands.navItem(PANEL_TITLE).click();
    await commands.panelButton('Чужая команда').click();
    await expectText(
      commands.panelRole('result'),
      'Ошибка: unknown command: acme.victim.mark',
    );

    await commands.panelButton('Подделка').click();
    // следующий настоящий вызов проходит после подделки: она уже обработана
    await commands.panelButton('Прибавить').click();
    await expectText(commands.panelRole('count'), 'Счётчик: 1');
    await expectCount(commands.notice.filter({ hasText: 'жертва' }), 0);
    expect(victimData().storage).toEqual({});
    // палитра по-прежнему видит команду жертвы как обычную чужую команду
    await commands.openPalette();
    await commands.search('жертва');
    expect((await commands.optionTitles()).length).toBe(1);
  });

  it('доверенное расширение: панель всё равно в iframe sandbox="allow-scripts"', async () => {
    const { commands, client } = await prepare();
    await client.openSettingsExtensions();
    await client.setExtensionSwitch(COMMANDS_ID, 'trusted', true);
    await commands.navItem(PANEL_TITLE).click();
    await commands.panelRole('panel-id').waitFor({ timeout: 30_000 });
    expect(await commands.frameElement.getAttribute('sandbox')).toBe(
      'allow-scripts',
    );
    expect(await client.page.locator('.v-main iframe').count()).toBe(1);
    await commands.panelButton('Прибавить').click();
    await expectText(commands.panelRole('count'), 'Счётчик: 1');
  });
});

describe('живое применение (R4, R5, R6)', () => {
  it('отключение и возвращение расширения в другом окне: команды исчезают и возвращаются, панель показывает пустое состояние и оживает, окно не перезагружается', async () => {
    const first = await prepare();
    const { commands, client } = first;
    await commands.navItem(PANEL_TITLE).click();
    await commands.panelRole('panel-id').waitFor({ timeout: 30_000 });
    const stillSameWindow = await client.markWindow();

    const second = operate(await app!.openWindow());
    await second.client.openSettingsExtensions();
    await second.client.setExtensionSwitch(COMMANDS_ID, 'enabled', false);

    // панель отключённого расширения: пустое состояние со ссылкой на план дня
    await expectVisible(commands.unavailable);
    await expectText(commands.panelHeading, 'Панель недоступна');
    await expectCount(commands.navItem(PANEL_TITLE), 0);
    await expectCount(commands.frameElement, 0);
    await expectVisible(
      client.page.getByRole('link', { name: 'К плану на сегодня' }),
    );
    await commands.openPalette();
    await expectCount(commands.extensionOptions, 0);

    // расширение вернулось, пока палитра открыта: строки появляются без перезагрузки
    await second.client.setExtensionSwitch(COMMANDS_ID, 'enabled', true);
    await expect
      .poll(async () => (await commands.extensionTitles()).length, {
        timeout: 30_000,
      })
      .toBe(4);
    await commands.combobox.press('Escape');
    await commands.panelRole('panel-id').waitFor({ timeout: 30_000 });
    await expectVisible(commands.navItem(PANEL_TITLE));
    await stillSameWindow();
  });

  it('список палитры обновляется по contributions-changed: выбранная строка держится за командой, пропавшие расширения исчезают, у отключённых расширений строк не остаётся, команды приложения на месте', async () => {
    const { commands } = await prepare({
      [COMMANDS_ID]: COMMANDS_DIR,
      [VICTIM_ID]: VICTIM_DIR,
    });
    await commands.openPalette();
    await expect.poll(() => commands.extensionOptions.count()).toBe(5);
    // запрос оставляет только команды расширений; из первой строки стрелка вверх уходит на последнюю
    await commands.search('acme');
    await commands.combobox.press('ArrowUp');
    const selected = commands.palette.locator(
      '[role="option"][aria-selected="true"]',
    );
    await expectText(selected, 'Сломаться');

    const second = operate(await app!.openWindow());
    await second.client.openSettingsExtensions();
    await second.client.setExtensionSwitch(VICTIM_ID, 'enabled', false);
    await expect
      .poll(() => commands.extensionOptions.count(), { timeout: 30_000 })
      .toBe(4);
    // строка выше пропала, выбор остался на той же команде
    await expectText(selected, 'Сломаться');
    expect(await commands.optionTitles()).not.toContain('Отметить жертву');

    await second.client.setExtensionSwitch(COMMANDS_ID, 'enabled', false);
    await expectCount(commands.extensionOptions, 0, 30_000);
    // команды приложения остаются: без запроса палитра не пустеет
    await commands.search('');
    expect(await commands.options.count()).toBeGreaterThan(0);
  });

  it('удаление расширения убирает пункт меню и команды без перезагрузки окна', async () => {
    server = await startCatalogServer([COMMANDS]);
    workspace = await createWorkspace({ libraryFiles: PLAIN_LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: COMMANDS_ID,
      dir: COMMANDS_DIR,
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    await expectVisible(first.commands.navItem(PANEL_TITLE));
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.openRemoveDialog(COMMANDS_ID);
    await second.catalog.confirmRemove();

    await expectCount(first.commands.navItem(PANEL_TITLE), 0);
    await first.commands.openPalette();
    await expectCount(first.commands.extensionOptions, 0);
    await stillSameWindow();
  });

  it('обновление расширения пересоздаёт рамку панели (новая revision) без перезагрузки окна', async () => {
    server = await startCatalogServer([COMMANDS_1_1]);
    workspace = await createWorkspace({ libraryFiles: PLAIN_LIBRARY });
    await seedCatalogInstall(workspace.userData, {
      id: COMMANDS_ID,
      dir: COMMANDS_DIR,
      version: '1.0.0',
      catalogUrl: server.url,
    });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const first = operate(app.page);
    await first.commands.navItem(PANEL_TITLE).click();
    await expectText(
      first.commands.frame.getByRole('heading', { level: 2 }),
      'v1.0.0',
    );
    await first.commands.frameElement.evaluate((node) =>
      Reflect.set(node, '__old', true),
    );
    const stillSameWindow = await first.client.markWindow();

    const second = operate(await app.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.updateFromRow(COMMANDS_ID);
    await second.catalog.confirmInstall();
    await second.catalog.closeDialog();

    await expectText(
      first.commands.frame.getByRole('heading', { level: 2 }),
      'v1.1.0',
      30_000,
    );
    // это уже другой iframe, а не перезагруженный прежний
    expect(
      await first.commands.frameElement.evaluate((node) =>
        Reflect.get(node, '__old'),
      ),
    ).toBeUndefined();
    expect(first.commands.route()).toBe(PANEL_ROUTE);
    await stillSameWindow();
  });

  it('режим разработчика: правка модуля панели пересоздаёт рамку', async () => {
    devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-panel-'));
    await cp(COMMANDS_DIR, join(devRoot, COMMANDS_ID), { recursive: true });
    const { commands, client } = await prepare(
      {},
      {
        DOLPHY_DEV_EXTENSIONS: devRoot,
      },
    );
    await commands.navItem(PANEL_TITLE).click();
    await expectText(
      commands.frame.getByRole('heading', { level: 2 }),
      'v1.0.0',
    );
    const stillSameWindow = await client.markWindow();

    const file = join(devRoot, COMMANDS_ID, 'panel.mjs');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace("'1.0.0'", "'dev-edit'"),
    );
    await expectText(
      commands.frame.getByRole('heading', { level: 2 }),
      'vdev-edit',
      30_000,
    );
    await stillSameWindow();
  });
});

describe('каталог (R10)', () => {
  it('карточка, диалог установки и список установленных показывают «Команды» и «Панели»; установка добавляет пункт меню и команды без перезагрузки', async () => {
    server = await startCatalogServer([COMMANDS]);
    workspace = await createWorkspace({ libraryFiles: PLAIN_LIBRARY });
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    await waitForShell(app.page);
    const { client, catalog, commands } = operate(app.page);
    await expectCount(commands.navItem(PANEL_TITLE), 0);
    const stillSameWindow = await client.markWindow();

    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await expectText(catalog.catalogCard(COMMANDS_ID), 'Команды');
    await expectText(catalog.catalogCard(COMMANDS_ID), 'Панели');
    await catalog.toggleKind('Панели');
    expect(await catalog.catalogNames()).toEqual(['Commands']);
    await catalog.toggleKind('Панели');

    await catalog.installButton(COMMANDS_ID).click();
    await expectText(catalog.dialog, 'Команды');
    await expectText(catalog.dialog, 'Панели');
    await catalog.confirmInstall();
    await catalog.closeDialog();
    await catalog.openInstalledTab();
    const row = await catalog.installedText(COMMANDS_ID);
    expect(row).toContain('Команды');
    expect(row).toContain('Панели');

    await expectVisible(commands.navItem(PANEL_TITLE));
    await commands.openPalette();
    expect((await commands.extensionTitles()).length).toBe(4);
    await stillSameWindow();
  });
});
