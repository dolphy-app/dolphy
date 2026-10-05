import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { CommandsClient } from './commands-client.ts';

export const TRANSFERS_ID = 'acme.transfers';

/** Строки интерфейса (`ru`), по которым находятся элементы. */
export const RU = {
  navSettings: 'Настройки',
  tabLibrary: 'Библиотека',
  cardTitle: 'Импорт и экспорт',
  importWords: 'Курс из списка слов',
  importHang: 'Зависший импорт',
  exportCourse: 'Курс в JSON',
  exportProgress: 'Серия в JSON',
  importButton: 'Импортировать…',
  exportButton: 'Экспортировать…',
  submitImport: 'Импортировать',
  cancel: 'Отмена',
  close: 'Закрыть',
  submitExport: 'Экспортировать',
} as const;

const TIMEOUT = 30_000;

/** Курс из списка слов: id, название и вопросы — формат фикстуры `transfers-extension`. */
export const wordsFile = (id: string, name: string, questions: string[]) =>
  [id, name, ...questions, ''].join('\n');

/** Оператор импорта и экспорта: палитра, карточка «Библиотеки», диалоги и подменённые диалоги файла. */
export class TransfersClient {
  readonly page: Page;
  readonly commands: CommandsClient;
  /** Каталог подменённых диалогов файла (`DOLPHY_FAKE_FILE_DIALOGS`). */
  readonly dialogsDir: string;

  constructor(page: Page, dialogsDir: string) {
    this.page = page;
    this.commands = new CommandsClient(page);
    this.dialogsDir = dialogsDir;
  }

  // --- подменённые диалоги файла ---

  /** Следующий диалог выбора файла вернёт `path`. */
  async willPick(path: string) {
    await mkdir(this.dialogsDir, { recursive: true });
    await writeFile(join(this.dialogsDir, 'pick.txt'), path);
  }

  /** Следующие диалоги сохранения будут отменены пользователем. */
  async willCancelSave() {
    await mkdir(this.dialogsDir, { recursive: true });
    await writeFile(join(this.dialogsDir, 'save-cancel'), '');
  }

  /** Записи `dialogs.jsonl`: параметры каждого показанного диалога. */
  async dialogCalls(): Promise<Record<string, unknown>[]> {
    const text = await readFile(
      join(this.dialogsDir, 'dialogs.jsonl'),
      'utf8',
    ).catch(() => '');
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async savedFiles(): Promise<string[]> {
    return readdir(join(this.dialogsDir, 'saved')).catch(() => []);
  }

  async savedText(name: string): Promise<string> {
    return readFile(join(this.dialogsDir, 'saved', name), 'utf8');
  }

  // --- палитра ---

  async runFromPalette(title: string) {
    await this.commands.openPalette();
    await this.commands.search(title);
    await this.commands.option(title).first().click();
  }

  // --- «Настройки» → «Библиотека» ---

  async openLibrary() {
    await this.page
      .getByRole('link', { name: RU.navSettings, exact: true })
      .click();
    await this.page
      .getByRole('tab', { name: RU.tabLibrary, exact: true })
      .click();
    await this.card.waitFor({ timeout: TIMEOUT });
  }

  get card(): Locator {
    return this.page.getByTestId('transfers-card');
  }

  get importerRows(): Locator {
    return this.card.getByTestId('transfer-importer');
  }

  get exporterRows(): Locator {
    return this.card.getByTestId('transfer-exporter');
  }

  /** Кнопка строки карточки по названию записи. */
  rowButton(title: string): Locator {
    return this.card
      .locator('li')
      .filter({ hasText: title })
      .getByRole('button');
  }

  // --- диалоги ---

  get importDialog(): Locator {
    return this.page.getByTestId('import-dialog');
  }

  get exportDialog(): Locator {
    return this.page.getByTestId('export-dialog');
  }

  get workingDialog(): Locator {
    return this.page.getByTestId('transfer-working');
  }

  get notice(): Locator {
    return this.commands.notice;
  }

  async expectNotice(text: string | RegExp, timeout = TIMEOUT) {
    await this.notice.filter({ hasText: text }).first().waitFor({ timeout });
  }

  /** Диалог показан и переход закончился (до этого axe считает контраст по полупрозрачному диалогу). */
  async settled(dialog: Locator) {
    await dialog.waitFor({ timeout: TIMEOUT });
    await expect
      .poll(
        () =>
          dialog.evaluate(
            (node) =>
              node
                .closest('.v-overlay__content')
                ?.className.includes('transition') === false,
          ),
        { timeout: TIMEOUT },
      )
      .toBe(true);
  }

  /** Числа сводки: курсы, уроки, упражнения. */
  async counts(): Promise<number[]> {
    const values = await this.importDialog
      .getByTestId('import-counts')
      .locator('dd')
      .allInnerTexts();
    return values.map((value) => Number(value.trim()));
  }

  // --- диск библиотеки ---

  async importedDirs(userData: string): Promise<string[]> {
    return readdir(join(userData, 'library', 'imported')).catch(() => []);
  }

  /** Служебные каталоги `.staging` пусты или их нет: ожидающий импорт ничего не оставил. */
  async stagingEntries(userData: string): Promise<string[]> {
    const root = join(userData, 'library', '.staging');
    const entries = await readdir(root).catch(() => [] as string[]);
    return entries;
  }

  async exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }
}
