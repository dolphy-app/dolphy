import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Frame, Locator } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { runAxe } from './support/axe.ts';
import { CommandsClient } from './support/commands-client.ts';
import {
  expectAttribute,
  expectCount,
  expectDisabled,
  expectText,
  expectVisible,
} from './support/locator.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/ui-kit-extension', import.meta.url),
);
const UI_ID = 'acme.uikit';
const PANEL_TITLE = 'Набор элементов';
/** Снимки для проверки дизайна глазами: не коммитятся. */
const REVIEW_DIR = '/tmp/dolphy-design-review-4c1';

let built: string | null = null;
let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

/** Расширение с панелью на наборе: исходник панели собирается в `panel.mjs`, как собрал бы автор. */
beforeAll(async () => {
  built = await mkdtemp(join(tmpdir(), 'dolphy-ui-kit-'));
  await cp(FIXTURE, built, { recursive: true });
  await build({
    config: false,
    cwd: FIXTURE,
    entry: { panel: join(FIXTURE, 'panel-source.mjs') },
    outDir: built,
    format: 'esm',
    platform: 'browser',
    dts: false,
    clean: false,
    logLevel: 'silent',
    report: false,
    publint: false,
    attw: false,
    deps: { alwaysBundle: [/.*/] },
    outExtensions: () => ({ js: '.mjs' }),
  });
}, 120_000);

afterAll(async () => {
  if (built !== null) await rm(built, { recursive: true, force: true });
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

const openPanel = async () => {
  if (built === null) throw new Error('the panel is not built');
  workspace = await createWorkspace({
    extensions: { [UI_ID]: built },
    libraryFiles: PLAIN_LIBRARY,
  });
  app = await launchApp(workspace.userData);
  const { page } = app;
  await page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  const commands = new CommandsClient(page);
  await commands.navItem(PANEL_TITLE).click();
  const handle = await commands.frameElement.elementHandle({ timeout: 30_000 });
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('the panel frame did not load');
  await frame.getByRole('heading', { name: 'Профиль' }).waitFor();
  return { page, commands, frame };
};

/** Рамка получила тему приложения: `color-scheme` её корня совпал с ожидаемым. */
const waitForFrameScheme = async (frame: Frame, scheme: 'light' | 'dark') => {
  await expect
    .poll(
      () => frame.evaluate(() => document.documentElement.style.colorScheme),
      { timeout: 15_000 },
    )
    .toBe(scheme);
};

describe('набор элементов расширений (@dolphy-app/extension-ui)', () => {
  it('панель на наборе без нарушений axe (serious, critical) в светлой и тёмной темах', async () => {
    const { page, frame } = await openPanel();
    await mkdir(REVIEW_DIR, { recursive: true });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await waitForFrameScheme(frame, scheme);
      // цвета набора пришли из переменных темы, а не из значений по умолчанию
      const surface = await frame.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.background = 'rgb(var(--v-theme-surface))';
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const card = document.querySelector('.dui-card');
        return {
          themed: value,
          card: card ? getComputedStyle(card).backgroundColor : '',
        };
      });
      expect(surface.card, scheme).toBe(surface.themed);
      const violations = await runAxe(frame, {
        impacts: ['serious', 'critical'],
      });
      expect(violations, `панель ${scheme}`).toEqual([]);
      await page.screenshot({ path: join(REVIEW_DIR, `panel-${scheme}.png`) });
      await frame.locator('[data-role="status"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(REVIEW_DIR, `panel-${scheme}-bottom.png`),
      });
      await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
    }
    // тёмная и светлая поверхности различаются: тема действительно переключилась
    const colors = new Set<string>();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await waitForFrameScheme(frame, scheme);
      colors.add(
        await frame.evaluate(
          () =>
            getComputedStyle(document.querySelector('.dui-card')!)
              .backgroundColor,
        ),
      );
    }
    expect(colors.size).toBe(2);
  });

  it('управление с клавиатуры: поле, список, переключатель и кнопка', async () => {
    const { page, frame } = await openPanel();
    const status = frame.locator('[data-role="status"]');
    const said = (text: string) => expectText(status, text);
    const focused = (locator: Locator) =>
      expect
        .poll(() =>
          locator.evaluate((node) => node === node.ownerDocument.activeElement),
        )
        .toBe(true);

    await frame.getByRole('textbox', { name: 'Имя' }).focus();
    await page.keyboard.type('!');
    await said('Имя: Ада!');

    const list = frame.getByRole('listbox', { name: 'Список курсов' });
    await expectVisible(list);
    const options = list.getByRole('option');
    await expectCount(options, 3);
    await expectAttribute(options.nth(0), 'aria-selected', 'true');
    // в порядке табуляции один пункт списка: выбранный
    expect(
      await options.evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).tabIndex),
      ),
    ).toEqual([0, -1, -1]);
    await options.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await focused(options.nth(1));
    // «Архив» недоступен: стрелка вниз остаётся на последнем доступном
    await page.keyboard.press('ArrowDown');
    await focused(options.nth(1));
    await page.keyboard.press('Enter');
    await said('Выбран: js');
    await expectAttribute(options.nth(1), 'aria-selected', 'true');
    await expectAttribute(options.nth(0), 'aria-selected', 'false');

    const toggle = frame.getByRole('switch', {
      name: 'Присылать напоминания',
    });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expectAttribute(toggle, 'aria-checked', 'true');
    await said('Включено');
    await expectDisabled(
      frame.getByRole('switch', { name: 'Недоступный переключатель' }),
      true,
    );

    await frame.getByRole('button', { name: 'Основное' }).focus();
    await page.keyboard.press('Enter');
    await said('Основное');
    await expectDisabled(
      frame.getByRole('button', { name: 'Недоступное' }),
      true,
    );

    // у каждого элемента есть роль и видимое имя
    await expectVisible(frame.getByRole('combobox', { name: 'Уровень' }));
    await expectVisible(frame.getByRole('region', { name: 'Профиль' }));
    await expectVisible(frame.getByRole('group', { name: 'Пока пусто' }));
    await expectAttribute(
      frame.getByRole('spinbutton', { name: 'Возраст' }),
      'aria-invalid',
      'true',
    );
  });
});
