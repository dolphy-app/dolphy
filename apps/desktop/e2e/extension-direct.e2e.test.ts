import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { course } from './support/courses.ts';
import { readJournal } from './support/journal.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const EXTENSION_ID = 'acme.direct';
const COURSE = 'Direct (KnowledgeBase)';
const EXERCISE = 'direct_kb::basic::q1';
const LIBRARY: Record<string, string> = course(
  'direct_kb',
  COURSE,
  'Direct question\n',
);

let built: BuiltExtension | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

beforeAll(async () => {
  built = await buildFixtureExtension(
    fileURLToPath(new URL('./fixtures/direct-extension', import.meta.url)),
  );
}, 180_000);

afterAll(async () => {
  await built?.dispose();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async () => {
  workspace = await createWorkspace({
    extensions: { [EXTENSION_ID]: built!.dir },
    libraryFiles: LIBRARY,
  });
  app = await launchApp(workspace.userData);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return {
    page: app.page,
    client: new Client(app.page),
    commands: new CommandsClient(app.page),
  };
};

const openPanel = async (commands: CommandsClient) => {
  await commands.navItem('Прямой доступ').click();
  await expectVisible(commands.page.getByTestId('direct-panel'));
};

const press = (page: Page, name: string) =>
  page
    .getByTestId('direct-panel')
    .getByRole('button', { name, exact: true })
    .click();

const result = (page: Page): Locator =>
  page.getByTestId('direct-panel').locator('[data-role="result"]');

/** Нажимает кнопку панели и ждёт, пока в результате появится `text`. */
const pressAndExpect = async (page: Page, name: string, text: string) => {
  await press(page, name);
  await expectText(result(page), text);
};

describe('RPC между частями расширения (R8)', () => {
  it('вызов туда-обратно, ошибка сервера доходит с сообщением, невалидный вход отклоняется до вызова', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();
    await openPanel(commands);

    await pressAndExpect(page, 'Поздороваться', 'ok {"text":"Привет, Ада!"}');

    // клиент проверяет вход схемой контракта: до сервера пустое имя не доходит
    await pressAndExpect(page, 'Пустое имя', 'Ошибка:');
    await pressAndExpect(page, 'Сколько приветствий', 'ok {"greeted":1}');

    // сервер проверяет вход сам, когда клиентскую проверку обошли
    await pressAndExpect(page, 'Пустое имя мимо клиента', 'Ошибка:');
    await pressAndExpect(page, 'Сколько приветствий', 'ok {"greeted":1}');

    await pressAndExpect(page, 'Сломать', 'Ошибка: кубик сломан');
    await stillSameWindow();
  });
});

describe('прямой доступ к движку (R7)', () => {
  it('чтение: компонент и сервер видят курсы библиотеки', async () => {
    const { page, commands } = await launch();
    await openPanel(commands);
    await pressAndExpect(page, 'Прочитать курсы', `"${COURSE}"`);
    await pressAndExpect(page, 'Прочитать курсы на сервере', `"${COURSE}"`);
  });

  it('запись: попытки с сервера и из компонента попадают в журнал', async () => {
    const { page, commands } = await launch();
    await openPanel(commands);
    expect(readJournal(workspace!.userData)).toHaveLength(0);

    await pressAndExpect(page, 'Записать на сервере', 'ok {"eventId"');
    await press(page, 'Записать из компонента');

    const grades = () =>
      readJournal(workspace!.userData).map((row) => [
        row.kind,
        row.unit_id,
        row.grade,
      ]);
    await expect.poll(grades, { timeout: 30_000 }).toEqual([
      ['attempt', EXERCISE, 4],
      ['attempt', EXERCISE, 5],
    ]);
  });
});

describe('API окна (R7, R9)', () => {
  it('openLesson открывает сессию курса, notify показывает уведомление', async () => {
    const { page, commands } = await launch();
    await openPanel(commands);

    await press(page, 'Уведомить');
    await expectText(commands.notice, 'Привет из расширения');

    await press(page, 'Перейти к уроку');
    await expect
      .poll(() => commands.route(), { timeout: 30_000 })
      .toContain('/session?course=direct_kb');
  });

  it('mountAt рисует компонент расширения в боковом меню, внутри него работают useApp и useRpc', async () => {
    const { page, commands } = await launch();
    await openPanel(commands);
    const nav = page.getByTestId('extension-nav');
    await expectCount(nav.getByTestId('direct-mounted'), 0);

    await press(page, 'Смонтировать в меню');
    const mounted = nav.getByTestId('direct-mounted');
    await expectVisible(mounted);
    await expectText(mounted.locator('[data-role="label"]'), 'Смонтировано');
    await expectText(mounted.locator('[data-role="locale"]'), 'Язык: ru');
    await expectText(mounted.locator('[data-role="reply"]'), 'Привет, меню!');
    await expectCount(
      page.locator(
        `[data-testid="extension-injection"][data-ext-injection="${EXTENSION_ID}/mountAt"]`,
      ),
      1,
    );
  });
});

describe('перезапуск хоста расширений', () => {
  it('клиентская часть работает после «Перезапустить хост»: панель жива, RPC отвечает новому хосту', async () => {
    const { page, client, commands } = await launch();
    await client.openSettingsExtensions();

    // супервизор перезапускает хост с паузой; убиваем каждый новый, пока он не сдастся
    const host = app!;
    for (let kill = 0; kill < 6; kill += 1) {
      let pid: number | null = null;
      await expect
        .poll(async () => (pid = await host.extensionHostPid()), {
          timeout: 30_000,
        })
        .not.toBeNull();
      process.kill(pid!, 'SIGKILL');
      if (kill < 5) {
        await expect
          .poll(() => host.extensionHostPid(), { timeout: 30_000 })
          .not.toBe(pid);
      }
    }
    const banner = page.getByTestId('host-gave-up');
    await banner.waitFor({ timeout: 30_000 });
    await banner.getByTestId('host-restart').click();
    await expectCount(page.getByTestId('host-gave-up'), 0);

    await openPanel(commands);
    await pressAndExpect(page, 'Поздороваться', 'ok {"text":"Привет, Ада!"}');
    // сервер новый: счётчик начался заново
    await pressAndExpect(page, 'Сколько приветствий', 'ok {"greeted":1}');
    await pressAndExpect(page, 'Прочитать курсы', `"${COURSE}"`);
  });
});
