import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { COMMANDS_ID, CommandsClient } from './support/commands-client.ts';
import { expectCount, expectText } from './support/locator.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const COMMANDS_DIR = fileURLToPath(
  new URL('./fixtures/commands-extension', import.meta.url),
);

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

const prepare = async () => {
  workspace = await createWorkspace({
    extensions: { [COMMANDS_ID]: COMMANDS_DIR },
    libraryFiles: PLAIN_LIBRARY,
  });
  app = await launchApp(workspace.userData);
  const client = new Client(app.page);
  const commands = new CommandsClient(app.page);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return { client, commands, page: app.page };
};

/** Команда палитры по названию. */
const runCommand = async (commands: CommandsClient, search: string) => {
  await commands.openPalette();
  await commands.search(search);
  await commands.combobox.press('Enter');
};

/** Ждёт живой хост расширений и убивает его; `awaitRestart` — ждёт, пока супервизор поднимет новый. */
const killExtensionHost = async (target: DolphyApp, awaitRestart: boolean) => {
  let pid: number | null = null;
  await expect
    .poll(async () => (pid = await target.extensionHostPid()), {
      timeout: 30_000,
    })
    .not.toBeNull();
  process.kill(pid!, 'SIGKILL');
  if (awaitRestart) {
    await expect
      .poll(async () => target.extensionHostPid(), { timeout: 30_000 })
      .not.toBe(pid);
  }
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('здоровье расширений', () => {
  it('падающая команда: счётчик и причина в строке расширения растут без перезагрузки окна', async () => {
    const { client, commands, page } = await prepare();
    await client.openSettingsExtensions();
    const row = page.locator(`[data-extension-id="${COMMANDS_ID}"]`);
    await row.waitFor({ timeout: 15_000 });
    // до сбоев блока здоровья нет
    await expectCount(row.getByTestId('extension-health'), 0);
    const stillSameWindow = await client.markWindow();

    await runCommand(commands, 'сломаться');
    await expectText(
      commands.notice,
      'Не удалось выполнить команду: кубик сломан',
    );
    await expectText(row.getByTestId('health-failures'), '1 сбой');
    await expectText(row.getByTestId('health-last'), 'ошибка в обработчике');
    await expectText(row.getByTestId('health-last'), 'кубик сломан');

    await runCommand(commands, 'сломаться');
    await expectText(row.getByTestId('health-failures'), '2 сбоя');
    await expectCount(row.getByTestId('health-suppressed'), 0);
    await stillSameWindow();
  });

  it('хост расширений: шесть убийств подряд останавливают его, кнопка возвращает расширения', async () => {
    const { client, commands, page } = await prepare();
    await client.openSettingsExtensions();
    await expectCount(page.getByTestId('host-gave-up'), 0);

    // супервизор перезапускает хост с паузой; убиваем каждый новый, пока он не сдастся
    for (let kill = 0; kill < 6; kill += 1) {
      await killExtensionHost(app!, kill < 5);
    }

    const banner = page.getByTestId('host-gave-up');
    await banner.waitFor({ timeout: 30_000 });
    await expectText(
      banner,
      'Хост расширений остановлен после повторных сбоев',
    );
    expect(await app!.extensionHostPid()).toBeNull();

    await banner.getByTestId('host-restart').click();
    await expectCount(page.getByTestId('host-gave-up'), 0);
    await expect
      .poll(() => app!.extensionHostPid(), { timeout: 30_000 })
      .not.toBeNull();

    await runCommand(commands, 'поприветствовать');
    await expectText(commands.notice, 'Привет');
  });
});
