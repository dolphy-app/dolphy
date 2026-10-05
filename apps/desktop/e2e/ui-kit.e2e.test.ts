import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Frame, Locator, Page } from 'playwright-core';
import { en, ru } from 'vuetify/locale';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { runAxe } from './support/axe.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { CommandsClient } from './support/commands-client.ts';
import { MOD_KEY } from './support/keys.ts';
import {
  expectAttribute,
  expectFocused,
  expectText,
  expectVisible,
} from './support/locator.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/ui-kit-extension', import.meta.url),
);
const UI_ID = 'acme.uikit';
const PANEL_TITLE = 'Набор элементов';
const GROUPS = ['choice', 'feedback', 'fields', 'navigation', 'table'] as const;
type Scheme = 'light' | 'dark';

let extension: BuiltExtension | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** Панель собирается `dolphy-ext build`, как собрал бы автор: Vue, Vuetify и их CSS в `panel.mjs`. */
beforeAll(async () => {
  extension = await buildFixtureExtension(FIXTURE);
}, 180_000);

afterAll(async () => {
  await extension?.dispose();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const openPanel = async () => {
  if (extension === null) throw new Error('the panel is not built');
  workspace = await createWorkspace({
    extensions: { [UI_ID]: extension.dir },
    libraryFiles: PLAIN_LIBRARY,
  });
  app = await launchApp(workspace.userData);
  const { page } = app;
  await page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  const commands = new CommandsClient(page);
  await commands.navItem(PANEL_TITLE).click();
  const handle = await commands.frameElement.elementHandle({ timeout: 30_000 });
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('the panel frame did not load');
  await frame.getByRole('heading', { name: 'Набор элементов' }).waitFor();
  return { page, commands, frame };
};

/** Рамка получила тему приложения: `color-scheme` её корня совпал с ожидаемым. */
const setScheme = async (page: Page, frame: Frame, scheme: Scheme) => {
  await page.emulateMedia({ colorScheme: scheme });
  await expect
    .poll(
      () => frame.evaluate(() => document.documentElement.style.colorScheme),
      { timeout: 15_000 },
    )
    .toBe(scheme);
};

/** Цвет из переменных темы рамки: то, что получил бы элемент без Vuetify. */
const frameColor = (
  frame: Frame,
  name: string,
  property: 'color' | 'background-color',
) =>
  frame.evaluate(
    ([variable, prop]) => {
      const probe = document.createElement('div');
      probe.style.setProperty(prop, `rgb(var(--v-theme-${variable}))`);
      document.documentElement.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      return value;
    },
    [name, property] as const,
  );

const colorOf = (locator: Locator, property: 'color' | 'background-color') =>
  locator.evaluate(
    (node, prop) => getComputedStyle(node).getPropertyValue(prop),
    property,
  );

/** Рамка не перезагружалась: метка в её `window` пережила смену темы или языка. */
const markFrame = (frame: Frame) =>
  frame.evaluate(() => Reflect.set(window, 'dolphyMark', 1));
const isMarked = (frame: Frame) =>
  frame.evaluate(() => Reflect.get(window, 'dolphyMark') === 1);

const slot = (frame: Frame, name: string): Locator =>
  frame.locator(`[data-slot="${name}"]`);

const menuOf = (frame: Frame): Locator =>
  slot(frame, 'menu').locator('.v-overlay__content');

const dialogOf = (frame: Frame): Locator => frame.getByRole('dialog');

const statusOf = (frame: Frame): Locator =>
  frame.locator('[data-role="status"]');

/**
 * Переход самого оверлея закончился: axe считает контраст по настоящим, а не полупрозрачным цветам.
 * Вложенные бесконечные анимации (заглушка загрузки в `v-card`) не в счёт.
 */
const expectSettled = (content: Locator) =>
  expect
    .poll(
      () =>
        content.evaluate(
          (node) =>
            node.getAnimations().length === 0 &&
            getComputedStyle(node).opacity === '1',
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

describe('набор элементов расширений (@dolphy-app/extension-ui/vuetify)', () => {
  it('R2: цвета компонентов равны переменным темы рамки в светлой и тёмной темах, смена темы не перезагружает рамку', async () => {
    const { page, frame } = await openPanel();
    await markFrame(frame);
    await frame.locator('[data-role="open-dialog"]').click();
    const save = frame.getByRole('button', { name: 'Сохранить' });
    await expectVisible(save);
    const success = slot(frame, 'alert').locator('.v-alert');
    const failure = slot(frame, 'alert-error').locator('.v-alert');
    const chip = slot(frame, 'chip').locator('.v-chip');
    const radioIcon = slot(frame, 'radio').locator(
      'input:checked ~ .v-icon, .v-selection-control__input:has(input:checked) .v-icon',
    );
    const card = dialogOf(frame).locator('.v-card');

    const surfaces: string[] = [];
    for (const scheme of ['light', 'dark', 'light'] as const) {
      await setScheme(page, frame, scheme);
      const expected = {
        primary: await frameColor(frame, 'primary', 'color'),
        surface: await frameColor(frame, 'surface', 'background-color'),
        onSurface: await frameColor(frame, 'on-surface', 'color'),
        success: await frameColor(frame, 'success', 'background-color'),
        onSuccess: await frameColor(frame, 'on-success', 'color'),
        error: await frameColor(frame, 'error', 'background-color'),
        onError: await frameColor(frame, 'on-error', 'color'),
      };
      const reads: [string, Locator, 'color' | 'background-color', string][] = [
        ['кнопка color=primary: текст', save, 'color', expected.primary],
        ['чип color=primary: текст', chip, 'color', expected.primary],
        ['карточка диалога: фон', card, 'background-color', expected.surface],
        [
          'выбранная радиокнопка: значок',
          radioIcon,
          'color',
          expected.onSurface,
        ],
        ['алерт success: фон', success, 'background-color', expected.success],
        ['алерт success: текст', success, 'color', expected.onSuccess],
        ['алерт error: фон', failure, 'background-color', expected.error],
        ['алерт error: текст', failure, 'color', expected.onError],
      ];
      for (const [what, locator, property, value] of reads) {
        await expect
          .poll(() => colorOf(locator.first(), property), {
            message: `${what}, ${scheme}`,
          })
          .toBe(value);
      }
      surfaces.push(expected.surface);
    }
    // тёмная тема действительно другая, а возврат даёт те же цвета
    expect(surfaces[1]).not.toBe(surfaces[0]);
    expect(surfaces[2]).toBe(surfaces[0]);
    // рамка та же: переменные сменились на месте
    expect(await isMarked(frame)).toBe(true);
  });

  it('R2: ни одного нарушения axe serious и critical в обеих темах для каждой группы', async () => {
    const { page, frame } = await openPanel();
    const audit = { impacts: ['serious', 'critical'] } as const;
    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, frame, scheme);
      for (const group of GROUPS) {
        const violations = await runAxe(frame, {
          include: `section[data-group="${group}"]`,
          ...audit,
        });
        expect(violations, `${group}, ${scheme}`).toEqual([]);
      }
      // календарь поля даты открыт: его меню лежит внутри секции полей
      await frame.getByRole('textbox', { name: 'Дата экзамена' }).click();
      await expectVisible(frame.locator('.v-date-picker'));
      await expectSettled(slot(frame, 'date').locator('.v-overlay__content'));
      expect(
        await runAxe(frame, {
          include: 'section[data-group="fields"]',
          ...audit,
        }),
        `календарь, ${scheme}`,
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await frame.locator('.v-date-picker').waitFor({ state: 'hidden' });
      // открытые оверлеи лежат внутри секции навигации
      const navigation = 'section[data-group="navigation"]';
      await frame.getByRole('button', { name: 'Действия' }).click();
      await expectVisible(menuOf(frame).locator('.v-list-item').first());
      await expectSettled(menuOf(frame));
      expect(
        await runAxe(frame, { include: navigation, ...audit }),
        `меню, ${scheme}`,
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await menuOf(frame).waitFor({ state: 'hidden' });

      await frame.locator('[data-role="open-dialog"]').click();
      await expectVisible(dialogOf(frame));
      await expectSettled(dialogOf(frame).locator('.v-overlay__content'));
      expect(
        await runAxe(frame, { include: navigation, ...audit }),
        `диалог, ${scheme}`,
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await dialogOf(frame).waitFor({ state: 'hidden' });

      await frame.getByRole('button', { name: 'Подсказка' }).hover();
      await expectVisible(frame.getByText('Текст подсказки', { exact: true }));
      await expectSettled(
        slot(frame, 'tooltip').locator('.v-overlay__content'),
      );
      expect(
        await runAxe(frame, { include: navigation, ...audit }),
        `подсказка, ${scheme}`,
      ).toEqual([]);
      await frame.getByRole('heading', { name: 'Набор элементов' }).hover();
      await frame
        .getByText('Текст подсказки', { exact: true })
        .waitFor({ state: 'hidden' });

      expect(await runAxe(frame, audit), `панель, ${scheme}`).toEqual([]);
    }
  });

  it('R3: пустая таблица данных говорит по-русски и по-английски вслед за языком приложения', async () => {
    const { page, frame } = await openPanel();
    const empty = slot(frame, 'data-table-empty');
    await expectText(empty, ru.noDataText);
    expect(await frame.evaluate(() => document.documentElement.lang)).toBe(
      'ru',
    );
    // подвал таблицы данных тоже на языке интерфейса
    await expectText(slot(frame, 'data-table'), ru.dataFooter.itemsPerPageText);

    const palette = page.getByTestId('command-palette');
    const switchTo = async (command: string) => {
      await page.keyboard.press(`${MOD_KEY}+K`);
      const search = palette.locator('input[role="combobox"]');
      await search.waitFor();
      await search.fill(command);
      await palette
        .getByRole('option')
        .filter({ hasText: command })
        .first()
        .click();
      await palette.waitFor({ state: 'hidden' });
    };
    await markFrame(frame);
    await switchTo('Язык: English');
    await expectText(empty, en.noDataText);
    await expectText(slot(frame, 'data-table'), en.dataFooter.itemsPerPageText);
    expect(await frame.evaluate(() => document.documentElement.lang)).toBe(
      'en',
    );
    // и обратно, без перезагрузки рамки
    await switchTo('Language: Русский');
    await expectText(empty, ru.noDataText);
    expect(await isMarked(frame)).toBe(true);
  });

  it('клавиатура: стрелки в radio, пробел в checkbox, стрелки во вкладках, меню по Enter и Escape', async () => {
    const { page, frame } = await openPanel();
    const status = statusOf(frame);

    // radio: стрелка вниз выбирает следующий, вверх — предыдущий
    const medium = frame.getByRole('radio', { name: 'Средний' });
    const hard = frame.getByRole('radio', { name: 'Сложный' });
    await medium.focus();
    await page.keyboard.press('ArrowDown');
    await expectText(status, 'Уровень: hard');
    await expectFocused(hard);
    expect(await hard.isChecked()).toBe(true);
    await page.keyboard.press('ArrowUp');
    await expectText(status, 'Уровень: medium');
    await expectFocused(medium);
    expect(await medium.isChecked()).toBe(true);

    // checkbox: пробел переключает
    const powers = frame.getByRole('checkbox', { name: 'Степени' });
    await powers.focus();
    await page.keyboard.press('Space');
    await expectText(status, 'Темы: 1,2');
    expect(await powers.isChecked()).toBe(true);
    await page.keyboard.press('Space');
    await expectText(status, 'Темы: 1');
    expect(await powers.isChecked()).toBe(false);

    // вкладки: стрелка вправо переносит фокус, выбор — Enter
    const overview = frame.getByRole('tab', { name: 'Обзор' });
    const tasks = frame.getByRole('tab', { name: 'Задания' });
    await overview.focus();
    await page.keyboard.press('ArrowRight');
    await expectFocused(tasks);
    await page.keyboard.press('Enter');
    await expectAttribute(tasks, 'aria-selected', 'true');
    await expectText(status, 'Раздел: tasks');
    await expectText(
      frame.getByRole('tabpanel', { name: 'Задания' }),
      'Содержимое: Задания',
    );
    await page.keyboard.press('ArrowLeft');
    await expectFocused(overview);

    // меню: Enter открывает, Escape закрывает и возвращает фокус на кнопку
    const actions = frame.getByRole('button', { name: 'Действия' });
    const items = menuOf(frame).locator('.v-list-item');
    await actions.focus();
    await page.keyboard.press('Enter');
    await expectVisible(items.first());
    // пункты — `menuitem` в `menu`, недоступный помечен
    await expectVisible(frame.getByRole('menu'));
    await expectVisible(frame.getByRole('menuitem', { name: 'Переименовать' }));
    await expectAttribute(
      frame.getByRole('menuitem', { name: 'Удалить' }),
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await menuOf(frame).waitFor({ state: 'hidden' });
    await expectFocused(actions);

    // и снова: стрелка вниз выбирает пункт, Enter подтверждает
    await page.keyboard.press('Enter');
    await expectVisible(items.first());
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expectText(status, 'Действие: ');
    await menuOf(frame).waitFor({ state: 'hidden' });
  });

  it('R4: в режиме panel оверлеи не меняют высоту рамки', async () => {
    const { page, commands, frame } = await openPanel();
    const heightOf = async () =>
      Math.round((await commands.frameElement.boundingBox())?.height ?? -1);
    const before = await heightOf();
    const windowBefore = await page.evaluate(() => window.innerHeight);

    await frame.getByRole('button', { name: 'Действия' }).click();
    await expectVisible(menuOf(frame).locator('.v-list-item').first());
    await page.waitForTimeout(500);
    expect(await heightOf()).toBe(before);
    await page.keyboard.press('Escape');
    await menuOf(frame).waitFor({ state: 'hidden' });

    await frame.locator('[data-role="open-dialog"]').click();
    await expectVisible(dialogOf(frame));
    await page.waitForTimeout(500);
    expect(await heightOf()).toBe(before);
    await page.keyboard.press('Escape');
    await dialogOf(frame).waitFor({ state: 'hidden' });
    expect(await heightOf()).toBe(before);
    expect(await page.evaluate(() => window.innerHeight)).toBe(windowBefore);
  });
});
