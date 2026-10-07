import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CommandsClient } from './support/commands-client.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const EXTENSION = fileURLToPath(
  new URL('./fixtures/unrestricted-extension', import.meta.url),
);
const ID = 'acme.unrestricted';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

/** Команда палитры по названию; возвращает текст уведомления. */
const run = async (commands: CommandsClient, title: string) => {
  await commands.openPalette();
  await commands.search(title);
  await expect
    .poll(() => commands.optionTitles(), { timeout: 15_000 })
    .toContain(title);
  await commands.option(title).first().click();
  await commands.palette.waitFor({ state: 'hidden' });
  await expect
    .poll(() => commands.notice.count(), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const text = (await commands.notice.last().innerText()).split('\n')[0]!;
  await commands.notice
    .last()
    .getByRole('button', { name: 'Закрыть', exact: true })
    .click();
  await expect.poll(() => commands.notice.count(), { timeout: 15_000 }).toBe(0);
  return text.trim();
};

describe('код расширения без ограничений (R1)', () => {
  it('команда читает файл вне каталога расширения, пишет файл рядом и запускает дочерний процесс', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: EXTENSION },
      libraryFiles: PLAIN_LIBRARY,
    });
    const { userData } = workspace;
    await writeFile(join(userData, 'outside.txt'), 'secret-outside\n');
    app = await launchApp(userData);
    await app.page
      .getByRole('link', { name: 'План на сегодня', exact: true })
      .waitFor({ timeout: 30_000 });
    const commands = new CommandsClient(app.page);

    expect(await run(commands, 'Свободно: прочитать файл')).toBe(
      'read:secret-outside',
    );
    expect(await run(commands, 'Свободно: записать файл')).toBe('written');
    expect(await readFile(join(userData, 'written.txt'), 'utf8')).toBe(
      'written-by-extension',
    );
    expect(await run(commands, 'Свободно: запустить процесс')).toBe(
      'child:other',
    );
  });
});
