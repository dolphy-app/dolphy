import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const row = async (client: Client, id: string) =>
  (await client.readExtensions(id)).join('\n');

describe('зависимости расширений', () => {
  it('отключение зависимости меняет состояние зависимого на лету, включение возвращает; причина названа', async () => {
    workspace = await createWorkspace({
      extensions: {
        'acme.midnight': fixture('theme-extension'),
        'acme.dawn': fixture('dependent-extension'),
      },
    });
    app = await launchApp(workspace.userData);
    const client = new Client(app.page);
    await client.openSettingsExtensions();

    // обе строки загружены, у зависимого — список зависимостей с диапазоном
    let dawn = await row(client, 'acme.dawn');
    expect(dawn).toContain('Загружено');
    expect(dawn).toContain('Зависимости');
    expect(dawn).toContain('>=1.0.0 <2.0.0');

    await client.setExtensionSwitch('acme.midnight', 'enabled', false);
    await expect
      .poll(async () => row(client, 'acme.dawn'), { timeout: 30_000 })
      .toContain('Зависимости не выполнены');
    dawn = await row(client, 'acme.dawn');
    expect(dawn).toContain('Требуется расширение «acme.midnight»');
    expect(dawn).toContain('оно отключено');
    // пользователь может отключить такое расширение сам
    expect(await client.extensionSwitchCount('acme.dawn')).toBeGreaterThan(0);

    await client.setExtensionSwitch('acme.midnight', 'enabled', true);
    await expect
      .poll(async () => row(client, 'acme.dawn'), { timeout: 30_000 })
      .toContain('Загружено');
    expect(await row(client, 'acme.dawn')).not.toContain(
      'Зависимости не выполнены',
    );
  });

  it('зависимость отсутствует: состояние «зависимости не выполнены» с причиной «не установлено»', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.dawn': fixture('dependent-extension') },
    });
    app = await launchApp(workspace.userData);
    const client = new Client(app.page);
    await client.openSettingsExtensions();
    const dawn = await row(client, 'acme.dawn');
    expect(dawn).toContain('Зависимости не выполнены');
    expect(dawn).toContain('но оно не установлено');
  });
});
