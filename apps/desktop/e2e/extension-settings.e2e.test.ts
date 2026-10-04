import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const PERMISSIONS_EXTENSION = fileURLToPath(
  new URL('./fixtures/permissions-extension', import.meta.url),
);
const ID = 'acme.perm';
const THEME = 'Лаванда';

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

const launch = async (userData: string) => {
  app = await launchApp(userData);
  return new Client(app.page);
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('Настройки → Расширения: разрешения, включение и доверие', () => {
  it('строка показывает разрешения и «Изолировано»; у расширений из поставки нет переключателей', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: PERMISSIONS_EXTENSION },
    });
    const client = await launch(workspace.userData);
    await client.openSettingsExtensions();

    const [row] = await client.readExtensions(ID);
    expect(row).toContain('Чтение библиотеки курсов');
    expect(row).toContain('Сеть');
    expect(row).toContain('не ограничивается');
    expect(row).toContain('Изолировано');
    expect(await client.extensionSwitchChecked(ID, 'enabled')).toBe(true);
    expect(await client.extensionSwitchChecked(ID, 'trusted')).toBe(false);

    for (const bundled of ['dolphy.sql', 'dolphy.choice']) {
      const [text] = await client.readExtensions(bundled);
      expect(text).toContain('Встроенное');
      expect(text).toContain('Доверено');
      expect(await client.extensionSwitchCount(bundled)).toBe(0);
    }
    const [sql] = await client.readExtensions('dolphy.sql');
    expect(sql).toContain('Запуск процессов');
    expect(sql).toContain('Нативные модули');
  });

  it('расширение с minAppVersion выше версии приложения показывает причину по коду на языке окна', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: PERMISSIONS_EXTENSION },
    });
    const manifest = join(
      workspace.userData,
      'extensions',
      ID,
      'extension.json',
    );
    const raw = JSON.parse(await readFile(manifest, 'utf8')) as object;
    await writeFile(
      manifest,
      JSON.stringify({ ...raw, minAppVersion: '99.0.0' }),
    );
    app = await launchApp(workspace.userData, {
      DOLPHY_APP_VERSION: '1.0.0',
    });
    const client = new Client(app.page);
    await client.openSettingsExtensions();

    const [row] = await client.readExtensions(ID);
    expect(row).toContain('Не загрузилось');
    expect(row).toContain('Требуется приложение версии 99.0.0 или новее');
    expect(row).not.toContain('requires app');
  });

  it('отключение и включение меняют темы сразу, без перезагрузки окна; строка помечена «Отключено»', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: PERMISSIONS_EXTENSION },
    });
    const client = await launch(workspace.userData);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(THEME)).toBe(true);

    await client.openSettingsExtensions();
    const stillSameWindow = await client.markWindow();
    await client.setExtensionSwitch(ID, 'enabled', false);
    await expect
      .poll(async () => (await client.readExtensions(ID))[0])
      .toContain('Отключено');
    expect(await client.extensionSwitchChecked(ID, 'enabled')).toBe(false);
    expect(await client.reloadBanner().count()).toBe(0);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(THEME)).toBe(false);

    await client.openSettingsExtensions();
    await client.setExtensionSwitch(ID, 'enabled', true);
    await client.openSettingsAppearance();
    await expect.poll(() => client.themeTileExists(THEME)).toBe(true);
    await stillSameWindow();
  });

  it('доверие переживает перезапуск приложения и меняет «Изолировано» на «Доверено»', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: PERMISSIONS_EXTENSION },
    });
    const { userData } = workspace;
    let client = await launch(userData);
    await client.openSettingsExtensions();
    await client.setExtensionSwitch(ID, 'trusted', true);
    await expect
      .poll(async () => (await client.readExtensions(ID))[0])
      .toContain('Доверено');

    await app?.close();
    client = await launch(userData);
    await client.openSettingsExtensions();
    const [row] = await client.readExtensions(ID);
    expect(row).toContain('Доверено');
    expect(row).not.toContain('Изолировано');
    expect(await client.extensionSwitchChecked(ID, 'trusted')).toBe(true);
  });
});
