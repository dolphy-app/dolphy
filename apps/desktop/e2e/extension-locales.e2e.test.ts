import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import {
  closePalette,
  openPalette,
  switchLanguage,
} from './support/palette.ts';

const ID = 'acme.locale';
const TIMEOUT = 15_000;
const EXTENSION = fileURLToPath(
  new URL('./fixtures/locale-extension', import.meta.url),
);

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async (): Promise<Client> => {
  app = await launchApp(workspace!.userData);
  return new Client(app.page);
};

const row = (page: Page): Locator =>
  page
    .getByRole('list', {
      name: /^(Установленные расширения|Installed extensions)$/,
    })
    .locator(`[data-extension-id="${ID}"]`);

const chips = (page: Page, point: string): Locator =>
  row(page).locator(`[data-point="${point}"] .v-chip`);

const openDialog = async (page: Page): Promise<Locator> => {
  await row(page).getByTestId(`settings-${ID}`).click();
  const dialog = page.getByTestId('extension-settings');
  await dialog.getByTestId(`setting-${ID}.mode`).waitFor({ timeout: TIMEOUT });
  return dialog;
};

const closeDialog = async (page: Page) => {
  await page.getByTestId('settings-close').click();
  await page
    .getByTestId('extension-settings')
    .waitFor({ state: 'hidden', timeout: TIMEOUT });
};

interface Labels {
  name: string;
  description: string;
  kind: string;
  theme: string;
  policy: string;
  group: string;
  mode: string;
  modeHint: string;
  modeSelected: string;
  lonelyHint: string;
  command: string;
  commandHint: string;
  category: string;
  panel: string;
}

const RU: Labels = {
  name: 'Набор переводов',
  description: 'Всё, что можно перевести, в одном расширении',
  kind: 'Вид с переводом',
  theme: 'Мох',
  policy: 'Правило с переводом',
  group: 'Поведение',
  mode: 'Скорость',
  modeHint: 'Как быстро идти',
  modeSelected: 'Быстро',
  // у подписи нет ru: показывается как есть
  lonelyHint: 'Only in en',
  command: 'Перейти туда',
  commandHint: 'Запускает команду перевода',
  category: 'Перевод',
  panel: 'Панель перевода',
};

const EN: Labels = {
  name: 'Locale pack',
  description: 'Everything translatable in one extension',
  kind: 'Locale kind',
  theme: 'Moss',
  policy: 'Locale policy',
  group: 'Behavior',
  mode: 'Speed',
  modeHint: 'How fast to go',
  modeSelected: 'Fast',
  lonelyHint: 'Only in en',
  command: 'Go there',
  commandHint: 'Runs the locale command',
  category: 'Locale',
  panel: 'Locale panel',
};

/** Список расширений: название и описание манифеста, чипы вкладов на языке окна; рендерер markdown показывается языком блока. */
const expectRow = async (page: Page, labels: Labels) => {
  await expect
    .poll(async () => (await row(page).locator('h3.name').innerText()).trim(), {
      timeout: TIMEOUT,
    })
    .toBe(labels.name);
  expect(await row(page).locator('p.text-body-medium').innerText()).toBe(
    labels.description,
  );
  const chipTexts = async (point: string) =>
    (await chips(page, point).allInnerTexts()).map((text) => text.trim());
  await expect
    .poll(() => chipTexts('exerciseTypes'), { timeout: TIMEOUT })
    .toEqual([labels.kind]);
  expect(await chipTexts('markdownRenderers')).toEqual(['locale']);
  expect(await chipTexts('themes')).toEqual([labels.theme]);
  expect(await chipTexts('gradePolicies')).toEqual([labels.policy]);
  expect(await chipTexts('commands')).toEqual([labels.command]);
  expect(await chipTexts('panels')).toEqual([labels.panel]);
  // id остаётся подсказкой чипа
  expect(await chips(page, 'exerciseTypes').getAttribute('title')).toBe(ID);
};

