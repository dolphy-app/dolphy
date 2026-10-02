import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { expectAttribute, expectCount, expectText } from './support/locator.ts';

const SUNRISE: CatalogSource = {
  dir: join(CATALOG_FIXTURES, 'sunrise-1.0.0'),
  name: 'Sunrise',
  description: 'Тёплая светлая тема «Рассвет»',
  author: 'acme',
};
/** Подпись Mod на платформе окна. */
const MOD = process.platform === 'darwin' ? '⌘' : 'Ctrl+';

const SUNRISE_BACKGROUND = 'rgb(255, 244, 229)';
const DARK_BACKGROUND = 'rgb(14, 16, 32)';
const BUILTIN_BACKGROUNDS = ['rgb(245, 246, 251)', DARK_BACKGROUND];

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;

interface Windows {
  client: Client;
  commands: CommandsClient;
  catalog: CatalogClient;
}

const operate = (page: DolphyApp['page']): Windows => ({
  client: new Client(page),
  commands: new CommandsClient(page),
  catalog: new CatalogClient(page),
});

const waitForShell = (page: DolphyApp['page']) =>
  page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });

const launch = async (sources: CatalogSource[] = []): Promise<Windows> => {
  workspace ??= await createWorkspace();
  server = sources.length > 0 ? await startCatalogServer(sources) : null;
  app = await launchApp(
    workspace.userData,
    server ? catalogEnv(server.url) : undefined,
  );
  await waitForShell(app.page);
  return operate(app.page);
};

const openShortcuts = async (client: Client) => {
  await client.page
    .getByRole('link', { name: 'Настройки', exact: true })
    .click();
  await client.page
    .getByRole('tab', { name: 'Сочетания клавиш', exact: true })
    .click();
  await client.page
    .getByRole('heading', { name: 'Сочетания клавиш', exact: true })
    .waitFor({ timeout: 30_000 });
};

const relaunch = async (): Promise<Windows> => {
  await app?.close();
  return launch();
};

/** Открывает палитру, ищет команду и выполняет её Enter'ом. */
const runCommand = async ({ commands }: Windows, title: string) => {
  await commands.openPalette();
  await commands.search(title);
  await expect.poll(() => commands.optionTitles()).toContain(title);
  await commands.option(title).first().click();
  await commands.palette.waitFor({ state: 'hidden' });
};

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

describe('реестр команд: команды приложения (R2, R5)', () => {
  it('на свежем приложении без расширений палитра не пуста, команды приложения без подписи; поиск «курс» → Enter переходит на «Курсы»', async () => {
    const { commands, client } = await launch();
    await commands.openPalette();
    const titles = await commands.optionTitles();
    expect(titles).toEqual(
      expect.arrayContaining([
        'Перейти: План дня',
        'Перейти: Курсы',
        'Перейти: Граф знаний',
        'Перейти: Настройки',
        'Перейти: Настройки — Внешний вид',
        'Тема: Как в системе',
        'Тема: Светлая',
        'Тема: Тёмная',
        'Язык: Русский',
        'Язык: English',
        'Язык: Как в системе',
      ]),
    );
    expect(titles).toHaveLength(9 + 3 + 3);
    expect(titles).not.toContain('Открыть палитру команд');
    // у команд приложения идентификатора расширения нет
    await expectCount(commands.extensionOptions, 0);

    // группировка по категориям: заголовки групп без запроса
    const headings = await commands.palette
      .locator('.subheader')
      .allInnerTexts();
    expect(headings.map((text) => text.trim())).toEqual([
      'Переход',
      'Тема',
      'Язык',
    ]);

    await commands.search('курс');
    expect((await commands.optionTitles())[0]).toBe('Перейти: Курсы');
    await commands.combobox.press('Enter');
    await commands.palette.waitFor({ state: 'hidden' });
    await expect.poll(() => commands.route()).toBe('#/courses');
    await client.page
      .getByRole('heading', { level: 1 })
      .first()
      .waitFor({ timeout: 30_000 });
  });

  it('вкладка настроек — команда: «Внешний вид» открывает экран внешнего вида', async () => {
    const win = await launch();
    await runCommand(win, 'Перейти: Настройки — Внешний вид');
    await expect.poll(() => win.commands.route()).toBe('#/settings/appearance');
  });

  it('в палитре нет «Открыть палитру команд» (команда скрыта), но сочетание показано справа у команд с клавишами', async () => {
    const { commands } = await launch();
    await commands.openPalette();
    expect(await commands.optionTitles()).not.toContain(
      'Открыть палитру команд',
    );
    await expectText(commands.option('Перейти: Курсы'), MOD + '2');
    await expectText(commands.option('Перейти: Настройки'), MOD + ',');
  });
});

