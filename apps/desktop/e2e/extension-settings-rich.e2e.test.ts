import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { exerciseFront } from './support/courses.ts';
import { readExtensionData } from './support/journal.ts';

const ID = 'acme.rich';
const COURSE = 'Rich (KnowledgeBase)';
const TIMEOUT = 15_000;
const EXTENSION = fileURLToPath(
  new URL('./fixtures/rich-settings-extension', import.meta.url),
);
const LIBRARY: Record<string, string> = {
  'rich_kb/course_manifest.json': JSON.stringify({
    dependencies: [],
    description: COURSE,
    engine: { tags: ['rich'] },
    generator_config: { KnowledgeBase: {} },
    id: 'rich_kb',
    name: COURSE,
  }),
  'rich_kb/basic.lesson/lesson.name.json': JSON.stringify('Rich'),
  'rich_kb/basic.lesson/q1.front.md': exerciseFront(
    ID,
    ['    spec:', '      label: q1'],
    'Rich question',
  ),
};

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

const launch = async (): Promise<Client> => {
  await app?.close();
  app = await launchApp(workspace!.userData);
  return new Client(app.page);
};

const prepare = async (): Promise<Client> => {
  workspace = await createWorkspace({
    extensions: { [ID]: EXTENSION },
    libraryFiles: LIBRARY,
  });
  return launch();
};

const data = () => readExtensionData(workspace!.userData, ID).settings;

interface Report {
  changes: number;
  advanced: boolean;
  note: string;
  tags: string[];
  tint: string;
  secret: string;
}

/** Ответ вида `acme.rich` оставляет попытку открытой и отдаёт значения настроек, какими их видит код. */
const report = async (client: Client): Promise<Report> => {
  const page = client.page;
  await client.openCourses();
  await client.focusCourse(COURSE);
  await client.startSession();
  await client.submitWrong({ text: 'report', element: 'acme-rich-answer' });
  const text = (await page.getByRole('alert').allInnerTexts()).join('\n');
  await page.getByRole('button', { name: 'Выйти из сессии' }).click();
  return JSON.parse(text.slice(text.indexOf('{'))) as Report;
};

