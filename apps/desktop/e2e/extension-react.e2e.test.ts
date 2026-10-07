import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { MOD_KEY } from './support/keys.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const REACT_ID = 'acme.react';
const SFC_ID = 'acme.sfc';

let react: BuiltExtension | null = null;
let sfc: BuiltExtension | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

beforeAll(async () => {
  react = await buildFixtureExtension(fixture('react-extension'));
  sfc = await buildFixtureExtension(fixture('sfc-extension'));
}, 180_000);

afterAll(async () => {
  await react?.dispose();
  await sfc?.dispose();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async (withSfc = false) => {
  workspace = await createWorkspace({
    extensions: {
      [REACT_ID]: react!.dir,
      ...(withSfc ? { [SFC_ID]: sfc!.dir } : {}),
    },
  });
  app = await launchApp(workspace.userData);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return {
    page: app.page,
    client: new Client(app.page),
    commands: new CommandsClient(app.page),
  };
};

const panelOf = (page: Page): Locator => page.getByTestId('react-panel');
const role = (scope: Locator, name: string): Locator =>
  scope.locator(`[data-role="${name}"]`);
const press = (scope: Locator, name: string) =>
  scope.getByRole('button', { name, exact: true }).click();

const injection = (page: Page, id: string): Locator =>
  page.locator(
    `[data-testid="extension-injection"][data-ext-injection="${id}"]`,
  );

const openReactPanel = async (commands: CommandsClient) => {
  await commands.navItem('React-панель').click();
  await expectVisible(panelOf(commands.page));
};

/** Палитра на любом языке интерфейса: диалог находится по `data-testid`, команда — по названию. */
const runCommand = async (commands: CommandsClient, title: string) => {
  const palette = commands.page.getByTestId('command-palette');
  await commands.page.keyboard.press(`${MOD_KEY}+K`);
  const combobox = palette.locator('input[role="combobox"]');
  await combobox.waitFor({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        commands.page.evaluate(
          () =>
            document.activeElement?.getAttribute('role') === 'combobox' &&
            document
              .querySelector('.v-dialog .v-overlay__content')
              ?.className.includes('transition') === false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await combobox.fill(title);
  const option = palette.getByRole('option').filter({ hasText: title }).first();
  await expectVisible(option);
  await option.click();
  await palette.waitFor({ state: 'hidden' });
};

/** Тема, которую окно сейчас применило (`v-theme--<имя>` на корне Vuetify). */
const appTheme = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('.v-theme--light, .v-theme--dark')
        ?.className.match(/v-theme--(\S+)/)?.[1] ?? null,
  );

const expectThemeFollows = async (page: Page, scope: Locator) => {
  await expect
    .poll(async () =>
      (await role(scope, 'theme').innerText()).replace('Тема: ', ''),
    )
    .toBe(await appTheme(page));
};

const switchTheme = async (page: Page, commands: CommandsClient) => {
  const before = await appTheme(page);
  await runCommand(
    commands,
    before === 'dark' ? 'Тема: Светлая' : 'Тема: Тёмная',
  );
  await expect.poll(() => appTheme(page)).not.toBe(before);
};

interface Counters {
  created: number;
  unmounted: number;
  domCleanups: number;
}

const counters = (page: Page): Promise<Counters | null> =>
  page.evaluate(
    () =>
      (Reflect.get(globalThis, '__reactExtension') as Counters | undefined) ??
      null,
  );

describe('панель на React (R1, R3, R4)', () => {
  it('рисуется в дереве окна без iframe; RPC, notify и счётчик состояния работают', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();
    await openReactPanel(commands);
    const panel = panelOf(page);
    await expectText(role(panel, 'panel-id'), 'acme.react.main');
    await expectCount(page.locator('iframe'), 0);

    await press(panel, 'Нажать');
    await press(panel, 'Нажать');
    await expectText(role(panel, 'clicks'), 'Нажатий 2');

    await press(panel, 'Поздороваться');
    await expectText(role(panel, 'result'), 'ok Привет, React!');

    await press(panel, 'Уведомить');
    await expectText(commands.notice, 'Привет из React');
    await stillSameWindow();
  });

  it('повторный openPanel с новыми свойствами обновляет панель без перезапуска компонента', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();
    await openReactPanel(commands);
    const panel = panelOf(page);
    await expectText(role(panel, 'props'), 'null');
    await press(panel, 'Нажать');

    const reopen = 'Открыть React-панель с новым раундом';
    await runCommand(commands, reopen);
    await expectText(role(panel, 'props'), '{"round":1}');
    await runCommand(commands, reopen);
    await expectText(role(panel, 'props'), '{"round":2}');

    // тот же экземпляр: состояние сохранилось, компонент создан один раз
    await expectText(role(panel, 'clicks'), 'Нажатий 1');
    await expectText(role(panel, 'instance'), 'Экземпляр 1');
    expect((await counters(page))?.created).toBe(1);
    await stillSameWindow();
  });

  it('смена темы и языка в окне обновляет панель и вставку на чистом DOM без перезагрузки', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();

    const dom = page.getByTestId('react-dom-injection');
    await expectVisible(dom);
    await expectThemeFollows(page, dom);
    await expectText(role(dom, 'locale'), 'Язык: ru');
    await switchTheme(page, commands);
    await expectThemeFollows(page, dom);
    await runCommand(commands, 'Язык: English');
    await expectText(role(dom, 'locale'), 'Язык: en');
    await runCommand(commands, 'Language: Русский');
    await expectText(role(dom, 'locale'), 'Язык: ru');

    await openReactPanel(commands);
    const panel = panelOf(page);
    await expectThemeFollows(page, panel);
    await expectText(role(panel, 'locale'), 'Язык: ru');
    await press(panel, 'Нажать');
    await switchTheme(page, commands);
    await expectThemeFollows(page, panel);
    await runCommand(commands, 'Язык: English');
    await expectText(role(panel, 'locale'), 'Язык: en');
    // перерисовка, а не пересоздание: счётчик нажатий цел
    await expectText(role(panel, 'clicks'), 'Нажатий 1');
    await stillSameWindow();
  });
});

describe('очистка при размонтировании (R1)', () => {
  it('уход со страницы размонтирует React-панель и вставку на DOM', async () => {
    const { page, client, commands } = await launch();
    await expectVisible(page.getByTestId('react-dom-injection'));
    expect((await counters(page))?.domCleanups).toBe(0);

    await openReactPanel(commands);
    await expectCount(page.getByTestId('react-dom-injection'), 0);
    await expect.poll(async () => (await counters(page))?.domCleanups).toBe(1);

    await client.openPlan();
    await expectCount(panelOf(page), 0);
    await expect.poll(async () => (await counters(page))?.unmounted).toBe(1);
    await expectVisible(page.getByTestId('react-dom-injection'));
  });

  it('отключение расширения в другом окне убирает вставки и вызывает очистку', async () => {
    const first = await launch();
    const { page } = first;
    await expectVisible(page.getByTestId('react-dom-injection'));
    await expectVisible(page.getByTestId('react-injection'));
    const stillSameWindow = await first.client.markWindow();

    const second = new Client(await app!.openWindow());
    await second.openSettingsExtensions();
    await second.setExtensionSwitch(REACT_ID, 'enabled', false);
    await expectCount(page.getByTestId('extension-injection'), 0);
    await expectCount(page.getByTestId('react-dom-injection'), 0);
    await expect.poll(async () => (await counters(page))?.domCleanups).toBe(1);

    await second.setExtensionSwitch(REACT_ID, 'enabled', true);
    await expectVisible(page.getByTestId('react-dom-injection'));
    await expectVisible(page.getByTestId('react-injection'));
    await stillSameWindow();
  });
});

describe('ошибка React-компонента (R2, R4)', () => {
  it('исключение в render заменяет панель карточкой, «Повторить» рисует заново', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();
    await openReactPanel(commands);
    const panel = panelOf(page);
    await press(panel, 'Нажать');
    await expectText(role(panel, 'instance'), 'Экземпляр 1');

    await press(panel, 'Сломать');
    const failed = page.getByTestId('panel-load-failed');
    await expectVisible(failed);
    await expectText(failed, 'react render boom');
    await expectCount(panelOf(page), 0);
    // окно живо: меню расширений на месте
    await expectVisible(commands.navItem('React-панель'));

    await page.getByTestId('panel-retry').click();
    await expectVisible(panelOf(page));
    await expectCount(page.getByTestId('panel-load-failed'), 0);
    await expectText(role(panelOf(page), 'instance'), 'Экземпляр 2');
    await expectText(role(panelOf(page), 'clicks'), 'Нажатий 0');
    await stillSameWindow();
  });

  it('сломанная вставка на React показывает карточку на своём месте, соседняя вставка цела', async () => {
    const { page, client } = await launch();
    const stillSameWindow = await client.markWindow();
    const broken = injection(page, 'acme.react/acme.react.card');
    await expectVisible(broken.getByTestId('react-injection'));
    await expectVisible(page.getByTestId('react-dom-injection'));

    await press(broken, 'Сломать вставку');
    const failed = broken.getByTestId('extension-injection-failed');
    await expectVisible(failed);
    await expectText(failed, 'react render boom');
    await expectCount(page.getByTestId('extension-injection-failed'), 1);
    await expectVisible(page.getByTestId('react-dom-injection'));

    await broken.getByTestId('extension-injection-retry').click();
    await expectVisible(broken.getByTestId('react-injection'));
    await expectCount(page.getByTestId('extension-injection-failed'), 0);
    await stillSameWindow();
  });
});

