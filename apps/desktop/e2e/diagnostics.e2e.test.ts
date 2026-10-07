import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { COMMANDS_ID, CommandsClient } from './support/commands-client.ts';
import { DiagnosticsClient } from './support/diagnostics-client.ts';
import { expectCount, expectText } from './support/locator.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const LOGS_DIR = fileURLToPath(
  new URL('./fixtures/logs-extension', import.meta.url),
);
const COMMANDS_DIR = fileURLToPath(
  new URL('./fixtures/commands-extension', import.meta.url),
);
const ID = 'acme.logs';
const SAY = 'записать в журнал';

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
    extensions: { [ID]: LOGS_DIR, [COMMANDS_ID]: COMMANDS_DIR },
    libraryFiles: PLAIN_LIBRARY,
  });
  app = await launchApp(workspace.userData);
  const client = new Client(app.page);
  const commands = new CommandsClient(app.page);
  const diagnostics = new DiagnosticsClient(app.page);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return { client, commands, diagnostics, userData: workspace.userData };
};

const say = async (commands: CommandsClient) => {
  await commands.openPalette();
  await commands.search(SAY);
  await commands.combobox.press('Enter');
};

/** Все записи файлов журнала (JSON-строки) от старых к новым. */
const readLog = async (userData: string) => {
  const dir = join(userData, 'logs');
  const names = (await readdir(dir)).filter((name) => /\.log$/.test(name));
  const lines = (
    await Promise.all(
      names.sort().map((name) => readFile(join(dir, name), 'utf8')),
    )
  )
    .join('')
    .split('\n')
    .filter((line) => line !== '');
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe('журнал и диагностика', () => {
  it('файл журнала: запись «extension host ready» от main и запись движка', async () => {
    const { userData } = await prepare();
    await expect
      .poll(
        async () =>
          (await readLog(userData)).some(
            (entry) =>
              entry.message === 'extension host ready' &&
              entry.source === 'main' &&
              entry.level === 'info' &&
              typeof entry.at === 'number',
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const entries = await readLog(userData);
    expect(
      entries.some(
        (entry) =>
          entry.source === 'main' && entry.message === 'engine host ready',
      ),
    ).toBe(true);
  });

  it('расширение: запись несёт его id; диалог показывает её, фильтры и предустановка из строки расширения', async () => {
    const { client, commands, diagnostics, userData } = await prepare();
    await say(commands);
    await expect
      .poll(
        async () =>
          (await readLog(userData)).some(
            (entry) =>
              entry.extensionId === ID &&
              entry.message === 'acme.logs says hello 1',
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    await client.openSettingsExtensions();
    await diagnostics.openButton.click();
    await diagnostics.dialog.waitFor({ timeout: 15_000 });
    await expect
      .poll(async () => (await diagnostics.entryTexts()).join('\n'), {
        timeout: 15_000,
      })
      .toContain('acme.logs says hello 1');
    // записи приложения тоже видны, самые новые внизу
    const all = await diagnostics.entryTexts();
    expect(all.some((text) => text.includes('extension host ready'))).toBe(
      true,
    );
    expect(all.at(-1)).toContain('acme.logs says hello 1');

    // фильтр по id расширения
    await diagnostics.extensionFilter.locator('input[type=text]').fill(ID);
    await expect
      .poll(async () =>
        (await diagnostics.entryTexts()).every((text) => text.includes(ID)),
      )
      .toBe(true);
    expect(await diagnostics.entries.count()).toBeGreaterThan(0);

    // минимальный уровень: у записи расширения уровень warn, error её скрывает
    await diagnostics.levelFilter.click();
    await app!.page
      .getByRole('option', { name: 'Ошибка', exact: true })
      .click();
    await diagnostics.empty.waitFor({ timeout: 15_000 });
    await expectCount(diagnostics.entries, 0);

    // «Обновить» подтягивает новые записи
    await diagnostics.levelFilter.click();
    await app!.page
      .getByRole('option', { name: 'Отладка', exact: true })
      .click();
    await expectCount(diagnostics.empty, 0);
    // Escape сразу после выбора пункта может прийти, пока закрывается меню списка: повторяем
    await expect
      .poll(
        async () => {
          await app!.page.keyboard.press('Escape');
          return diagnostics.dialog.count();
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    await say(commands);
    await diagnostics.openForExtension(ID).click();
    await diagnostics.dialog.waitFor({ timeout: 15_000 });
    await expect
      .poll(async () => (await diagnostics.entryTexts()).join('\n'), {
        timeout: 15_000,
      })
      .toContain('acme.logs says hello 2');
    // предустановленный фильтр: только записи этого расширения
    expect(
      (await diagnostics.entryTexts()).every((text) => text.includes(ID)),
    ).toBe(true);
    await diagnostics.refresh.click();
    await expectText(diagnostics.entries.last(), 'acme.logs says hello 2');
  });

  it('«Скопировать диагностику» кладёт в буфер версии и список расширений без путей домашнего каталога', async () => {
    const { client, diagnostics } = await prepare();
    await client.openSettingsExtensions();
    await diagnostics.copyDiagnostics.click();
    await expect
      .poll(() => app!.evaluateMain(({ clipboard }) => clipboard.readText()), {
        timeout: 15_000,
      })
      .toContain(ID);
    const text = await app!.evaluateMain(({ clipboard }) =>
      clipboard.readText(),
    );
    expect(text).toMatch(/Electron/);
    expect(text).toMatch(/Contract/i);
    expect(text).toContain(COMMANDS_ID);
    expect(text).not.toContain(workspace!.userData);
    expect(text).not.toMatch(/\/Users\/[^/\s]+/);
  });
});
