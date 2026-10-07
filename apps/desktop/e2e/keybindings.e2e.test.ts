import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { COMMANDS_ID, CommandsClient } from './support/commands-client.ts';
import { MOD_KEY } from './support/keys.ts';
import { expectCount, expectText } from './support/locator.ts';

const COMMANDS_DIR = fileURLToPath(
  new URL('./fixtures/commands-extension', import.meta.url),
);

const NOT_TYPING = '!inputFocus && !modalOpen';
const MAC = process.platform === 'darwin';
/** Подпись `Mod+Shift+9` / `Mod+Shift+G` на платформе окна. */
const LABEL_SHIFT_9 = MAC ? '⇧⌘9' : 'Ctrl+Shift+9';
const LABEL_SHIFT_G = MAC ? '⇧⌘G' : 'Ctrl+Shift+G';
const LABEL_2 = MAC ? '⌘2' : 'Ctrl+2';

const GREET = `extension:${COMMANDS_ID}:acme.commands.greet`;
const COURSES = 'app:go:courses';
const SETTINGS = 'app:go:settings';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async (extensions: Record<string, string> = {}) => {
  workspace ??= await createWorkspace({ extensions });
  app = await launchApp(workspace.userData);
  const { page } = app;
  await page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return { page, commands: new CommandsClient(page) };
};

const relaunch = async (extensions: Record<string, string> = {}) => {
  await app?.close();
  return launch(extensions);
};

const openShortcuts = async (page: Page) => {
  await page.getByRole('link', { name: 'Настройки', exact: true }).click();
  await page
    .getByRole('tab', { name: 'Сочетания клавиш', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Сочетания клавиш', exact: true })
    .waitFor({ timeout: 30_000 });
};

const row = (page: Page, command: string): Locator =>
  page.locator(`[data-testid="shortcut"][data-command="${command}"]`);

const dialog = (page: Page) => page.getByTestId('shortcut-dialog');

const capture = (page: Page) => page.getByTestId('shortcut-capture');

/** Открывает диалог кнопкой строки и ждёт, пока область записи получит фокус. */
const openDialog = async (page: Page, trigger: Locator) => {
  await trigger.click();
  await capture(page).waitFor({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement?.getAttribute('data-testid') ===
            'shortcut-capture',
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
};

const editFirst = (page: Page, command: string) =>
  openDialog(page, row(page, command).getByTestId('shortcut-edit').first());

const addTo = (page: Page, command: string) =>
  openDialog(page, row(page, command).getByTestId('shortcut-add'));

const rowText = async (page: Page, command: string) =>
  (await row(page, command).innerText()).replace(/\s+/g, ' ').trim();

const save = async (page: Page) => {
  await page.getByTestId('shortcut-save').click();
  await dialog(page).waitFor({ state: 'hidden', timeout: 15_000 });
};

/** Открывает «Перейти: Курсы» для записи нового сочетания `Mod+Shift+<key>`. */
const rebind = async (page: Page, command: string, key: string) => {
  await editFirst(page, command);
  await page.keyboard.press(`${MOD_KEY}+Shift+${key}`);
};

describe('сочетания клавиш: изменение в диалоге (R10, R21)', () => {
  it('новое сочетание записывается в диалоге, действует сразу, старое свободно; строка помечена «Ваше»', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await rebind(page, COURSES, '9');
    // запись показана клавишами и озвучена словами
    await expectText(capture(page), LABEL_SHIFT_9);
    await expectText(
      page.locator('[role="status"]', { hasText: 'Записано' }),
      MAC ? 'Command Shift 9' : 'Control Shift 9',
    );
    // условие по умолчанию — как у текущей привязки команды
    expect(
      await page.getByTestId('shortcut-when').locator('input').inputValue(),
    ).toBe(NOT_TYPING);
    await expectText(dialog(page), 'Пересечений нет.');
    await save(page);

    const text = await rowText(page, COURSES);
    expect(text).toContain(LABEL_SHIFT_9);
    expect(text).not.toContain(LABEL_2);
    expect(text).toContain('Ваше');

    // со страницы настроек новое сочетание ведёт на «Курсы»; старое не работает
    await page.keyboard.press(`${MOD_KEY}+2`);
    expect(commands.route()).toBe('#/settings/shortcuts');
    await page.keyboard.press(`${MOD_KEY}+Shift+9`);
    await expect.poll(() => commands.route()).toBe('#/courses');
  });

  it('Escape при пустой записи закрывает диалог; Backspace очищает запись; Tab выводит фокус из области записи', async () => {
    const { page } = await launch();
    await openShortcuts(page);
    await editFirst(page, COURSES);
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'hidden', timeout: 15_000 });

    await editFirst(page, COURSES);
    await page.keyboard.press(`${MOD_KEY}+Shift+9`);
    await expectText(capture(page), LABEL_SHIFT_9);
    await page.keyboard.press('Backspace');
    await expectText(capture(page), 'Нажмите клавиши');
    await expect(page.getByTestId('shortcut-save').isDisabled()).resolves.toBe(
      true,
    );
    // Ctrl/⌘+K внутри области записи записывается, а не открывает палитру
    await page.keyboard.press(`${MOD_KEY}+K`);
    await expectText(capture(page), MAC ? '⌘K' : 'Ctrl+K');
    await expectCount(page.getByTestId('command-palette'), 0);
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('data-testid'),
      ),
    ).not.toBe('shortcut-capture');
  });

  it('цепочка из двух сочетаний: ожидание второй клавиши показано и озвучено, второе нажатие выполняет команду', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await editFirst(page, SETTINGS);
    await page.keyboard.press(`${MOD_KEY}+G`);
    await page.keyboard.press(`${MOD_KEY}+H`);
    await expectText(capture(page), MAC ? '⌘G' : 'Ctrl+G');
    await expectText(capture(page), MAC ? '⌘H' : 'Ctrl+H');
    await save(page);
    await expectText(row(page, SETTINGS), MAC ? '⌘H' : 'Ctrl+H');

    await page.keyboard.press(`${MOD_KEY}+G`);
    await page.getByTestId('chord-pending').waitFor({ timeout: 15_000 });
    await expectText(
      page.locator('[role="status"]', { hasText: 'Ждём вторую клавишу' }),
      MAC ? 'Command G' : 'Control G',
    );
    await page.keyboard.press(`${MOD_KEY}+H`);
    await expect.poll(() => commands.route()).toBe('#/settings/learning');
    await expectCount(page.getByTestId('chord-pending'), 0);

    // Escape сбрасывает ожидание: второе нажатие уже ничего не делает
    await page.keyboard.press(`${MOD_KEY}+1`);
    await expect.poll(() => commands.route()).toBe('#/');
    await page.keyboard.press(`${MOD_KEY}+G`);
    await page.getByTestId('chord-pending').waitFor({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expectCount(page.getByTestId('chord-pending'), 0);
    await page.keyboard.press(`${MOD_KEY}+H`);
    expect(commands.route()).toBe('#/');
  });
});

