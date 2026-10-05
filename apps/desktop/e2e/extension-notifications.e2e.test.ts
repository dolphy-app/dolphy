import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { readExtensionData } from './support/journal.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const dir = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const NOTIFY_ID = 'acme.notify';
const DENIED_ID = 'acme.nonotify';
const SHOW = 'Уведомление: показать';
const MANY = 'Уведомление: много';
const LONG = 'Уведомление: слишком длинное';
const DENIED_SHOW = 'Уведомление без разрешения: показать';
const PERMISSION_LABEL = 'Системные уведомления';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** Файл, в который main пишет уведомления вместо вызова ОС (`DOLPHY_NOTIFICATION_LOG`). */
const logPath = () => join(workspace!.userData, 'notifications.jsonl');

interface Logged {
  source: string;
  title: string;
  body: string;
}

const notifications = (): Logged[] =>
  existsSync(logPath())
    ? readFileSync(logPath(), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Logged)
    : [];

const launch = async () => {
  await app?.close();
  app = await launchApp(workspace!.userData, {
    DOLPHY_NOTIFICATION_LOG: logPath(),
  });
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return {
    client: new Client(app.page),
    commands: new CommandsClient(app.page),
  };
};

type Session = Awaited<ReturnType<typeof launch>>;

const runCommand = async ({ commands }: Session, title: string) => {
  await commands.openPalette();
  await commands.search(title);
  await expect
    .poll(() => commands.optionTitles(), { timeout: 15_000 })
    .toContain(title);
  await commands.option(title).first().click();
  await commands.palette.waitFor({ state: 'hidden' });
};

const stored = (id: string, key: string) =>
  readExtensionData(workspace!.userData, id).storage[key];

const prepare = async () => {
  workspace = await createWorkspace({
    extensions: {
      [NOTIFY_ID]: dir('notify-extension'),
      [DENIED_ID]: dir('notify-denied-extension'),
    },
    libraryFiles: PLAIN_LIBRARY,
  });
  return launch();
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('notifications', () => {
  it('show доходит до main с именем расширения и очищенным текстом; сверх 3 в минуту — NotificationRateLimitError, длинное название и вызов без разрешения отклоняются', async () => {
    const session = await prepare();

    await runCommand(session, SHOW);
    await expect.poll(() => stored(NOTIFY_ID, 'runs')).toEqual([true]);
    expect(notifications()).toEqual([
      {
        source: NOTIFY_ID, // без названия в манифесте расширение называется своим id
        title: 'Серия продолжается',
        body: 'Ещё один день подряд',
      },
    ]);

    // одно уведомление уже показано: ещё два проходят, остальные три — предел минуты
    await runCommand(session, MANY);
    await expect
      .poll(() => stored(NOTIFY_ID, 'many'), { timeout: 15_000 })
      .toBeDefined();
    const limited = {
      error: {
        name: 'NotificationRateLimitError',
        code: 'EXT_NOTIFICATION_RATE_LIMIT',
        window: 'minute',
        limit: 3,
      },
    };
    expect(stored(NOTIFY_ID, 'many')).toEqual([
      { value: true },
      { value: true },
      limited,
      limited,
      limited,
    ]);
    expect(notifications().map(({ title }) => title)).toEqual([
      'Серия продолжается',
      'Напоминание 1',
      'Напоминание 2',
    ]);

    await runCommand(session, LONG);
    await expect
      .poll(() => stored(NOTIFY_ID, 'long'), { timeout: 15_000 })
      .toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });

    await runCommand(session, DENIED_SHOW);
    await expect
      .poll(() => stored(DENIED_ID, 'report'), { timeout: 15_000 })
      .toEqual({
        error: {
          name: 'PermissionError',
          code: 'EXT_PERMISSION',
          permission: 'notifications',
        },
      });
    expect(notifications()).toHaveLength(3);
  });

  it('переключатель «Уведомления» в строке: выключенное расширение получает false без уведомления, значение переживает перезапуск', async () => {
    let session = await prepare();
    const { client } = session;

    await client.openSettingsExtensions();
    const [row] = await client.readExtensions(NOTIFY_ID);
    expect(row).toContain(PERMISSION_LABEL);
    // у расширения без разрешения переключателя «Уведомления» нет
    expect(
      await app!.page.getByTestId(`notifications-${DENIED_ID}`).count(),
    ).toBe(0);
    expect(await client.extensionSwitchChecked(NOTIFY_ID, 'notifications')).toBe(
      true,
    );

    await client.setExtensionSwitch(NOTIFY_ID, 'notifications', false);
    await runCommand(session, SHOW);
    await expect.poll(() => stored(NOTIFY_ID, 'runs')).toEqual([false]);
    expect(notifications()).toEqual([]);

    session = await launch();
    await session.client.openSettingsExtensions();
    expect(
      await session.client.extensionSwitchChecked(NOTIFY_ID, 'notifications'),
    ).toBe(false);
    await runCommand(session, SHOW);
    await expect.poll(() => stored(NOTIFY_ID, 'runs')).toEqual([false, false]);
    expect(notifications()).toEqual([]);

    await session.client.setExtensionSwitch(NOTIFY_ID, 'notifications', true);
    await runCommand(session, SHOW);
    await expect
      .poll(() => stored(NOTIFY_ID, 'runs'))
      .toEqual([false, false, true]);
    expect(notifications()).toHaveLength(1);
  });
});