describe('реестр команд: сочетания клавиш (R6, R7, R10)', () => {
  it('в боковом меню нет кнопки палитры; «Настройки → Сочетания клавиш» показывает пять строк с клавишами платформы', async () => {
    const { client } = await launch();
    await expectCount(
      client.page.getByRole('button', { name: /палитр|команд/i }),
      0,
    );
    await openShortcuts(client);
    const rows = client.page.getByTestId('shortcut');
    await expectCount(rows, 5);
    const texts = (await rows.allInnerTexts()).map((text) =>
      text.replace(/\s+/g, ' ').trim(),
    );
    expect(texts).toEqual([
      `Открыть палитру команд ${MOD}K`,
      `Перейти: План дня ${MOD}1`,
      `Перейти: Курсы ${MOD}2`,
      `Перейти: Граф знаний ${MOD}3`,
      `Перейти: Настройки ${MOD},`,
    ]);
    // таблицы с заголовками столбцов и подписью группы
    await expectCount(client.page.getByRole('table'), 2);
    await expectCount(
      client.page.getByRole('table', { name: 'Переход', exact: true }),
      1,
    );
    await expectCount(client.page.getByRole('columnheader'), 4);
  });

  it('кнопка на странице открывает палитру', async () => {
    const { client, commands } = await launch();
    await openShortcuts(client);
    await client.page
      .getByRole('button', { name: /Открыть палитру команд/ })
      .click();
    await commands.combobox.waitFor({ timeout: 15_000 });
    expect((await commands.optionTitles()).length).toBeGreaterThan(0);
  });

  it('Ctrl+1/2/3 и Ctrl+, переходят на страницы', async () => {
    const { client, commands } = await launch();
    await client.page.keyboard.press('Control+2');
    await expect.poll(() => commands.route()).toBe('#/courses');
    await client.page.keyboard.press('Control+3');
    await expect.poll(() => commands.route()).toBe('#/graph');
    await client.page.keyboard.press('Control+1');
    await expect.poll(() => commands.route()).toBe('#/');
    await client.page.keyboard.press('Control+,');
    await expect.poll(() => commands.route()).toBe('#/settings/learning');
  });

  it('те же сочетания не срабатывают при фокусе в текстовом поле; Ctrl+K — срабатывает и там', async () => {
    const { commands, client, catalog } = await launch([SUNRISE]);
    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    const search = client.page.getByRole('searchbox', {
      name: 'Поиск по каталогу',
    });
    await search.focus();
    for (const combo of ['Control+,', 'Control+1', 'Control+2', 'Control+3']) {
      await client.page.keyboard.press(combo);
    }
    expect(commands.route()).toBe('#/settings/extensions');
    await client.page.keyboard.press('Control+K');
    await commands.combobox.waitFor();
    await commands.combobox.press('Escape');
    await commands.palette.waitFor({ state: 'hidden' });

    // вне поля то же сочетание работает
    await client.page
      .getByRole('tab', { name: 'Каталог', exact: true })
      .focus();
    await client.page.keyboard.press('Control+2');
    await expect.poll(() => commands.route()).toBe('#/courses');
  });
});

