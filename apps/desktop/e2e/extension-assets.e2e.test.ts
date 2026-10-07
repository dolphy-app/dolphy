import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import {
  course,
  exerciseFront,
  MARKDOWN,
  markdownCourse,
} from './support/courses.ts';
import { expectCount } from './support/locator.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const ASSETS_ID = 'acme.assets';
const ASSETS_DIR = fixture('assets-extension');
const ASSETS_PANEL = 'Ресурсы';
const ASSETS_NAME = 'Assets (KnowledgeBase)';

const ASSETS_COURSE = course(
  'assets_kb',
  ASSETS_NAME,
  exerciseFront(ASSETS_ID, [], 'Show the assets.'),
);

/** Что показывает компонент фикстуры, когда ресурсы подключены. */
const APPLIED = {
  css: 'applied',
  png: '4',
  svg: '8',
  font: 'loaded',
};

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let devRoot: string | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
  if (devRoot !== null) await rm(devRoot, { recursive: true, force: true });
  devRoot = null;
});

interface Launched {
  page: Page;
  client: Client;
  commands: CommandsClient;
}

const launch = async (
  extensions: Record<string, string>,
  libraryFiles: Record<string, string>,
  env?: Record<string, string>,
  prepare?: (userData: string) => Promise<void>,
): Promise<Launched> => {
  workspace = await createWorkspace({ extensions, libraryFiles });
  await prepare?.(workspace.userData);
  app = await launchApp(workspace.userData, env);
  await app.page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: 30_000 });
  return {
    page: app.page,
    client: new Client(app.page),
    commands: new CommandsClient(app.page),
  };
};

const readReport = async (scope: Locator) => {
  const report = scope.locator('[data-role="assets-report"]');
  await report.waitFor({ timeout: 30_000 });
  await expect
    .poll(() => report.getAttribute('data-font'), { timeout: 30_000 })
    .not.toBeNull();
  return report.evaluate((node) => ({ ...(node as HTMLElement).dataset }));
};

const openCourseSession = async (client: Client, name: string) => {
  await client.openCourses();
  await client.focusCourse(name);
  await client.startSession();
};

describe('ресурсы расширений в окне приложения', () => {
  it('панель: таблица стилей применена, PNG и SVG декодированы, шрифт загружен', async () => {
    const { page, commands } = await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      PLAIN_LIBRARY,
    );
    await commands.navItem(ASSETS_PANEL).click();
    const scope = page.locator('.v-main');
    expect(await readReport(scope)).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
    expect(
      await scope
        .locator('[data-role="probe"]')
        .evaluate((node) => getComputedStyle(node).color),
    ).toBe('rgb(1, 2, 3)');
    expect(
      await scope
        .locator('[data-role="png"]')
        .evaluate((node) => (node as HTMLImageElement).complete),
    ).toBe(true);
    await expectCount(page.locator('iframe'), 0);
  });

  it('вид ответа: стили, шрифт и изображения загружены в окне', async () => {
    const { page, client } = await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      ASSETS_COURSE,
    );
    await openCourseSession(client, ASSETS_NAME);
    expect(await readReport(page.locator('.v-main'))).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
    await expectCount(page.locator('iframe'), 0);
  });

  it('рендерер Markdown: таблица, изображения и шрифт в блоке', async () => {
    const { page, client } = await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      markdownCourse('assets'),
    );
    await openCourseSession(client, MARKDOWN);
    expect(await readReport(page.locator('.v-main'))).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
    await expectCount(page.locator('iframe'), 0);
  });

  it('режим разработчика: правка таблицы стилей показывает новые стили без перезагрузки окна', async () => {
    devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-assets-'));
    await cp(ASSETS_DIR, join(devRoot, ASSETS_ID), { recursive: true });
    const { page, commands, client } = await launch({}, PLAIN_LIBRARY, {
      DOLPHY_DEV_EXTENSIONS: devRoot,
    });
    await commands.navItem(ASSETS_PANEL).click();
    const scope = page.locator('.v-main');
    expect(await readReport(scope)).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
    const stillSameWindow = await client.markWindow();

    const file = join(devRoot, ASSETS_ID, 'assets', 'panel.css');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('#010203', '#090807'),
    );
    await expect
      .poll(
        async () => {
          const report = scope.locator('[data-role="assets-report"]');
          return report.getAttribute('data-css').catch(() => null);
        },
        { timeout: 30_000 },
      )
      .toBe('rgb(9, 8, 7)');
    await stillSameWindow();
  });
});

