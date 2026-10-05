import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { runAxe } from './support/axe.ts';
import { Client } from './support/client.ts';
import { course } from './support/courses.ts';
import {
  expectCount,
  expectDisabled,
  expectVisible,
} from './support/locator.ts';
import {
  RU,
  TRANSFERS_ID,
  TransfersClient,
  wordsFile,
} from './support/transfers-client.ts';

const TRANSFERS_EXTENSION = fileURLToPath(
  new URL('./fixtures/transfers-extension', import.meta.url),
);
const EXISTING = 'Existing (KnowledgeBase)';
const LIBRARY = course('existing_kb', EXISTING, 'Existing question\n');

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let scratch = '';

interface Session {
  client: Client;
  transfers: TransfersClient;
  userData: string;
  /** Файл пользователя во временном каталоге: путь для подменённого диалога. */
  file(name: string, content: string): Promise<string>;
}

const prepare = async (): Promise<Session> => {
  workspace = await createWorkspace({
    extensions: { [TRANSFERS_ID]: TRANSFERS_EXTENSION },
    libraryFiles: LIBRARY,
  });
  scratch = await mkdtemp(join(tmpdir(), 'dolphy-transfers-'));
  const dialogs = join(scratch, 'dialogs');
  app = await launchApp(workspace.userData, {
    DOLPHY_FAKE_FILE_DIALOGS: dialogs,
  });
  await app.page
    .getByRole('link', { name: /^(План на сегодня|Today's plan)$/ })
    .waitFor({ timeout: 30_000 });
  return {
    client: new Client(app.page),
    transfers: new TransfersClient(app.page, dialogs),
    userData: workspace.userData,
    file: async (name, content) => {
      const path = join(scratch, name);
      await writeFile(path, content);
      return path;
    },
  };
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('импорт и экспорт расширений', () => {
  it('палитра и «Библиотека» показывают записи расширения; отключение убирает их без перезагрузки', async () => {
    const { client, transfers } = await prepare();
    await transfers.openLibrary();
    await expectCount(transfers.importerRows, 2);
    await expectCount(transfers.exporterRows, 2);
    const row = transfers.importerRows.filter({ hasText: RU.importWords });
    expect(await row.innerText()).toContain(TRANSFERS_ID);
    expect(await row.innerText()).toContain('.words, .txt');

    await transfers.commands.openPalette();
    await transfers.commands.search('Импорт');
    // поиск нечёткий: в выдачу попадают и «Экспорт: …», поэтому важны только «Импорт: …»
    expect(
      (await transfers.commands.extensionTitles())
        .filter((title) => title.startsWith('Импорт:'))
        .sort(),
    ).toEqual([`Импорт: ${RU.importHang}`, `Импорт: ${RU.importWords}`]);
    await app!.page.keyboard.press('Escape');

    await client.openSettingsExtensions();
    const sameWindow = await client.markWindow();
    await client.setExtensionSwitch(TRANSFERS_ID, 'enabled', false);
    await transfers.openLibrary();
    await expectCount(transfers.importerRows, 0);
    await expectCount(transfers.exporterRows, 0);
    await transfers.commands.openPalette();
    await transfers.commands.search('Импорт');
    expect(await transfers.commands.extensionTitles()).toEqual([]);
    await sameWindow();
  });

  it('импорт: сводка, запись, курс в «Курсах»; повтор заменяет прежний каталог', async () => {
    const session = await prepare();
    const { client, transfers, userData } = session;
    const path = await session.file(
      'words.words',
      wordsFile('words_kb', 'Words sheet', ['one', 'two', 'three']),
    );
    await transfers.openLibrary();
    await transfers.willPick(path);
    await transfers.rowButton(RU.importWords).click();
    await transfers.importDialog.waitFor({ timeout: 30_000 });
    expect(await transfers.counts()).toEqual([1, 1, 3]);
    expect(await transfers.importDialog.innerText()).toContain('words.words');
    await expectCount(transfers.importDialog.getByTestId('import-replaces'), 0);
    const calls = await transfers.dialogCalls();
    expect(calls[0]).toMatchObject({
      kind: 'open',
      properties: ['openFile'],
      filters: [{ extensions: ['words', 'txt'] }],
    });

    await transfers.importDialog
      .getByRole('button', { name: RU.submitImport, exact: true })
      .click();
    await transfers.expectNotice('Импортировано курсов: 1');
    await transfers.importDialog.waitFor({
      state: 'detached',
      timeout: 15_000,
    });
    const dirs = await transfers.importedDirs(userData);
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toMatch(/^acme\.transfers-words/);
    await client.openCourses();
    expect(await client.courseNames()).toContain('Words sheet');
    expect(await transfers.stagingEntries(userData)).toEqual([]);
  });

  it('повторный импорт того же файла заменяет каталог после подтверждения', async () => {
    const session = await prepare();
    const { client, transfers, userData } = session;
    const path = await session.file(
      'words.words',
      wordsFile('words_kb', 'Words sheet', ['one', 'two']),
    );
    await transfers.willPick(path);
    await transfers.runFromPalette(`Импорт: ${RU.importWords}`);
    await transfers.importDialog.waitFor({ timeout: 30_000 });
    await transfers.importDialog
      .getByRole('button', { name: RU.submitImport, exact: true })
      .click();
    await transfers.expectNotice('Импортировано курсов: 1');

    await session.file(
      'words.words',
      wordsFile('words_kb', 'Words sheet v2', ['one', 'two', 'three', 'four']),
    );
    await transfers.willPick(path);
    await transfers.runFromPalette(`Импорт: ${RU.importWords}`);
    await transfers.importDialog.waitFor({ timeout: 30_000 });
    await expectVisible(transfers.importDialog.getByTestId('import-replaces'));
    expect(await transfers.counts()).toEqual([1, 1, 4]);
    await transfers.importDialog
      .getByRole('button', { name: RU.submitImport, exact: true })
      .click();
    await transfers.importDialog.waitFor({
      state: 'detached',
      timeout: 15_000,
    });
    expect(await transfers.importedDirs(userData)).toHaveLength(1);
    await client.openCourses();
    const names = await client.courseNames();
    expect(names).toContain('Words sheet v2');
    expect(names).not.toContain('Words sheet');
  });

  it('курс с ошибкой: «Импортировать» недоступна, «Закрыть» ничего не оставляет', async () => {
    const session = await prepare();
    const { transfers, userData } = session;
    const path = await session.file(
      'bad.words',
      wordsFile('broken', 'Broken', ['one']),
    );
    await transfers.willPick(path);
    await transfers.runFromPalette(`Импорт: ${RU.importWords}`);
    await transfers.importDialog.waitFor({ timeout: 30_000 });
    await expectDisabled(
      transfers.importDialog.getByRole('button', {
        name: RU.submitImport,
        exact: true,
      }),
      true,
    );
    expect(
      await transfers.importDialog
        .getByTestId('import-diagnostics')
        .innerText(),
    ).not.toBe('');
    expect(await transfers.stagingEntries(userData)).toEqual([]);
    await transfers.importDialog
      .getByRole('button', { name: RU.close, exact: true })
      .click();
    await transfers.importDialog.waitFor({
      state: 'detached',
      timeout: 15_000,
    });
    expect(await transfers.importedDirs(userData)).toEqual([]);
    expect(await transfers.stagingEntries(userData)).toEqual([]);
  });

  it('библиотека отвергла курс (повтор id): откат, прежняя библиотека цела', async () => {
    const session = await prepare();
    const { client, transfers, userData } = session;
    const path = await session.file(
      'dup.words',
      wordsFile('existing_kb', 'Duplicate', ['one']),
    );
    await transfers.willPick(path);
    await transfers.runFromPalette(`Импорт: ${RU.importWords}`);
    await transfers.importDialog.waitFor({ timeout: 30_000 });
    await transfers.importDialog
      .getByRole('button', { name: RU.submitImport, exact: true })
      .click();
    await expectVisible(
      transfers.importDialog.getByTestId('import-failure'),
      30_000,
    );
    await expectDisabled(
      transfers.importDialog.getByRole('button', {
        name: RU.submitImport,
        exact: true,
      }),
      true,
    );
    await transfers.importDialog
      .getByRole('button', { name: RU.cancel, exact: true })
      .or(
        transfers.importDialog.getByRole('button', {
          name: RU.close,
          exact: true,
        }),
      )
      .first()
      .click();
    await transfers.importDialog.waitFor({
      state: 'detached',
      timeout: 15_000,
    });
    expect(await transfers.importedDirs(userData)).toEqual([]);
    await client.openCourses();
    expect(await client.courseNames()).toEqual(
      expect.arrayContaining([EXISTING]),
    );
    expect(await client.courseNames()).not.toContain('Duplicate');
  });

  it('отмена диалога файла ничего не делает; чужой вид файла и не-UTF-8 отвергаются без вызова расширения', async () => {
    const session = await prepare();
    const { transfers, userData } = session;
    await transfers.openLibrary();
    // отмена: pick.txt нет
    await transfers.rowButton(RU.importWords).click();
    await expect
      .poll(async () => (await transfers.dialogCalls()).length)
      .toBe(1);
    await expectCount(transfers.importDialog, 0);
    await expectCount(transfers.notice, 0);

    // «все файлы» в диалоге ОС: вид не из accept
    await transfers.willPick(await session.file('x.csv', 'a'));
    await transfers.rowButton(RU.importWords).click();
    await transfers.expectNotice('не подходит');
    await expectCount(transfers.importDialog, 0);

    // .words, но не UTF-8
    const binary = join(scratch, 'bin.words');
    await writeFile(binary, Buffer.from([0xff, 0xfe, 0x41]));
    await transfers.willPick(binary);
    await transfers.rowButton(RU.importWords).click();
    await transfers.expectNotice('не в кодировке UTF-8');
    await expectCount(transfers.importDialog, 0);
    expect(await transfers.importedDirs(userData)).toEqual([]);
  });

  it('зависший обработчик: окно ожидания, затем сообщение; ничего не записано', async () => {
    const session = await prepare();
    const { transfers, userData } = session;
    await transfers.willPick(await session.file('slow.hang', 'x'));
    await transfers.runFromPalette(`Импорт: ${RU.importHang}`);
    await transfers.workingDialog.waitFor({ timeout: 15_000 });
    await transfers.expectNotice('не ответило за 30 секунд', 60_000);
    await transfers.workingDialog.waitFor({
      state: 'detached',
      timeout: 15_000,
    });
    expect(await transfers.importedDirs(userData)).toEqual([]);
    expect(await transfers.stagingEntries(userData)).toEqual([]);
  }, 120_000);

  it('экспорт курса: выбор курса (по умолчанию курс в фокусе), файл появляется там, куда указал диалог', async () => {
    const session = await prepare();
    const { client, transfers } = session;
    await client.openCourses();
    await client.focusCourse(EXISTING);
    await transfers.openLibrary();
    await transfers.rowButton(RU.exportCourse).click();
    await transfers.exportDialog.waitFor({ timeout: 15_000 });
    await expect
      .poll(() =>
        transfers.exportDialog
          .getByRole('radio', { name: EXISTING })
          .isChecked(),
      )
      .toBe(true);
    await transfers.exportDialog
      .getByRole('button', { name: RU.submitExport, exact: true })
      .click();
    await transfers.expectNotice('existing_kb.json');
    expect(await transfers.savedFiles()).toEqual(['existing_kb.json']);
    const saved = JSON.parse(await transfers.savedText('existing_kb.json')) as {
      title: string;
      files: string[];
    };
    expect(saved.title).toBe(EXISTING);
    expect(saved.files).toContain('course_manifest.json');
    const calls = await transfers.dialogCalls();
    expect(calls.at(-1)).toMatchObject({
      kind: 'save',
      defaultPath: 'existing_kb.json',
    });
  });

  it('экспорт прогресса идёт сразу; отказ от сохранения ничего не пишет', async () => {
    const session = await prepare();
    const { transfers } = session;
    await transfers.willCancelSave();
    await transfers.runFromPalette(`Экспорт: ${RU.exportProgress}`);
    await expect
      .poll(async () => (await transfers.dialogCalls()).length, {
        timeout: 30_000,
      })
      .toBe(1);
    await expectCount(transfers.exportDialog, 0);
    await expectCount(transfers.notice, 0);
    expect(await transfers.savedFiles()).toEqual([]);
  });

  it('axe: сводка импорта и выбор курса, обе темы', async () => {
    const session = await prepare();
    const { client, transfers } = session;
    const path = await session.file(
      'bad.words',
      wordsFile('broken', 'Broken', ['one']),
    );
    for (const theme of ['Светлая', 'Тёмная']) {
      await client.openSettingsAppearance();
      await client.selectTheme(theme);
      await transfers.openLibrary();
      expect(
        await runAxe(app!.page, { impacts: ['serious', 'critical'] }),
      ).toEqual([]);
      await transfers.willPick(path);
      await transfers.rowButton(RU.importWords).click();
      await transfers.settled(transfers.importDialog);
      expect(
        await runAxe(app!.page, {
          include: '.v-dialog',
          impacts: ['serious', 'critical'],
        }),
      ).toEqual([]);
      await transfers.importDialog
        .getByRole('button', { name: RU.close, exact: true })
        .click();
      await transfers.importDialog.waitFor({
        state: 'detached',
        timeout: 15_000,
      });
      await transfers.rowButton(RU.exportCourse).click();
      await transfers.settled(transfers.exportDialog);
      expect(
        await runAxe(app!.page, {
          include: '.v-dialog',
          impacts: ['serious', 'critical'],
        }),
      ).toEqual([]);
      await transfers.exportDialog
        .getByRole('button', { name: RU.cancel, exact: true })
        .click();
      await transfers.exportDialog.waitFor({
        state: 'detached',
        timeout: 15_000,
      });
    }
  });
});