describe('реестр команд: тема и язык (R2, R3, R8)', () => {
  it('«Тема: Тёмная» применяется сразу, помечена выбранной, переживает перезапуск; «Как в системе» возвращает системную', async () => {
    const first = await launch();
    await runCommand(first, 'Тема: Тёмная');
    await expect.poll(() => first.client.appBackground()).toBe(DARK_BACKGROUND);

    await first.commands.openPalette();
    await first.commands.search('Тема: ');
    const dark = first.commands.option('Тема: Тёмная');
    await expectAttribute(dark, 'aria-checked', 'true');
    await expectText(dark, 'Выбрано');
    await expectAttribute(
      first.commands.option('Тема: Светлая'),
      'aria-checked',
      'false',
    );
    await first.commands.combobox.press('Escape');

    const second = await relaunch();
    await expect
      .poll(() => second.client.appBackground())
      .toBe(DARK_BACKGROUND);
    await second.client.openSettingsAppearance();
    expect(await second.client.isThemeSelected('Тёмная')).toBe(true);

    await runCommand(second, 'Тема: Как в системе');
    await expect
      .poll(async () =>
        BUILTIN_BACKGROUNDS.includes(await second.client.appBackground()),
      )
      .toBe(true);
    expect(await second.client.isThemeSelected('Как в системе')).toBe(true);
  });

  it('«Язык: English» переключает интерфейс без перезагрузки, названия в палитре меняются, выбор сохраняется; экран «Внешний вид» показывает тот же выбор', async () => {
    const first = await launch();
    const stillSameWindow = await first.client.markWindow();
    await runCommand(first, 'Язык: English');

    await expect
      .poll(() =>
        first.client.page.evaluate(() => document.documentElement.lang),
      )
      .toBe('en');
    await first.client.page
      .getByRole('link', { name: "Today's plan", exact: true })
      .waitFor({ timeout: 15_000 });
    await expectCount(
      first.client.page
        .getByRole('navigation', { name: 'More' })
        .getByRole('link', { name: 'Settings', exact: true }),
      1,
    );

    await first.commands.page.keyboard.press('Control+K');
    await first.commands.combobox.waitFor();
    expect(await first.commands.optionTitles()).toEqual(
      expect.arrayContaining([
        'Go to: Courses',
        'Theme: Dark',
        'Language: English',
        'Language: Русский',
      ]),
    );
    await first.commands.search('Language');
    await expectAttribute(
      first.commands.option('Language: English'),
      'aria-checked',
      'true',
    );
    await expectText(first.commands.option('Language: English'), 'Selected');
    await first.commands.combobox.press('Escape');
    await stillSameWindow();

    // выбор сохранён: после перезапуска интерфейс английский
    const second = await relaunch();
    await second.client.page
      .getByRole('link', { name: "Today's plan", exact: true })
      .waitFor({ timeout: 30_000 });
    await second.commands.page.keyboard.press('Control+K');
    await second.commands.search('Language: Русский');
    await second.commands.combobox.press('Enter');
    await second.client.page
      .getByRole('link', { name: 'План на сегодня', exact: true })
      .waitFor({ timeout: 15_000 });
  });

  it('тема расширения становится командой сразу после установки в другом окне и пропадает при удалении, без перезагрузки; выбранная тема применяется', async () => {
    const first = await launch([SUNRISE]);
    const stillSameWindow = await first.client.markWindow();
    await first.commands.openPalette();
    await first.commands.search('Тема: Рассвет');
    await expectCount(first.commands.options, 0);

    // установка в другом окне; палитра первого окна открыта и обновляется на месте
    const second = operate(await app!.openWindow());
    await second.client.openSettingsExtensions();
    await second.catalog.openCatalogTab();
    await second.catalog.installButton('acme.sunrise').click();
    await second.catalog.confirmInstall();
    await second.catalog.closeDialog();

    await expect
      .poll(() => first.commands.optionTitles(), { timeout: 30_000 })
      .toEqual(['Тема: Рассвет']);
    // название расширения — данные, подписи с id расширения нет
    await expectCount(first.commands.extensionOptions, 0);
    await first.commands.combobox.press('Enter');
    await first.commands.palette.waitFor({ state: 'hidden' });
    await expect
      .poll(() => first.client.appBackground())
      .toBe(SUNRISE_BACKGROUND);
    await first.commands.openPalette();
    await first.commands.search('Тема: Рассвет');
    await expectAttribute(
      first.commands.option('Тема: Рассвет'),
      'aria-checked',
      'true',
    );
    await first.commands.combobox.press('Escape');

    // удаление: команда пропадает, окно — «Как в системе»
    await second.client.openSettingsExtensions();
    await second.catalog.openRemoveDialog('acme.sunrise');
    await second.catalog.confirmRemove();
    await first.commands.openPalette();
    await first.commands.search('Тема: Рассвет');
    await expectCount(first.commands.options, 0, 30_000);
    await first.commands.search('Тема: Как в системе');
    await expectAttribute(
      first.commands.option('Тема: Как в системе'),
      'aria-checked',
      'true',
    );
    await stillSameWindow();
  });
});
