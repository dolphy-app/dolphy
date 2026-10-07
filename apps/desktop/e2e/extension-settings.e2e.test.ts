import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const THEME_EXTENSION = fileURLToPath(
  new URL('./fixtures/theme-extension', import.meta.url),
);
const ID = 'acme.midnight';
const THEME = 'Полночь';

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

describe('Настройки → Расширения: включение и состояние', () => {
  it('строка включена по умолчанию; у расширений из поставки нет переключателей', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: THEME_EXTENSION },
    });
    const client = await launch(workspace.userData);
    await client.openSettingsExtensions();

    expect(await client.extensionSwitchChecked(ID, 'enabled')).toBe(true);
    for (const bundled of ['dolphy.sql', 'dolphy.choice']) {
      const [text] = await client.readExtensions(bundled);
      expect(text).toContain('Встроенное');
      expect(await client.extensionSwitchCount(bundled)).toBe(0);
    }
  });

  it('расширение с minAppVersion выше версии приложения показывает причину по коду на языке окна', async () => {
    workspace = await createWorkspace({
      extensions: { [ID]: THEME_EXTENSION },
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
      extensions: { [ID]: THEME_EXTENSION },
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
    await client.openSettingsAppearance();
    expect(await client.themeTileExists(THEME)).toBe(false);

    await client.openSettingsExtensions();
    await client.setExtensionSwitch(ID, 'enabled', true);
    await client.openSettingsAppearance();
    await expect.poll(() => client.themeTileExists(THEME)).toBe(true);
    await stillSameWindow();
  });
});
