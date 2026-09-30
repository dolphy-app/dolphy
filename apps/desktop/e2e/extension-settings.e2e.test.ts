import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { LmsApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const PERMISSIONS_EXTENSION = fileURLToPath(
  new URL('./fixtures/permissions-extension', import.meta.url),
);
const ID = 'acme.perm';
const THEME = 'Лаванда';

let workspace: Workspace | null = null;
let app: LmsApp | null = null;

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

    for (const bundled of ['lms.sql', 'lms.choice']) {
      const [text] = await client.readExtensions(bundled);
      expect(text).toContain('Встроенное');
      expect(text).toContain('Доверено');
      expect(await client.extensionSwitchCount(bundled)).toBe(0);
    }
    const [sql] = await client.readExtensions('lms.sql');
    expect(sql).toContain('Запуск процессов');
    expect(sql).toContain('Нативные модули');
  });

  it('отключение убирает тему после перезагрузки окна, строка помечена «Отключено»', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: PERMISSIONS_EXTENSION },
    });
    const client = await launch(workspace.userData);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(THEME)).toBe(true);

    await client.openSettingsExtensions();
    await client.setExtensionSwitch(ID, 'enabled', false);
    await client.reloadFromExtensions();

    const [row] = await client.readExtensions(ID);
    expect(row).toContain('Отключено');
    expect(await client.extensionSwitchChecked(ID, 'enabled')).toBe(false);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(THEME)).toBe(false);

    await client.openSettingsExtensions();
    await client.setExtensionSwitch(ID, 'enabled', true);
    await client.reloadFromExtensions();
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(THEME)).toBe(true);
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
