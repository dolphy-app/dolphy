import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const EXTENSION_ID = 'acme.sfc';
const SCOPED_RED = 'rgb(255, 0, 0)';

let built: BuiltExtension | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

beforeAll(async () => {
  built = await buildFixtureExtension(
    fileURLToPath(new URL('./fixtures/sfc-extension', import.meta.url)),
  );
}, 180_000);

afterAll(async () => {
  await built?.dispose();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async () => {
  workspace = await createWorkspace({
    extensions: { [EXTENSION_ID]: built!.dir },
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

const role = (scope: Locator, name: string): Locator =>
  scope.locator(`[data-role="${name}"]`);

const style = (locator: Locator, property: string): Promise<string> =>
  locator
    .first()
    .evaluate(
      (node, name) => getComputedStyle(node).getPropertyValue(name),
      property,
    );

const appTheme = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('.v-theme--light, .v-theme--dark')
        ?.className.match(/v-theme--(\S+)/)?.[1] ?? null,
  );

const switchTheme = async (commands: CommandsClient, to: string) => {
  await commands.openPalette();
  await commands.search(to);
  await expect.poll(() => commands.optionTitles()).toContain(to);
  await commands.option(to).first().click();
  await commands.palette.waitFor({ state: 'hidden' });
};

const styleTags = (page: Page): Locator =>
  page.locator(`style[data-dolphy-ext="${EXTENSION_ID}"]`);

const openPanel = async (commands: CommandsClient) => {
  await commands.navItem('SFC-панель').click();
  await expectVisible(commands.page.getByTestId('sfc-panel'));
};

describe('однофайловые компоненты Vue (R7)', () => {
  it('<v-btn> и <v-alert> в шаблоне рисуются компонентами Vuetify, кнопка кликается', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();
    await openPanel(commands);
    const panel = page.getByTestId('sfc-panel');

    const button = role(panel, 'button');
    expect(await button.getAttribute('class')).toContain('v-btn');
    await expectVisible(panel.locator('.v-alert'));
    await expectText(button, 'Нажато 0');
    await button.click();
    await button.click();
    await expectText(button, 'Нажато 2');
    await expectCount(page.locator('iframe'), 0);
    await stillSameWindow();
  });

  it('вставка на SFC рисуется у якоря «Плана на сегодня» с компонентами Vuetify', async () => {
    const { page } = await launch();
    const card = page.getByTestId('sfc-card');
    await expectVisible(card);
    await expectVisible(card.locator('.v-alert'));
    expect(await role(card, 'button').getAttribute('class')).toContain('v-btn');
  });

  it('scoped-правило применено к элементу компонента и не действует на тот же класс в соседнем компоненте', async () => {
    const { page, commands } = await launch();
    // вставка: тот же класс `sfc-note`, правила со `scoped` у неё нет
    const cardNote = role(page.getByTestId('sfc-card'), 'note');
    await expectVisible(cardNote);
    expect(await style(cardNote, 'color')).not.toBe(SCOPED_RED);

    await openPanel(commands);
    const note = role(page.getByTestId('sfc-panel'), 'note');
    expect(await style(note, 'color')).toBe(SCOPED_RED);
    // правило привязано к элементу атрибутом `data-v-*`, а не селектору класса
    expect(
      await note.evaluate((node) =>
        node.getAttributeNames().some((name) => name.startsWith('data-v-')),
      ),
    ).toBe(true);
    // и не красит ничего вне панели
    expect(
      await style(role(page.getByTestId('sfc-panel'), 'theme'), 'color'),
    ).not.toBe(SCOPED_RED);
  });

  it('две темы меняют вид компонента: фон панели и кнопки берутся из переменных темы', async () => {
    const { page, commands } = await launch();
    await openPanel(commands);
    const panel = page.getByTestId('sfc-panel');
    const button = role(panel, 'button');
    await expectVisible(button);

    await switchTheme(commands, 'Тема: Светлая');
    await expect.poll(() => appTheme(page)).toBe('light');
    await expectText(role(panel, 'theme'), 'Тема: light');
    const light = {
      panel: await style(panel, 'background-color'),
      button: await style(button, 'background-color'),
    };

    await switchTheme(commands, 'Тема: Тёмная');
    await expect.poll(() => appTheme(page)).toBe('dark');
    await expectText(role(panel, 'theme'), 'Тема: dark');
    await expect
      .poll(() => style(panel, 'background-color'))
      .not.toBe(light.panel);
    await expect
      .poll(() => style(button, 'background-color'))
      .not.toBe(light.button);
    // сам компонент не пересоздан: клики сохранились бы, но стиль живёт на странице
    expect(await styleTags(page).count()).toBe(1);
  });

  it('тег <style data-dolphy-ext> один; после перезагрузки модуля (выключить и включить расширение) он по-прежнему один', async () => {
    const { page, client } = await launch();
    const stillSameWindow = await client.markWindow();
    await expectCount(styleTags(page), 1);
    const css = await styleTags(page).first().textContent();
    expect(css).toContain('sfc-note');
    expect(css).toContain('sfc-panel');

    const second = new Client(await app!.openWindow());
    await second.openSettingsExtensions();
    await second.setExtensionSwitch(EXTENSION_ID, 'enabled', false);
    await expectCount(page.getByTestId('sfc-card'), 0);
    await second.setExtensionSwitch(EXTENSION_ID, 'enabled', true);
    await expectVisible(page.getByTestId('sfc-card'));
    await expectCount(styleTags(page), 1);
    await expectCount(page.locator('style[data-dolphy-ext]'), 1);
    await stillSameWindow();
  });
});