const openDialog = async (client: Client): Promise<Locator> => {
  await client.openSettingsExtensions();
  const row = client.page
    .getByRole('list', { name: 'Установленные расширения', exact: true })
    .locator(`[data-extension-id="${ID}"]`);
  await row.getByTestId(`settings-${ID}`).click();
  const dialog = client.page.getByTestId('extension-settings');
  await dialog.getByTestId(`setting-${ID}.tint`).waitFor({ timeout: TIMEOUT });
  return dialog;
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('богатые настройки и названия видов', () => {
  it('чип вида задания показывает название, id остаётся подсказкой', async () => {
    const client = await prepare();
    await client.openSettingsExtensions();
    const chip = client.page
      .getByRole('list', { name: 'Установленные расширения', exact: true })
      .locator(
        `[data-extension-id="${ID}"] [data-point="exerciseTypes"] .v-chip`,
      );
    await chip.waitFor({ timeout: TIMEOUT });
    expect((await chip.innerText()).trim()).toBe('Богатый вид');
    expect(await chip.getAttribute('title')).toBe(ID);
  });

  it('форма: разделы и порядок, переключатель прячет и показывает поле, скрытое значение доходит до кода', async () => {
    const client = await prepare();
    const dialog = await openDialog(client);
    const stillSameWindow = await client.markWindow();

    // первый раздел без заголовка (переключатель), затем разделы по первому вхождению
    expect(
      await dialog
        .getByTestId('settings-section')
        .first()
        .locator('h3')
        .count(),
    ).toBe(0);
    // разделы — в порядке первого вхождения в списке, отсортированном по order
    expect(await dialog.locator('h3').allInnerTexts()).toEqual([
      'Оформление',
      'Содержимое',
    ]);
    // внутри раздела: order 1 (метки), затем order 2 (заметка)
    const content = dialog.getByTestId('settings-section').nth(2);
    expect(
      await content
        .locator('[data-testid^="setting-acme.rich"]')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-testid')),
        ),
    ).toEqual([`setting-${ID}.tags`, `setting-${ID}.note`]);
    expect(await dialog.getByTestId(`setting-${ID}.secret`).count()).toBe(0);

    await dialog
      .getByTestId(`setting-${ID}.advanced`)
      .locator('input')
      .setChecked(true);
    const secret = dialog.getByTestId(`setting-${ID}.secret`).locator('input');
    await secret.waitFor({ timeout: TIMEOUT });
    expect(await dialog.locator('h3').allInnerTexts()).toEqual([
      'Оформление',
      'Дополнительно',
      'Содержимое',
    ]);
    await secret.fill('y');
    await secret.press('Tab');
    await expect.poll(() => data()[`${ID}.secret`]).toBe('y');

    await dialog
      .getByTestId(`setting-${ID}.advanced`)
      .locator('input')
      .setChecked(false);
    await expect
      .poll(() => dialog.getByTestId(`setting-${ID}.secret`).count())
      .toBe(0);
    // скрытое значение сохранено и читается кодом
    expect(data()[`${ID}.secret`]).toBe('y');
    await dialog.getByTestId('settings-close').click();
    await dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
    expect((await report(client)).secret).toBe('y');
    await stillSameWindow();
  });

  it('цвет: hex хранится в нижнем регистре, неверный ввод отклоняется, значение доходит до работающего кода', async () => {
    const client = await prepare();
    const dialog = await openDialog(client);
    const tint = dialog.getByTestId(`setting-${ID}.tint`);
    const hex = tint.locator('input');
    expect(await hex.inputValue()).toBe('#336699');

    await hex.fill('#AABB0C');
    await hex.press('Tab');
    await expect.poll(() => data()[`${ID}.tint`]).toBe('#aabb0c');

    await hex.fill('#12');
    await hex.press('Tab');
    await expect
      .poll(() => tint.locator('.v-messages').innerText())
      .toContain('Нужен цвет вида #rrggbb.');
    expect(data()[`${ID}.tint`]).toBe('#aabb0c');

    // выбор цвета встроенным элементом
    await dialog.getByTestId(`setting-${ID}.tint-picker`).evaluate((node) => {
      const input = node as HTMLInputElement;
      input.value = '#00ff7f';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => data()[`${ID}.tint`]).toBe('#00ff7f');
    await expect.poll(() => hex.inputValue()).toBe('#00ff7f');
    await dialog.getByTestId('settings-close').click();
    expect((await report(client)).tint).toBe('#00ff7f');
  });

  it('список и текст: добавить, переставить с клавиатуры, удалить, лимиты; значения переживают перезапуск', async () => {
    const client = await prepare();
    const dialog = await openDialog(client);
    const list = dialog.getByTestId(`setting-${ID}.tags`);
    const items = list.getByTestId('setting-list-item');
    const field = list.getByTestId('setting-list-new').locator('input');

    await field.fill('beta');
    await field.press('Enter');
    await field.fill('gamma');
    await list.getByTestId('setting-list-add').click();
    await expect
      .poll(() => data()[`${ID}.tags`])
      .toEqual(['alpha', 'beta', 'gamma']);
    // три из трёх: добавлять больше нельзя
    expect(await field.isDisabled()).toBe(true);
    expect(await list.getByTestId('setting-list-add').isDisabled()).toBe(true);

    // Alt+↓ в поле элемента переставляет его вниз, фокус остаётся на нём
    const first = items.nth(0).locator('input');
    await first.focus();
    await first.press('Alt+ArrowDown');
    await expect
      .poll(() => data()[`${ID}.tags`])
      .toEqual(['beta', 'alpha', 'gamma']);
    expect(
      await items
        .nth(1)
        .locator('input')
        .evaluate((n) => n === document.activeElement),
    ).toBe(true);
    // кнопка «Поднять»
    await items.nth(2).getByTestId('setting-list-up').click();
    await expect
      .poll(() => data()[`${ID}.tags`])
      .toEqual(['beta', 'gamma', 'alpha']);
    // удаление
    await items.nth(0).getByTestId('setting-list-remove').click();
    await expect.poll(() => data()[`${ID}.tags`]).toEqual(['gamma', 'alpha']);
    // правка элемента записывается при уходе из поля
    const edited = items.nth(0).locator('input');
    await edited.fill('delta');
    await edited.press('Tab');
    await expect.poll(() => data()[`${ID}.tags`]).toEqual(['delta', 'alpha']);

    // текст: переводы строк сохраняются
    const note = dialog
      .getByTestId(`setting-${ID}.note`)
      .locator('textarea')
      .first();
    await note.fill('раз\nдва\nтри');
    await note.blur();
    await expect.poll(() => data()[`${ID}.note`]).toBe('раз\nдва\nтри');

    await dialog.getByTestId('settings-close').click();
    expect(await report(client)).toMatchObject({
      tags: ['delta', 'alpha'],
      note: 'раз\nдва\nтри',
    });

    // перезапуск: значения на месте, форма показывает их
    const restarted = await launch();
    const again = await openDialog(restarted);
    const rows = again
      .getByTestId(`setting-${ID}.tags`)
      .getByTestId('setting-list-item')
      .locator('input');
    expect(
      await rows.evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLInputElement).value),
      ),
    ).toEqual(['delta', 'alpha']);
    expect(
      await again
        .getByTestId(`setting-${ID}.note`)
        .locator('textarea')
        .first()
        .inputValue(),
    ).toBe('раз\nдва\nтри');
    // «Сбросить» возвращает умолчания
    await again.getByTestId('settings-reset').click();
    await expect.poll(() => Object.keys(data())).toEqual([]);
    await expect.poll(() => rows.count()).toBe(1);
    expect(await rows.first().inputValue()).toBe('alpha');
  });
});
