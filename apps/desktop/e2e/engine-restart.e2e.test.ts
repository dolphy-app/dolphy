import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import {
  CATALOG_FIXTURES,
  catalogEnv,
  startCatalogServer,
} from './support/catalog-server.ts';
import type { CatalogServer, CatalogSource } from './support/catalog-server.ts';
import { Client } from './support/client.ts';

const THEME_EXTENSION = fileURLToPath(
  new URL('./fixtures/theme-extension', import.meta.url),
);

const catalogSource = (dir: string, name: string): CatalogSource => ({
  dir: join(CATALOG_FIXTURES, dir),
  name,
  description: name,
  author: 'acme',
});
const SUNRISE = catalogSource('sunrise-1.0.0', 'Sunrise');
const SUNSET = catalogSource('sunset', 'Sunset');

const MIDNIGHT = 'Полночь';
const MIDNIGHT_BACKGROUND = 'rgb(16, 24, 32)';
const SUNRISE_THEME = 'Рассвет';
const SUNSET_THEME = 'Закат';

let workspace: Workspace;
let server: CatalogServer | null = null;
let app: DolphyApp | null = null;

const installFromCatalog = async (
  client: Client,
  catalog: CatalogClient,
  id: string,
) => {
  await client.openSettingsExtensions();
  await catalog.openCatalogTab();
  await catalog.installButton(id).click();
  await catalog.confirmInstall();
  await catalog.closeDialog();
};

beforeEach(async () => {
  workspace = await createWorkspace({
    extensions: { 'acme.midnight': THEME_EXTENSION },
  });
});

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace.dispose();
});

describe('перезапуск хоста движка', () => {
  it('окно переживает убийство хоста без перезагрузки, вклады перечитываются, а изменения нового движка (поколение с нуля) применяются сразу', async () => {
    server = await startCatalogServer([SUNRISE, SUNSET]);
    app = await launchApp(workspace.userData, catalogEnv(server.url));
    const client = new Client(app.page);
    const catalog = new CatalogClient(app.page);

    // два применения: поколение прежнего движка (2) выше, чем у нового после первого применения (1)
    await installFromCatalog(client, catalog, 'acme.sunrise');
    await installFromCatalog(client, catalog, 'acme.sunset');
    await client.openSettingsAppearance();
    await client.selectTheme(MIDNIGHT);
    await expect.poll(() => client.appBackground()).toBe(MIDNIGHT_BACKGROUND);
    const stillSameWindow = await client.markWindow();

    const killed = await app.killEngineHost();
    await expect
      .poll(async () => {
        const pid = await app!.engineHostPid();
        return pid !== null && pid !== killed;
      })
      .toBe(true);

    // экран, которому нужен движок: ответ приходит уже от нового хоста
    await client.openSettingsExtensions();
    const [row] = await client.readExtensions('acme.midnight');
    expect(row).toContain('Загружено');
    await stillSameWindow();
    expect(await client.appBackground()).toBe(MIDNIGHT_BACKGROUND);
    await client.openSettingsAppearance();
    expect(await client.isThemeSelected(MIDNIGHT)).toBe(true);
    for (const theme of [SUNRISE_THEME, SUNSET_THEME]) {
      expect(await client.themeTileExists(theme)).toBe(true);
    }

    // первое применение нового движка (поколение 1) не отбрасывается как устаревшее
    await client.openSettingsExtensions();
    await catalog.openRemoveDialog('acme.sunset');
    await catalog.confirmRemove();
    await client.openSettingsAppearance();
    await expect.poll(() => client.themeTileExists(SUNSET_THEME)).toBe(false);
    expect(await client.themeTileExists(SUNRISE_THEME)).toBe(true);
    expect(await client.appBackground()).toBe(MIDNIGHT_BACKGROUND);
    await stillSameWindow();
  });
});