describe('сочетания клавиш: пересечения и переназначение (R12, R21)', () => {
  it('диалог показывает пересечение до сохранения; «Переназначить» снимает привязку у другой команды в том же сохранении', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    // «Настройки» хотят Mod+2, которое занято «Курсами»
    await editFirst(page, SETTINGS);
    await page.keyboard.press(`${MOD_KEY}+2`);
    const conflicts = page.getByTestId('shortcut-conflicts');
    await conflicts.waitFor({ timeout: 15_000 });
    await expectText(conflicts, 'Перейти: Курсы');
    await expectText(conflicts, 'Ваше сочетание будет сильнее');
    await page.getByTestId('shortcut-reassign').click();
    await dialog(page).waitFor({ state: 'hidden', timeout: 15_000 });

    expect(await rowText(page, COURSES)).toContain('Нет сочетаний');
    expect(await rowText(page, SETTINGS)).toContain(LABEL_2);
    await expectCount(page.getByTestId('shortcut-conflict'), 0);

    await page.keyboard.press(`${MOD_KEY}+2`);
    await expect.poll(() => commands.route()).toBe('#/settings/learning');
  });

  it('сохранение без переназначения оставляет пересечение: таблица называет другую команду и победителя, «Только с пересечениями» оставляет обе строки', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await editFirst(page, SETTINGS);
    await page.keyboard.press(`${MOD_KEY}+2`);
    await save(page);

    await expectText(
      row(page, SETTINGS).getByTestId('shortcut-conflict'),
      'побеждает эта команда',
    );
    await expectText(
      row(page, COURSES).getByTestId('shortcut-conflict'),
      'побеждает «Перейти: Настройки»',
    );
    await page.getByTestId('shortcuts-filter-conflicts').click();
    await expectCount(page.getByTestId('shortcut'), 2);
    await page.getByTestId('shortcuts-filter-conflicts').click();

    // побеждает пользовательская привязка
    await page.keyboard.press(`${MOD_KEY}+2`);
    await expect.poll(() => commands.route()).toBe('#/settings/learning');
  });

  it('привязка расширения: действует, видна в таблице с источником «Расширение»; пересечение с командой приложения не мешает расширению, побеждает пользователь', async () => {
    const { page, commands } = await launch({ [COMMANDS_ID]: COMMANDS_DIR });
    await openShortcuts(page);
    await row(page, GREET).waitFor({ timeout: 30_000 });
    const text = await rowText(page, GREET);
    expect(text).toContain('Поприветствовать');
    expect(text).toContain(LABEL_SHIFT_G);
    expect(text).toContain('Расширение');
    expect(text).toContain('всегда');

    // из любой страницы без полей ввода: сочетание расширения запускает команду тем же исполнителем, что и палитра
    await page.getByRole('link', { name: 'План на сегодня' }).first().focus();
    await page.keyboard.press(`${MOD_KEY}+Shift+G`);
    await expectText(commands.notice, 'Привет');

    // пользователь занимает то же сочетание командой приложения: побеждает приоритет, расширение остаётся загруженным
    await rebind(page, COURSES, 'G');
    await expectText(dialog(page), 'Поприветствовать');
    await save(page);
    await expectText(
      row(page, GREET).getByTestId('shortcut-conflict'),
      'побеждает «Перейти: Курсы»',
    );
    await expectText(
      row(page, COURSES).getByTestId('shortcut-conflict'),
      'побеждает эта команда',
    );
    await page.keyboard.press(`${MOD_KEY}+Shift+G`);
    await expect.poll(() => commands.route()).toBe('#/courses');
    await commands.openPalette();
    await commands.search('Поприветствовать');
    await expectCount(commands.option('Поприветствовать'), 1);
  });
});