describe('React и Vue SFC в одном окне (R2)', () => {
  it('оба расширения живут вместе, видят тему и язык, сбой React не трогает Vue', async () => {
    const { page, client, commands } = await launch(true);
    const stillSameWindow = await client.markWindow();

    const reactCard = page.getByTestId('react-injection');
    const domCard = page.getByTestId('react-dom-injection');
    const vueCard = page.getByTestId('sfc-card');
    await expectVisible(reactCard);
    await expectVisible(domCard);
    await expectVisible(vueCard);
    await expectCount(page.locator('iframe'), 0);
    await expectThemeFollows(page, reactCard);
    await expectThemeFollows(page, vueCard);

    // одна смена темы доходит до обоих фреймворков
    await switchTheme(page, commands);
    await expectThemeFollows(page, reactCard);
    await expectThemeFollows(page, domCard);
    await expectThemeFollows(page, vueCard);

    // сбой React-вставки: карточка только на её месте, Vue-сосед жив и кликается
    await press(reactCard, 'Сломать вставку');
    await expectVisible(page.getByTestId('extension-injection-failed'));
    await expectCount(page.getByTestId('extension-injection-failed'), 1);
    await expectVisible(vueCard);
    await expectVisible(vueCard.locator('.v-btn'));
    await expectVisible(domCard);
    await vueCard.locator('.v-btn').click();

    // сбой React-панели не мешает Vue-панели соседнего расширения
    await openReactPanel(commands);
    await press(panelOf(page), 'Сломать');
    await expectVisible(page.getByTestId('panel-load-failed'));
    await commands.navItem('SFC-панель').click();
    const sfcPanel = page.getByTestId('sfc-panel');
    await expectVisible(sfcPanel);
    await expectVisible(sfcPanel.locator('.v-btn'));
    await sfcPanel.locator('.v-btn').click();
    await expectText(sfcPanel, 'Нажато 1');

    // возврат на страницу создаёт панель заново: сбой не залипает
    await commands.navItem('React-панель').click();
    await expectVisible(panelOf(page));
    await expectCount(page.getByTestId('panel-load-failed'), 0);
    await stillSameWindow();
  });
});
