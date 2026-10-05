import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FrameLocator, Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { buildFixtureExtension } from './support/build-extension.ts';
import type { BuiltExtension } from './support/build-extension.ts';
import { ANSWER_FRAME, Client } from './support/client.ts';
import {
  course,
  exerciseFront,
  MARKDOWN,
  markdownCourse,
} from './support/courses.ts';
import { expectVisible } from './support/locator.ts';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/ui-overlay-extension', import.meta.url),
);
const OVERLAY_ID = 'acme.overlay';
const OVERLAY = 'Overlay (KnowledgeBase)';
const MARKDOWN_FRAME = 'iframe[sandbox][data-mode="markdown"]';
const WIDGET_FRAME = 'iframe[sandbox][data-mode="widget"]';

const LIBRARY = {
  ...course(
    'overlay_kb',
    OVERLAY,
    exerciseFront('acme.overlay', [], 'Open the menu.'),
  ),
  ...markdownCourse('overlay'),
};

let extension: BuiltExtension | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** Расширение собирается `dolphy-ext build`: меню и диалог набора лежат в его бандле, а не в приложении. */
beforeAll(async () => {
  extension = await buildFixtureExtension(FIXTURE);
}, 180_000);

afterAll(async () => {
  await extension?.dispose();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const launch = async (): Promise<Client> => {
  if (extension === null) throw new Error('the extension is not built');
  workspace = await createWorkspace({
    extensions: { [OVERLAY_ID]: extension.dir },
    libraryFiles: LIBRARY,
  });
  app = await launchApp(workspace.userData);
  const client = new Client(app.page);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return client;
};

const heightOf = async (frame: Locator): Promise<number> =>
  Math.round((await frame.boundingBox())?.height ?? -1);

const windowHeight = (page: Page): Promise<number> =>
  page.evaluate(() => window.innerHeight);

/** Окружающий прямоугольник `inner` лежит внутри `frame` (координаты окна приложения). */
const fitsInside = async (inner: Locator, frame: Locator): Promise<boolean> => {
  const [box, outer] = await Promise.all([
    inner.boundingBox(),
    frame.boundingBox(),
  ]);
  if (box === null || outer === null) return false;
  return (
    box.y >= outer.y - 1 &&
    box.y + box.height <= outer.y + outer.height + 1 &&
    box.x >= outer.x - 1 &&
    box.x + box.width <= outer.x + outer.width + 1
  );
};

/**
 * Одинаковое поведение рамки `answer`, `markdown` и `widget`: меню и диалог у нижнего края
 * короткого содержимого видны целиком, рамка вырастает на время оверлея и возвращается;
 * просьба расширения занять 100000 px упирается в высоту окна.
 */
const exerciseOverlays = async (
  page: Page,
  frameElement: Locator,
  scope: FrameLocator,
) => {
  const open = scope.getByRole('button', { name: 'Действия' });
  await open.waitFor();
  const idle = await heightOf(frameElement);
  expect(idle).toBeGreaterThan(40);
  const ceiling = await windowHeight(page);

  // меню: рамка выросла, список виден целиком, после закрытия высота прежняя
  await open.click();
  const menu = scope.locator('.v-menu .v-overlay__content');
  await expectVisible(menu);
  await expect
    .poll(() => fitsInside(menu, frameElement), { timeout: 15_000 })
    .toBe(true);
  expect(await heightOf(frameElement)).toBeGreaterThan(idle + 100);
  expect(await heightOf(frameElement)).toBeLessThanOrEqual(ceiling);
  await expect
    .poll(() => menu.getByText('Шестое', { exact: true }).isVisible())
    .toBe(true);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  await expect.poll(() => heightOf(frameElement)).toBe(idle);

  // диалог: карточка внутри рамки, после закрытия высота прежняя
  await scope.locator('[data-role="open-dialog"]').click();
  const dialog = scope.getByRole('dialog', { name: 'Подтверждение' });
  await expectVisible(dialog);
  await expect
    .poll(() => fitsInside(dialog.locator('.v-card'), frameElement), {
      timeout: 15_000,
    })
    .toBe(true);
  expect(await heightOf(frameElement)).toBeGreaterThan(idle);
  await scope.getByRole('button', { name: 'Отмена' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await expect.poll(() => heightOf(frameElement)).toBe(idle);

  // расширение просит 100000 px: рамка не выше окна приложения
  await scope.locator('[data-role="take-screen"]').click();
  await expect
    .poll(() => heightOf(frameElement), { timeout: 15_000 })
    .toBeGreaterThan(idle);
  await expect.poll(() => heightOf(frameElement)).toBe(ceiling);
  expect(await windowHeight(page)).toBe(ceiling);
  await scope.locator('[data-role="release-screen"]').click();
  await expect.poll(() => heightOf(frameElement)).toBe(idle);
};

describe('оверлеи набора в рамках answer, markdown и widget (R4)', () => {
  it('вид ответа: меню и диалог видны целиком, рамка растёт и возвращается, потолок — окно', async () => {
    const client = await launch();
    await client.openCourses();
    await client.focusCourse(OVERLAY);
    await client.startSession();
    const frame = client.page.locator(ANSWER_FRAME);
    await frame.waitFor({ state: 'attached' });
    await exerciseOverlays(
      client.page,
      frame,
      client.page.frameLocator(ANSWER_FRAME),
    );
  });

  it('рендерер markdown: то же поведение', async () => {
    const client = await launch();
    await client.openCourses();
    await client.focusCourse(MARKDOWN);
    await client.startSession();
    const block = client.page.locator(
      '.dolphy-md-block[data-language=overlay]',
    );
    await expect
      .poll(() => block.getAttribute('data-state'), { timeout: 15_000 })
      .toBe('done');
    await exerciseOverlays(
      client.page,
      block.locator(MARKDOWN_FRAME),
      client.page.frameLocator(MARKDOWN_FRAME),
    );
  });

  it('виджет: то же поведение, ограничение высоты манифеста на время оверлея не действует', async () => {
    const client = await launch();
    const { page } = client;
    const card = page
      .getByTestId('extension-widgets')
      .locator('[data-widget-id="acme.overlay.widget"]');
    const frame = card.locator(WIDGET_FRAME);
    await frame.waitFor({ state: 'attached' });
    await exerciseOverlays(page, frame, card.frameLocator(WIDGET_FRAME));
  });
});