describe('сочетания клавиш: сброс и сохранение (R10, R14, R21)', () => {
  it('«Сбросить» возвращает умолчания команды; «Сбросить всё» просит подтверждения', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await rebind(page, COURSES, '9');
    await save(page);
    await rebind(page, SETTINGS, '8');
    await save(page);
    await expectText(page.getByTestId('shortcuts-filter-changed'), '2');

    // фильтр «Изменённые» оставляет изменённые команды
    await page.getByTestId('shortcuts-filter-changed').click();
    await expectCount(page.getByTestId('shortcut'), 2);
    await page.getByTestId('shortcuts-filter-changed').click();

    await row(page, COURSES).getByTestId('shortcut-reset').click();
    await expectText(row(page, COURSES), LABEL_2);
    await expectCount(row(page, COURSES).getByTestId('shortcut-reset'), 0);
    await page.keyboard.press(`${MOD_KEY}+2`);
    await expect.poll(() => commands.route()).toBe('#/courses');

    // сочетание «Курсов» вернулось и привело на другую страницу: назад в настройки
    await openShortcuts(page);
    // отмена в подтверждении ничего не меняет
    await page.getByTestId('shortcuts-reset-all').click();
    await page.getByTestId('shortcuts-reset-dialog').waitFor();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page
      .getByTestId('shortcuts-reset-dialog')
      .waitFor({ state: 'hidden' });
    expect(await rowText(page, SETTINGS)).toContain('Ваше');

    await page.getByTestId('shortcuts-reset-all').click();
    await page.getByTestId('shortcuts-reset-confirm').click();
    await expectCount(page.getByTestId('shortcut-reset'), 0);
    expect(await rowText(page, SETTINGS)).not.toContain('Ваше');
    await expect(
      page.getByTestId('shortcuts-reset-all').isDisabled(),
    ).resolves.toBe(true);
  });

  it('привязку можно добавить второй и снять; снятая не действует', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await addTo(page, COURSES);
    await page.keyboard.press(`${MOD_KEY}+Shift+9`);
    await save(page);
    await expectCount(row(page, COURSES).getByTestId('shortcut-edit'), 2);

    await page.keyboard.press(`${MOD_KEY}+Shift+9`);
    await expect.poll(() => commands.route()).toBe('#/courses');

    // снимаем обе привязки
    await openShortcuts(page);
    await row(page, COURSES).getByTestId('shortcut-remove').first().click();
    await row(page, COURSES).getByTestId('shortcut-remove').first().click();
    await expectText(row(page, COURSES), 'Нет сочетаний');
    await page.keyboard.press(`${MOD_KEY}+1`);
    await expect.poll(() => commands.route()).toBe('#/');
    await page.keyboard.press(`${MOD_KEY}+2`);
    await page.keyboard.press(`${MOD_KEY}+Shift+9`);
    expect(commands.route()).toBe('#/');
  });

  it('изменения переживают перезапуск и действуют в новом окне; поиск находит команду по клавишам', async () => {
    const first = await launch();
    await openShortcuts(first.page);
    await rebind(first.page, COURSES, '9');
    await save(first.page);

    const second = await relaunch();
    await openShortcuts(second.page);
    expect(await rowText(second.page, COURSES)).toContain(LABEL_SHIFT_9);
    await second.page.keyboard.press(`${MOD_KEY}+Shift+9`);
    await expect.poll(() => second.commands.route()).toBe('#/courses');
    await second.page.keyboard.press(`${MOD_KEY}+,`);
    await expect
      .poll(() => second.commands.route())
      .toBe('#/settings/learning');
    await openShortcuts(second.page);

    await second.page
      .getByTestId('shortcuts-search')
      .locator('input')
      .fill(LABEL_SHIFT_9);
    await expectCount(second.page.getByTestId('shortcut'), 1);
    await second.page
      .getByTestId('shortcuts-search')
      .locator('input')
      .fill('нет такого');
    await expectCount(second.page.getByTestId('shortcut'), 0);
  });

  it('палитра показывает действующую привязку команды, а не умолчание', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await rebind(page, COURSES, '9');
    await save(page);
    await commands.openPalette();
    await expectText(commands.option('Перейти: Курсы'), LABEL_SHIFT_9);
    await commands.combobox.press('Escape');
  });

  it('палитру можно переназначить: новая клавиша открывает её и в поле ввода, Ctrl/⌘+K свободна', async () => {
    const { page, commands } = await launch();
    await openShortcuts(page);
    await rebind(page, 'app:palette.open', 'P');
    await save(page);
    await page.getByTestId('shortcuts-search').locator('input').focus();
    await page.keyboard.press(`${MOD_KEY}+K`);
    await expectCount(page.getByTestId('command-palette'), 0);
    await page.keyboard.press(`${MOD_KEY}+Shift+P`);
    await commands.waitForPalette();
  });
});

