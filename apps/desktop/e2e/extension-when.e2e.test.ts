import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { expectCount, expectText } from './support/locator.ts';
import { MOD_KEY } from './support/keys.ts';
import { PLAIN_COURSE, PLAIN_LIBRARY } from './support/state-client.ts';

const WHEN_ID = 'acme.when';
const WHEN_DIR = fileURLToPath(
  new URL('./fixtures/when-extension', import.meta.url),
);

const ON_COURSES = 'Только на «Курсах»';
const ALWAYS = 'Всегда';
const FOCUSED = 'Только с курсом в фокусе';
const NIGHT = 'Только в тёмной теме';
const OPEN_PANEL = 'Открыть панель условий';
const PANEL_TITLE = 'Панель условий';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const prepare = async () => {
  workspace = await createWorkspace({
    extensions: { [WHEN_ID]: WHEN_DIR },
    libraryFiles: PLAIN_LIBRARY,
  });
  app = await launchApp(workspace.userData);
  const { page } = app;
  await page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return {
    page,
    client: new Client(page),
    commands: new CommandsClient(page),
  };
};

/** Названия команд расширения в палитре (открывает и закрывает её). */
const paletteTitles = async (commands: CommandsClient): Promise<string[]> => {
  await commands.openPalette();
  const titles = await commands.extensionTitles();
  await commands.page.keyboard.press('Escape');
  await commands.palette.waitFor({ state: 'hidden', timeout: 15_000 });
  return titles;
};

const widgetCards = (page: Page): Locator =>
  page.getByTestId('extension-widget');

const sorted = (values: string[]) => [...values].sort();

describe('условие when: команда, панель и виджет (R10, R11)', () => {
  it('команда видна в палитре и выполняется сочетанием только там, где when истинно: «Курсы» — да, «План дня» — нет', async () => {
    const { client, commands } = await prepare();

    // «План дня»: условие маршрута ложно
    expect(sorted(await paletteTitles(commands))).toEqual(
      sorted([ALWAYS, OPEN_PANEL]),
    );
    await commands.page.keyboard.press(`${MOD_KEY}+Shift+J`);
    await expectCount(commands.notice, 0);

    // «Курсы»: условие истинно без перезагрузки окна
    const stillSameWindow = await client.markWindow();
    await client.openCourses();
    expect(sorted(await paletteTitles(commands))).toEqual(
      sorted([ON_COURSES, ALWAYS, OPEN_PANEL]),
    );
    await commands.page.keyboard.press(`${MOD_KEY}+Shift+J`);
    await expectText(commands.notice, 'Выполнено: courses');
    await stillSameWindow();

    // обратно на «План дня»: сочетание снова молчит
    await client.openPlan();
    await commands.page.keyboard.press('Escape');
    await expect
      .poll(() => commands.notice.count(), { timeout: 15_000 })
      .toBe(0);
    await commands.page.keyboard.press(`${MOD_KEY}+Shift+J`);
    await expectCount(commands.notice, 0);
  });

  it('пункт меню панели с when скрыт вне «Курсов»; панель по-прежнему открывается командой и зовёт свою скрытую команду, у которой when ложно', async () => {
    const { client, commands, page } = await prepare();
    await expectCount(commands.navItem(PANEL_TITLE), 0);

    await client.openCourses();
    await expectCount(commands.navItem(PANEL_TITLE), 1);
    await client.openPlan();
    await expectCount(commands.navItem(PANEL_TITLE), 0);

    // команда из палитры на «Плане дня»: when панели ложно, но openPanel работает
    await commands.openPalette();
    await commands.search(OPEN_PANEL);
    await commands.combobox.press('Enter');
    await commands.panel
      .getByRole('heading', { level: 2 })
      .waitFor({ timeout: 30_000 });
    expect(commands.route()).toBe(`#/ext/${WHEN_ID}/acme.when.main`);
    await expectCount(commands.navItem(PANEL_TITLE), 0);
    // команда с when «route == courses» вызывается панелью, пока открыта другая страница
    await commands.pressPanelButton('Позвать');
    await expect
      .poll(() => commands.panelRole('result').innerText(), {
        timeout: 30_000,
      })
      .toBe('ok {"pong":true}');
    await expectCount(page.getByTestId('panel-unavailable'), 0);
  });

  it('виджет рисуется по when: без курса в фокусе — один, с курсом — другой; значение пересчитывается без перезагрузки', async () => {
    const { client, page } = await prepare();
    const titles = async () =>
      (
        await widgetCards(page)
          .getByRole('heading', { level: 3 })
          .allInnerTexts()
      ).map((text) => text.trim());

    await expectCount(widgetCards(page), 1);
    expect(await titles()).toEqual(['Без курса']);

    const stillSameWindow = await client.markWindow();
    await client.openCourses();
    await client.focusCourse(PLAIN_COURSE);
    await expectCount(widgetCards(page), 1);
    expect(await titles()).toEqual(['С курсом']);
    await stillSameWindow();
  });

  it('when по курсу в фокусе и по теме меняет палитру на лету', async () => {
    const { client, commands } = await prepare();
    expect(await paletteTitles(commands)).not.toContain(FOCUSED);

    await client.openCourses();
    await client.focusCourse(PLAIN_COURSE);
    expect(await paletteTitles(commands)).toContain(FOCUSED);

    await client.openSettingsAppearance();
    expect(await paletteTitles(commands)).not.toContain(NIGHT);
    await client.selectTheme('Тёмная');
    expect(await paletteTitles(commands)).toContain(NIGHT);
    await client.selectTheme('Светлая');
    expect(await paletteTitles(commands)).not.toContain(NIGHT);
  });
});