const expectDialog = async (page: Page, labels: Labels) => {
  const dialog = await openDialog(page);
  expect(
    await dialog.locator('#extension-settings-title').innerText(),
  ).toContain(labels.name);
  expect(
    (await dialog.locator('h3').allInnerTexts()).map((text) => text.trim()),
  ).toEqual([labels.group]);
  const mode = dialog.getByTestId(`setting-${ID}.mode`);
  expect(await mode.innerText()).toContain(labels.mode);
  expect(await mode.innerText()).toContain(labels.modeHint);
  expect(await mode.locator('.v-select__selection').innerText()).toContain(
    labels.modeSelected,
  );
  expect(
    await dialog.getByTestId(`setting-${ID}.lonely`).innerText(),
  ).toContain(labels.lonelyHint);
  await closeDialog(page);
};

const expectChrome = async (page: Page, labels: Labels) => {
  // боковое меню: название панели расширения
  await page
    .getByTestId('extension-nav')
    .getByRole('link', { name: labels.panel, exact: true })
    .waitFor({ timeout: TIMEOUT });
  // палитра: название, описание и категория команды
  const found = await openPalette(page, labels.command);
  const option = found.options.filter({ hasText: labels.command }).first();
  await option.waitFor({ timeout: TIMEOUT });
  const text = await option.innerText();
  expect(text).toContain(labels.commandHint);
  expect(text).toContain(labels.category);
  await closePalette(page);
};

const NAV = {
  settings: /^(Настройки|Settings)$/,
  appearance: /^(Внешний вид|Appearance)$/,
  learning: /^(Обучение|Learning)$/,
  extensions: /^(Расширения|Extensions)$/,
};

const openSettingsTab = async (page: Page, tab: RegExp) => {
  await page.getByRole('link', { name: NAV.settings }).click();
  await page.getByRole('tab', { name: tab }).click();
};

const expectThemeAndPolicy = async (page: Page, labels: Labels) => {
  await openSettingsTab(page, NAV.appearance);
  // радиокнопка плитки скрыта визуально: она в дереве, но не «видна»
  await page
    .getByRole('radio', { name: labels.theme })
    .waitFor({ state: 'attached', timeout: TIMEOUT });
  await openSettingsTab(page, NAV.learning);
  await page.locator('.grade-policy-select .v-field').click();
  await page
    .getByRole('option', { name: new RegExp(`^${labels.policy}`) })
    .waitFor({ timeout: TIMEOUT });
  await page.keyboard.press('Escape');
  await openSettingsTab(page, NAV.extensions);
  await row(page).waitFor({ timeout: TIMEOUT });
};

