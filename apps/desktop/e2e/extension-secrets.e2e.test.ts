import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { readExtensionData } from './support/journal.ts';
import { PLAIN_LIBRARY, StateClient } from './support/state-client.ts';

const SECRETS_ID = 'acme.secrets';
const SNOOP_ID = 'acme.snoop';
const SECRET_VALUE = 'сек-ret-e2e-7f3a';
const dir = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** `DOLPHY_FAKE_SAFE_STORAGE`: настоящая связка ключей в e2e не используется (на macOS это запрос пароля). */
const launch = async (keyStore: '1' | 'unavailable') => {
  await app?.close();
  app = await launchApp(workspace!.userData, {
    DOLPHY_FAKE_SAFE_STORAGE: keyStore,
  });
  const client = new Client(app.page);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return {
    client,
    commands: new CommandsClient(app.page),
    state: new StateClient(client),
  };
};

type Session = Awaited<ReturnType<typeof launch>>;

/** Команда палитры по названию; возвращает текст уведомления. */
const run = async ({ commands }: Session, title: string): Promise<string> => {
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
  // уведомление закрывается, чтобы следующее не спутать с этим
  await commands.notice
    .last()
    .getByRole('button', { name: 'Закрыть', exact: true })
    .click();
  await expect.poll(() => commands.notice.count(), { timeout: 15_000 }).toBe(0);
  return text.trim();
};

/** Все файлы БД движка (с журналом WAL): секрет не должен лежать открытым ни в одном. */
const databaseBytes = async (): Promise<Buffer> => {
  const dataDir = join(workspace!.userData, 'data');
  const names = (await readdir(dataDir)).filter((name) =>
    name.startsWith('engine.db'),
  );
  return Buffer.concat(
    await Promise.all(names.map((name) => readFile(join(dataDir, name)))),
  );
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const prepare = async () => {
  workspace = await createWorkspace({
    extensions: {
      [SECRETS_ID]: dir('secrets-extension'),
      [SNOOP_ID]: dir('secrets-snoop-extension'),
    },
    libraryFiles: PLAIN_LIBRARY,
  });
};

describe('секреты расширений', () => {
  it('значение переживает перезапуск, в engine.db лежит шифртекст, соседнее расширение его не видит, «Очистить данные» стирает', async () => {
    await prepare();
    let session = await launch('1');
    expect(await run(session, 'Секрет: прочитать')).toBe('value:none');
    expect(await run(session, 'Секрет: сохранить')).toBe('saved');
    expect(await run(session, 'Секрет: прочитать')).toBe(
      `value:${SECRET_VALUE}`,
    );
    expect(await run(session, 'Чужой секрет: прочитать')).toBe('value:none');

    // на диске только шифртекст: ни в таблице, ни в файлах БД открытого значения нет
    const stored = readExtensionData(workspace!.userData, SECRETS_ID).secrets;
    expect(Object.keys(stored)).toEqual(['token']);
    expect(JSON.stringify(stored)).not.toContain(SECRET_VALUE);
    expect(readExtensionData(workspace!.userData, SNOOP_ID).secrets).toEqual(
      {},
    );

    // перезапуск приложения: значение читается заново
    session = await launch('1');
    expect(await run(session, 'Секрет: прочитать')).toBe(
      `value:${SECRET_VALUE}`,
    );
    await app!.close();
    app = null;
    expect((await databaseBytes()).includes(Buffer.from(SECRET_VALUE))).toBe(
      false,
    );

    // «Данные» показывает секрет, «Очистить данные» стирает
    session = await launch('1');
    await session.client.openSettingsExtensions();
    await expect
      .poll(() => session.state.dataLine(SECRETS_ID), { timeout: 15_000 })
      .toMatch(/^1 ключ, /);
    expect(await session.state.dataLine(SNOOP_ID)).toBeNull();
    await session.state.clearData(SECRETS_ID);
    await expect
      .poll(() => session.state.dataLine(SECRETS_ID), { timeout: 15_000 })
      .toBeNull();
    expect(readExtensionData(workspace!.userData, SECRETS_ID).secrets).toEqual(
      {},
    );
    expect(await run(session, 'Секрет: прочитать')).toBe('value:none');
  });

  it('без хранилища ключей: запись и чтение существующего ключа — SecretsUnavailable, чтение отсутствующего и удаление работают', async () => {
    await prepare();
    let session = await launch('1');
    expect(await run(session, 'Секрет: сохранить')).toBe('saved');

    session = await launch('unavailable');
    expect(await run(session, 'Секрет: прочитать')).toBe(
      'error:SecretsUnavailable',
    );
    expect(await run(session, 'Секрет: сохранить')).toBe(
      'error:SecretsUnavailable',
    );
    // чужое расширение: ключа у него нет, поэтому хранилище ключей не нужно
    expect(await run(session, 'Чужой секрет: прочитать')).toBe('value:none');
    expect(await run(session, 'Секрет: удалить')).toBe('deleted:true');
    expect(readExtensionData(workspace!.userData, SECRETS_ID).secrets).toEqual(
      {},
    );
    expect(await run(session, 'Секрет: прочитать')).toBe('value:none');
  });
});
