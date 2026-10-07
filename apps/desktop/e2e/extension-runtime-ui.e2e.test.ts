import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { course, exerciseFront } from './support/courses.ts';
import { expectCount, expectText, expectVisible } from './support/locator.ts';

const EXTENSION_ID = 'acme.runtimeui';
const BUNDLES = ['main.mjs', 'client.mjs'];
/** Предел размера бандла: vue и vuetify в него не входят. */
const BUNDLE_LIMIT_BYTES = 20 * 1024;

const OK = 'Runtime ok (KnowledgeBase)';
const BOOM_VIEW = 'Runtime view boom (KnowledgeBase)';
const BOOM_MARKDOWN = 'Runtime markdown boom (KnowledgeBase)';

const withBlock = (type: string, language: string, source: string) =>
  [
    '---',
    'engine:',
    '  exercise:',
    `    type: ${type}`,
    '    spec: {}',
    '---',
    'Components',
    '',
    `\`\`\`${language}`,
    source,
    '```',
    '',
  ].join('\n');

const LIBRARY: Record<string, string> = {
  ...course('rui_ok_kb', OK, withBlock('acme.runtimeui.ok', 'runtimeui', 'hi')),
  ...course(
    'rui_view_kb',
    BOOM_VIEW,
    exerciseFront('acme.runtimeui.boom', ['    spec: {}'], 'Broken view.'),
  ),
  ...course(
    'rui_md_kb',
    BOOM_MARKDOWN,
    withBlock('acme.runtimeui.ok', 'explode', 'raw source'),
  ),
};

let built: BuiltExtension | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