describe('протокол dolphy-ext', () => {
  interface Answer {
    status: number;
    type: string | null;
    nosniff: string | null;
    cache: string | null;
    cors: string | null;
    csp: string | null;
  }

  const fetchAll = (urls: string[]) =>
    app!.evaluateMain(async ({ net }, list) => {
      const answers: Record<string, Answer> = {};
      for (const url of list) {
        const response = await net.fetch(url);
        await response.arrayBuffer();
        answers[url] = {
          status: response.status,
          type: response.headers.get('content-type'),
          nosniff: response.headers.get('x-content-type-options'),
          cache: response.headers.get('cache-control'),
          cors: response.headers.get('access-control-allow-origin'),
          csp: response.headers.get('content-security-policy'),
        };
      }
      return answers;
    }, urls);

  it('типы ресурсов, заголовки, закрытые файлы, символические ссылки, потолки размера', async () => {
    let linked = true;
    await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      PLAIN_LIBRARY,
      undefined,
      async (userData) => {
        const assets = join(userData, 'extensions', ASSETS_ID, 'assets');
        const secret = join(userData, 'secret.png');
        await cp(join(assets, 'pixel.png'), secret);
        await writeFile(join(assets, 'huge.css'), Buffer.alloc(256 * 1024 + 1));
        await mkdir(join(userData, 'outside'), { recursive: true });
        await cp(secret, join(userData, 'outside', 'a.png'));
        try {
          await symlink(secret, join(assets, 'leak.png'));
          await symlink(
            join(userData, 'outside'),
            join(userData, 'extensions', ASSETS_ID, 'linked-dir'),
          );
        } catch (error) {
          // без права создавать символические ссылки (Windows без режима разработчика)
          if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
          linked = false;
        }
      },
    );
    const at = (id: string, path: string) => `dolphy-ext://${id}/${path}`;
    const answers = await fetchAll([
      at(ASSETS_ID, 'assets/panel.css'),
      at(ASSETS_ID, 'assets/pixel.png'),
      at(ASSETS_ID, 'assets/shape.svg'),
      at(ASSETS_ID, 'assets/font.woff2'),
      at(ASSETS_ID, 'assets/evil.svg'),
      at(ASSETS_ID, 'main.mjs'),
      at(ASSETS_ID, 'extension.json'),
      at(ASSETS_ID, 'README.md'),
      at(ASSETS_ID, 'assets/PIXEL.PNG'),
      at(ASSETS_ID, 'assets/pixel.gif'),
      at(ASSETS_ID, 'assets/huge.css'),
      at(ASSETS_ID, 'assets/leak.png'),
      at(ASSETS_ID, 'linked-dir/a.png'),
    ]);
    const get = (id: string, path: string) => answers[at(id, path)]!;

    const css = get(ASSETS_ID, 'assets/panel.css');
    expect(css).toMatchObject({
      status: 200,
      type: 'text/css; charset=utf-8',
      nosniff: 'nosniff',
      cache: 'no-cache',
      cors: '*',
    });
    expect(get(ASSETS_ID, 'assets/pixel.png').type).toBe('image/png');
    expect(get(ASSETS_ID, 'assets/font.woff2').type).toBe('font/woff2');
    const sandbox = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    expect(get(ASSETS_ID, 'assets/shape.svg')).toMatchObject({
      status: 200,
      type: 'image/svg+xml',
      nosniff: 'nosniff',
      csp: sandbox,
    });
    // SVG со скриптом отдаётся, но с той же песочницей
    expect(get(ASSETS_ID, 'assets/evil.svg')).toMatchObject({
      status: 200,
      csp: sandbox,
    });
    expect(get(ASSETS_ID, 'main.mjs')).toMatchObject({
      status: 200,
      type: 'text/javascript',
      nosniff: 'nosniff',
    });
    for (const closed of [
      'extension.json',
      'README.md',
      'assets/PIXEL.PNG',
      'assets/pixel.gif',
    ]) {
      expect(get(ASSETS_ID, closed).status, closed).toBe(404);
    }
    expect(get(ASSETS_ID, 'assets/huge.css').status).toBe(413);
    if (linked) {
      expect(get(ASSETS_ID, 'assets/leak.png').status).toBe(404);
      expect(get(ASSETS_ID, 'linked-dir/a.png').status).toBe(404);
    }
  });
});
