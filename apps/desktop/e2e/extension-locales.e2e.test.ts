import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

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

const paletteOf = (page: Page) => {
  const palette = page.getByTestId('command-palette');
  return {
    palette,
    combobox: palette.locator('input[role="combobox"]'),
    options: palette.getByRole('option'),
  };
};

/** Палитра на любом языке интерфейса: находит команду и запускает её клавишей Enter. */
const openPalette = async (page: Page, query: string) => {
  const found = paletteOf(page);
  await page.keyboard.press('Control+K');
  await found.combobox.waitFor({ timeout: TIMEOUT });
  // Escape доходит до диалога, только когда переход закончился и поле поиска в фокусе
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement?.getAttribute('role') === 'combobox' &&
            document
              .querySelector('.v-dialog .v-overlay__content')
              ?.className.includes('transition') === false,
        ),
      { timeout: TIMEOUT },
    )
    .toBe(true);
  await found.combobox.fill(query);
  return found;
};

const closePalette = async (page: Page) => {
  await page.keyboard.press('Escape');
  await paletteOf(page).palette.waitFor({ state: 'hidden' });
};

const switchLanguage = async (page: Page, command: string) => {
  const found = await openPalette(page, command);
  await found.options
    .filter({ hasText: command })
    .first()
    .click({ timeout: TIMEOUT });
  await found.palette.waitFor({ state: 'hidden' });
};

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
  renderer: string;
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
  description: 'Всё переводимое в одном расширении',
  kind: 'Вид с переводом',
  renderer: 'Блоки с переводом',
  theme: 'Мох',
  policy: 'Правило с переводом',
  group: 'Поведение',
  mode: 'Скорость',
  modeHint: 'Как быстро идти',
  modeSelected: 'Быстро',
  // есть только в ru.json: на английском остаётся сырой ключ
  lonelyHint: 'Есть только в ru',
  command: 'Перейти туда',
  commandHint: 'Запускает команду перевода',
  category: 'Перевод',
  panel: 'Панель перевода',
};

const EN: Labels = {
  name: 'Locale pack',
  description: 'Everything translatable in one extension',
  kind: 'Locale kind',
  renderer: 'Locale blocks',
  theme: 'Moss',
  policy: 'Locale policy',
  group: 'Behavior',
  mode: 'Speed',
  modeHint: 'How fast to go',
  modeSelected: 'Fast',
  lonelyHint: '%lonely.missing%',
  command: 'Go there',
  commandHint: 'Runs the locale command',
  category: 'Locale',
  panel: 'Locale panel',
};

/** Список расширений: заголовок, описание, чипы вкладов и предупреждение о переводе. */
const expectRow = async (page: Page, labels: Labels) => {
  const target = row(page);
  await expect
    .poll(async () => (await target.locator('h3').innerText()).trim(), {
      timeout: TIMEOUT,
    })
    .toBe(labels.name);
  expect(await target.innerText()).toContain(labels.description);
  const chipTexts = async (point: string) =>
    (await chips(page, point).allInnerTexts()).map((text) => text.trim());
  expect(await chipTexts('exerciseTypes')).toEqual([labels.kind]);
  expect(await chipTexts('markdownRenderers')).toEqual([labels.renderer]);
  expect(await chipTexts('themes')).toEqual([labels.theme]);
  expect(await chipTexts('gradePolicies')).toEqual([labels.policy]);
  expect(await chipTexts('commands')).toEqual([labels.command]);
  expect(await chipTexts('panels')).toEqual([labels.panel]);
  // id остаётся подсказкой чипа
  expect(await chips(page, 'exerciseTypes').getAttribute('title')).toBe(ID);
};

const expectWarning = async (page: Page) => {
  const warning = row(page).locator(
    '[data-testid="diagnostic"][data-code="locale.missing-key"]',
  );
  await warning.waitFor({ timeout: TIMEOUT });
  // структурированное предупреждение: одно, с ключом, которого нет в en
  expect(await warning.count()).toBe(1);
  expect(await warning.innerText()).toContain('lonely.missing');
};

const expectDialog = async (page: Page, labels: Labels) => {
  const dialog = await openDialog(page);
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
  it('на русском все места окна показывают русский текст, ключ без перевода в en даёт предупреждение', async () => {
    workspace = await createWorkspace({ extensions: { [ID]: EXTENSION } });
    const client = await launch();
    await client.openSettingsExtensions();

    await expectRow(client.page, RU);
    await expectWarning(client.page);
    await expectDialog(client.page, RU);
    await expectChrome(client.page, RU);
    await expectThemeAndPolicy(client.page, RU);
  });

  it('смена языка без перезагрузки окна меняет подписи во всех местах; ключа нет — виден сырой %ключ%', async () => {
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
    await expectWarning(client.page);
    await expectDialog(client.page, EN);
    await expectChrome(client.page, EN);
    await expectThemeAndPolicy(client.page, EN);
    await stillSameWindow();

    // и обратно: русский текст возвращается тем же путём
    await switchLanguage(client.page, 'Language: Русский');
    await expectRow(client.page, RU);
    await stillSameWindow();
  });

  it('битый файл перевода игнорируется с предупреждением, расширение работает, подписи берутся из en', async () => {
    workspace = await createWorkspace({ extensions: { [ID]: EXTENSION } });
    await writeFile(
      join(workspace.userData, 'extensions', ID, 'locales', 'ru.json'),
      '{ "name": ',
    );
    const client = await launch();
    await client.openSettingsExtensions();

    // русский интерфейс, но ru.json не читается: цепочка уходит в en
    await expectRow(client.page, EN);
    const warning = row(client.page).locator(
      '[data-testid="diagnostic"][data-code="locale.invalid-file"]',
    );
    await warning.waitFor({ timeout: TIMEOUT });
    expect(await warning.innerText()).toContain('locales/ru.json');
    expect(await row(client.page).innerText()).toContain('Загружено');
    await expectChrome(client.page, { ...EN });
  });
});
