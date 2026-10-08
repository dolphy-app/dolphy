import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CommandsClient } from './support/commands-client.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const EXTENSION_ID = 'acme.hdr';
const DIR = fileURLToPath(
  new URL('./fixtures/panel-header-extension', import.meta.url),
);

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async () => {
  workspace = await createWorkspace({ extensions: { [EXTENSION_ID]: DIR } });
  app = await launchApp(workspace.userData);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return { page: app.page, commands: new CommandsClient(app.page) };
};

/** `data-testid` или тег элемента, который сейчас в фокусе. */
const focused = (commands: CommandsClient) =>
  commands.page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('data-testid') ?? el?.tagName ?? null;
  });

describe('шапка панели расширения (header)', () => {
  it('header: false — нет кнопки «Назад» и заголовка приложения; заголовок рисует панель; фокус на контейнере', async () => {
    const { page, commands } = await launch();
    await commands.navItem('Панель без шапки').click();
    await expectVisible(commands.panelRole('own'));

    await expectCount(page.getByTestId('panel-back'), 0);
    await expectCount(page.getByRole('heading', { level: 1 }), 1);
    await expectText(commands.panelHeading, 'Своя страница');
    await expectCount(page.getByText(EXTENSION_ID, { exact: true }), 0);
    await expect.poll(() => focused(commands)).toBe('extension-panel-body');
    expect(await commands.panel.getAttribute('aria-label')).toBe(
      'Панель без шапки',
    );
    expect(await commands.panel.getAttribute('tabindex')).toBe('-1');
  });

  it('панель по умолчанию сохраняет шапку: «Назад», заголовок, id, фокус на заголовке', async () => {
    const { page, commands } = await launch();
    await commands.navItem('Панель с шапкой').click();
    await expectVisible(commands.panelRole('standard'));

    await expectVisible(page.getByTestId('panel-back'));
    await expectText(commands.panelHeading, 'Панель с шапкой');
    await expectVisible(page.getByText(EXTENSION_ID, { exact: true }));
    await expect.poll(() => focused(commands)).toBe('H1');
    expect(await commands.panel.getAttribute('tabindex')).toBeNull();
  });
});
