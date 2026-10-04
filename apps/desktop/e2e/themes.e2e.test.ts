import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const THEME_EXTENSION = fileURLToPath(
  new URL('./fixtures/theme-extension', import.meta.url),
);
const MIDNIGHT = 'rgb(16, 24, 32)';
const BUILTIN_BACKGROUNDS = ['rgb(245, 246, 251)', 'rgb(14, 16, 32)'];

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

const launch = async (userData: string) => {
  app = await launchApp(userData);
  return new Client(app.page);
};

const relaunch = async (userData: string) => {
  await app?.close();
  return launch(userData);
};

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('темы расширений', () => {
  it('выбор темы применяется сразу, переживает перезапуск; без расширения — «Как в системе»', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.midnight': THEME_EXTENSION },
    });
    const { userData } = workspace;

    let client = await launch(userData);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists('Полночь')).toBe(true);
    const tile = await client.themeTileIdentifier('Полночь');
    expect(tile.title).toBe('acme.midnight');
    expect(tile.described).toBe('acme.midnight');
    expect(tile.visibleText).not.toContain('acme.midnight');
    expect((await client.themeTileIdentifier('Тёмная')).title).toBeNull();
    await client.selectTheme('Полночь');
    await expect.poll(() => client.appBackground()).toBe(MIDNIGHT);

    client = await relaunch(userData);
    await expect.poll(() => client.appBackground()).toBe(MIDNIGHT);
    await client.openSettingsAppearance();
    expect(await client.isThemeSelected('Полночь')).toBe(true);

    await client.openSettingsExtensions();
    const [row] = await client.readExtensions('acme.midnight');
    expect(row).toContain('Загружено');
    expect(row).toContain('Темы');

    await app?.close();
    app = null;
    await rm(join(userData, 'extensions', 'acme.midnight'), {
      recursive: true,
    });
    client = await launch(userData);
    await expect
      .poll(async () =>
        BUILTIN_BACKGROUNDS.includes(await client.appBackground()),
      )
      .toBe(true);
    await client.openSettingsAppearance();
    expect(await client.themeTileExists('Полночь')).toBe(false);
    expect(await client.isThemeSelected('Как в системе')).toBe(true);
  });
});