describe('сочетания клавиш: доступность (R21)', () => {
  it('у всех кнопок таблицы и диалога есть имя, у таблиц — подпись, у диалога — название; действия доступны с клавиатуры', async () => {
    const { page } = await launch();
    await openShortcuts(page);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('main button, main [role="button"]')]
        .filter((button) => {
          const label =
            button.getAttribute('aria-label') ?? button.textContent ?? '';
          const labelledBy = button.getAttribute('aria-labelledby');
          return label.trim() === '' && labelledBy === null;
        })
        .map((button) => button.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    const ids = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[id]')].map(({ id }) => id);
      return all.filter((id, index) => all.indexOf(id) !== index);
    });
    expect(ids).toEqual([]);
    await expectCount(
      page.getByRole('table', { name: 'Переход', exact: true }),
      1,
    );

    // «Изменить» открывается клавишей Enter с кнопки
    const edit = row(page, COURSES).getByTestId('shortcut-edit').first();
    await edit.focus();
    await page.keyboard.press('Enter');
    await capture(page).waitFor({ timeout: 15_000 });
    await expectCount(
      page.getByRole('dialog', { name: /Изменить сочетание: Перейти: Курсы/ }),
      1,
    );
    const dialogNames = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="shortcut-dialog"] button')]
        .filter((button) => (button.textContent ?? '').trim() === '')
        .map((button) => button.outerHTML.slice(0, 80)),
    );
    expect(dialogNames).toEqual([]);
    expect(
      await page.getByTestId('shortcut-capture').getAttribute('role'),
    ).toBe('group');
    expect(
      await page
        .getByTestId('shortcut-capture')
        .getAttribute('aria-labelledby'),
    ).toBe('shortcut-capture-label');
  });
});