beforeAll(async () => {
  built = await buildFixtureExtension(
    fileURLToPath(new URL('./fixtures/runtime-ui-extension', import.meta.url)),
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

/** Тема, которую окно сейчас применило (`v-theme--<имя>` на корне Vuetify). */
const appTheme = (page: Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('.v-theme--light, .v-theme--dark')
        ?.className.match(/v-theme--(\S+)/)?.[1] ?? null,
  );

const shownTheme = async (scope: Locator) =>
  (await scope.locator('[data-role="theme"]').textContent())?.replace(
    'Тема: ',
    '',
  );

const expectThemeFollows = async (page: Page, scope: Locator) => {
  await expect.poll(() => shownTheme(scope)).toBe(await appTheme(page));
};

const openSession = async (client: Client, name: string) => {
  await client.openCourses();
  await client.focusCourse(name);
  await client.startSession();
};

describe('поверхности расширения на Vue и Vuetify (R2, R4)', () => {
  it('инъекция, панель, вид ответа и блок markdown живут в дереве окна без iframe и видят тему приложения', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();

    const injection = page.getByTestId('runtimeui-injection');
    await expectVisible(injection);
    await expectThemeFollows(page, injection);
    await expectCount(page.locator('iframe'), 0);

    await commands.navItem('Компоненты').click();
    const panel = page.getByTestId('runtimeui-panel');
    await expectText(
      panel.locator('[data-role="panel-id"]'),
      'acme.runtimeui.main',
    );
    await expectThemeFollows(page, panel);
    await expectCount(page.locator('iframe'), 0);

    await openSession(client, OK);
    const answer = page.getByTestId('runtimeui-answer');
    await expectVisible(answer);
    await expectThemeFollows(page, answer);
    const block = page.getByTestId('runtimeui-markdown');
    await expectVisible(block);
    await expectThemeFollows(page, block);
    await expectText(block, 'hi');
    await expectCount(page.locator('iframe'), 0);

    // смена темы в настройках доходит до компонентов без перезагрузки окна
    await page
      .getByRole('button', { name: 'Выйти из сессии', exact: true })
      .click();
    const before = await appTheme(page);
    await client.openSettingsAppearance();
    await client.selectTheme(before === 'dark' ? 'Светлая' : 'Тёмная');
    await expect.poll(() => appTheme(page)).not.toBe(before);
    await commands.navItem('Компоненты').click();
    await expectThemeFollows(page, page.getByTestId('runtimeui-panel'));
    await client.openPlan();
    await expectThemeFollows(page, page.getByTestId('runtimeui-injection'));
    await stillSameWindow();
  });

  it('вид ответа: ввод и кнопка компонента доходят до окна событиями change и submit', async () => {
    const { page, client } = await launch();
    await openSession(client, OK);
    await client.fillAnswer({
      text: 'anything',
      element: 'runtimeui-answer',
    });
    await page
      .getByTestId('runtimeui-answer')
      .getByRole('button', { name: 'Отправить из вида', exact: true })
      .click();
    await page.getByText('Верно', { exact: true }).waitFor({ timeout: 15_000 });
  });

  it('VDialog панели открывается в слое оверлеев приложения поверх всего окна, а не внутри панели', async () => {
    const { page, commands } = await launch();
    await commands.navItem('Компоненты').click();
    await page
      .getByTestId('runtimeui-panel')
      .getByRole('button', { name: 'Открыть диалог', exact: true })
      .click();
    const dialog = page.getByTestId('runtimeui-dialog');
    await expectVisible(dialog);

    const placement = await dialog.evaluate((node) => ({
      insidePanel: node.closest('[data-testid="runtimeui-panel"]') !== null,
      inOverlayLayer: node.closest('.v-overlay-container') !== null,
    }));
    expect(placement).toEqual({ insidePanel: false, inOverlayLayer: true });
    // подложка закрывает всё окно, а не область панели
    const scrim = await page.locator('.v-overlay__scrim').last().boundingBox();
    const viewport =
      page.viewportSize() ??
      (await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      })));
    expect(scrim?.x).toBe(0);
    expect(scrim?.y).toBe(0);
    expect(scrim?.width).toBe(viewport.width);
    expect(scrim?.height).toBe(viewport.height);

    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expectCount(page.getByTestId('runtimeui-dialog'), 0);
  });

  it('бандлы не включают vue и vuetify: каждый не больше 20 КиБ gzip', async () => {
    for (const name of BUNDLES) {
      const bundle = await readFile(join(built!.dir, name));
      expect(gzipSync(bundle).length, name).toBeLessThanOrEqual(
        BUNDLE_LIMIT_BYTES,
      );
      expect(bundle.toString('utf8'), name).not.toMatch(
        /from\s*["']vuetify?(\/[^"']*)?["']/,
      );
    }
  });
});

describe('сбой компонентов расширения не роняет окно (R2)', () => {
  it('панель: карточка ошибки, окно и остальные поверхности живы', async () => {
    const { page, client, commands } = await launch();
    const stillSameWindow = await client.markWindow();
    await commands.navItem('Сломанная панель').click();
    await expectVisible(page.getByTestId('panel-load-failed'));
    await expectVisible(page.getByTestId('panel-retry'));

    await commands.navItem('Компоненты').click();
    await expectVisible(page.getByTestId('runtimeui-panel'));
    await stillSameWindow();
  });

  it('вид ответа: карточка ошибки с «Повторить», упражнение остаётся живым', async () => {
    const { page, client } = await launch();
    const stillSameWindow = await client.markWindow();
    await openSession(client, BOOM_VIEW);
    await expectVisible(page.getByTestId('answer-view-failed'));
    await expectVisible(page.getByTestId('answer-view-retry'));
    await expectText(page.locator('.v-main'), 'Broken view.');
    await page
      .getByRole('button', { name: 'Выйти из сессии', exact: true })
      .click();
    await client.openPlan();
    await stillSameWindow();
  });

  it('рендерер markdown: ошибка на месте блока, остальной текст цел', async () => {
    const { page, client } = await launch();
    await openSession(client, BOOM_MARKDOWN);
    const block = page.locator('.dolphy-md-block[data-language=explode]');
    await expectVisible(block.locator('.dolphy-md-error'));
    await expectText(page.locator('.v-main'), 'Components');
    expect(await block.getAttribute('data-state')).toBe('error');
  });
});