describe('локализация манифеста расширения', () => {
  it('на русском все места окна показывают русский текст, строка без перевода остаётся как есть', async () => {
    workspace = await createWorkspace({ extensions: { [ID]: EXTENSION } });
    const client = await launch();
    await client.openSettingsExtensions();

    await expectRow(client.page, RU);
    await expectDialog(client.page, RU);
    await expectChrome(client.page, RU);
    await expectThemeAndPolicy(client.page, RU);
  });

  it('смена языка без перезагрузки окна меняет подписи во всех местах; строка без ru остаётся как есть', async () => {
    workspace = await createWorkspace({ extensions: { [ID]: EXTENSION } });
    const client = await launch();
    await client.openSettingsExtensions();
    await expectRow(client.page, RU);
    const stillSameWindow = await client.markWindow();

    await switchLanguage(client.page, 'Язык: English');
    await expect
      .poll(() => client.page.evaluate(() => document.documentElement.lang))
      .toBe('en');

    await expectRow(client.page, EN);
    await expectDialog(client.page, EN);
    await expectChrome(client.page, EN);
    await expectThemeAndPolicy(client.page, EN);
    await stillSameWindow();

    // и обратно: русский текст возвращается тем же путём
    await switchLanguage(client.page, 'Language: Русский');
    await expectRow(client.page, RU);
    await stillSameWindow();
  });

  it('расширения из поставки переводят названия видов вместе с языком; рендерер markdown показан языком блока', async () => {
    workspace = await createWorkspace();
    const client = await launch();
    await client.openSettingsExtensions();
    const bundled = (id: string, point: string) =>
      client.page
        .locator(`[data-extension-id="${id}"] [data-point="${point}"] .v-chip`)
        .first();
    const chipText = async (id: string, point: string) =>
      (await bundled(id, point).innerText()).trim();
    await bundled('dolphy.choice', 'exerciseTypes').waitFor({
      timeout: TIMEOUT,
    });
    expect(await chipText('dolphy.choice', 'exerciseTypes')).toBe(
      'Выбор из вариантов',
    );
    expect(await chipText('dolphy.sql', 'exerciseTypes')).toBe('SQL-запрос');
    expect(await chipText('dolphy.math', 'markdownRenderers')).toBe('math');

    await switchLanguage(client.page, 'Язык: English');
    await expect
      .poll(() => chipText('dolphy.choice', 'exerciseTypes'), {
        timeout: TIMEOUT,
      })
      .toBe('Multiple choice');
    expect(await chipText('dolphy.sql', 'exerciseTypes')).toBe('SQL query');
    expect(await chipText('dolphy.math', 'markdownRenderers')).toBe('math');
  });

  it('расширения из поставки показывают название и описание манифеста на языке окна, смена языка меняет их сразу', async () => {
    workspace = await createWorkspace();
    const client = await launch();
    await client.openSettingsExtensions();
    const shown = async (id: string) => {
      const card = client.page.locator(`[data-extension-id="${id}"]`);
      return [
        (await card.locator('h3.name').innerText()).trim(),
        (await card.locator('p.text-body-medium').first().innerText()).trim(),
      ];
    };
    await client.page
      .locator('[data-extension-id="dolphy.choice"] h3.name')
      .waitFor({ timeout: TIMEOUT });
    expect(await shown('dolphy.choice')).toEqual([
      'Выбор из вариантов',
      'Задания, где нужно выбрать верный ответ или ответы из списка.',
    ]);
    expect(await shown('dolphy.js')).toEqual([
      'JavaScript',
      'Задания по JavaScript: решение проверяется запуском кода против тестов.',
    ]);
    expect(await shown('dolphy.math')).toEqual([
      'Математические формулы',
      'Показывает математические формулы, записанные в LaTeX внутри Markdown.',
    ]);
    expect(await shown('dolphy.sql')).toEqual([
      'SQL',
      'Задания на SQL: запрос выполняется на учебной базе, результат сравнивается с ожидаемым.',
    ]);
    const stillSameWindow = await client.markWindow();

    await switchLanguage(client.page, 'Язык: English');
    await expect
      .poll(async () => (await shown('dolphy.choice'))[0], { timeout: TIMEOUT })
      .toBe('Multiple choice');
    expect(await shown('dolphy.choice')).toEqual([
      'Multiple choice',
      'Exercises where you pick the correct answer or answers from a list.',
    ]);
    expect(await shown('dolphy.math')).toEqual([
      'Math formulas',
      'Renders math formulas written in LaTeX inside Markdown.',
    ]);
    expect(await shown('dolphy.sql')).toEqual([
      'SQL',
      'SQL exercises: your query runs on a sample database and its result is compared with the expected one.',
    ]);
    await stillSameWindow();
  });

  it('страница расширения показывает название и описание на языке окна и меняет их при смене языка', async () => {
    workspace = await createWorkspace({ extensions: { [ID]: EXTENSION } });
    const client = await launch();
    await client.openSettingsExtensions();
    await row(client.page).getByTestId(`details-${ID}`).click();
    const page = client.page.getByTestId('extension-details');
    await page.waitFor({ timeout: TIMEOUT });
    // the description appears with the loaded details, the heading follows it
    const shown = async () => {
      const description = (
        await page.locator('p.text-body-medium').first().innerText()
      ).trim();
      return [await page.getAttribute('aria-label'), description];
    };
    await expect
      .poll(shown, { timeout: TIMEOUT })
      .toEqual([RU.name, RU.description]);

    await switchLanguage(client.page, 'Язык: English');
    await expect
      .poll(shown, { timeout: TIMEOUT })
      .toEqual([EN.name, EN.description]);
  });
});
