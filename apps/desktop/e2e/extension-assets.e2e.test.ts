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
import type { FrameLocator, Locator, Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { ANSWER_FRAME, Client } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import {
  course,
  exerciseFront,
  MARKDOWN,
  markdownCourse,
} from './support/courses.ts';
import { PLAIN_LIBRARY } from './support/state-client.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const ASSETS_ID = 'acme.assets';
const HOSTILE_ID = 'acme.hostile-assets';
const ASSETS_DIR = fixture('assets-extension');
const HOSTILE_DIR = fixture('hostile-assets-extension');
const ASSETS_PANEL = 'Ресурсы';
const HOSTILE_PANEL = 'Враждебные ресурсы';
const ASSETS_NAME = 'Assets (KnowledgeBase)';
const MARKDOWN_FRAME = 'iframe[sandbox][data-mode="markdown"]';

const ASSETS_COURSE = course(
  'assets_kb',
  ASSETS_NAME,
  exerciseFront(ASSETS_ID, [], 'Show the assets.'),
);

/** Что показывает рамка фикстуры, когда ресурсы подключены. */
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

const readReport = async (scope: FrameLocator | Locator) => {
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

/** Состояния проб рамки: имя → `blocked`/`reachable`/`pending`. */
const readProbes = async (scope: FrameLocator) => {
  const lines = await scope.locator('[data-probe]').allInnerTexts();
  return Object.fromEntries(
    lines.map((line) => {
      const at = line.lastIndexOf(': ');
      return [line.slice(0, at), line.slice(at + 2)];
    }),
  );
};

describe('ресурсы расширений в изолированных рамках', () => {
  it('панель: таблица стилей применена, PNG и SVG декодированы, шрифт загружен', async () => {
    const { commands } = await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      PLAIN_LIBRARY,
    );
    await commands.navItem(ASSETS_PANEL).click();
    expect(await readReport(commands.frame)).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
    expect(
      await commands.frame
        .locator('[data-role="probe"]')
        .evaluate((node) => getComputedStyle(node).color),
    ).toBe('rgb(1, 2, 3)');
    expect(
      await commands.frame
        .locator('[data-role="png"]')
        .evaluate((node) => (node as HTMLImageElement).complete),
    ).toBe(true);
  });

  it('элемент ввода: стили в тени, шрифт в документе, изображения загружены', async () => {
    const { page, client } = await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      ASSETS_COURSE,
    );
    await openCourseSession(client, ASSETS_NAME);
    const frame = page.frameLocator(ANSWER_FRAME);
    await frame.locator('acme-assets-answer').waitFor({ state: 'attached' });
    expect(await page.locator('acme-assets-answer').count()).toBe(0);
    // отчёт внутри тени элемента
    const report = frame.locator(
      'acme-assets-answer [data-role="assets-report"]',
    );
    await expect
      .poll(() => report.getAttribute('data-font'), { timeout: 30_000 })
      .not.toBeNull();
    expect(
      await report.evaluate((node) => ({ ...(node as HTMLElement).dataset })),
    ).toMatchObject({ ...APPLIED, sheets: 'loaded,loaded' });
  });

  it('рендерер Markdown: таблица, изображения и шрифт в блоке', async () => {
    const { page, client } = await launch(
      { [ASSETS_ID]: ASSETS_DIR },
      markdownCourse('assets'),
    );
    await openCourseSession(client, MARKDOWN);
    const frame = page.frameLocator(MARKDOWN_FRAME);
    expect(await readReport(frame)).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
  });

  it('режим разработчика: правка таблицы стилей показывает новые стили в новой рамке без перезагрузки окна', async () => {
    devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-assets-'));
    await cp(ASSETS_DIR, join(devRoot, ASSETS_ID), { recursive: true });
    const { commands, client } = await launch({}, PLAIN_LIBRARY, {
      DOLPHY_DEV_EXTENSIONS: devRoot,
    });
    await commands.navItem(ASSETS_PANEL).click();
    expect(await readReport(commands.frame)).toMatchObject({
      ...APPLIED,
      sheets: 'loaded',
    });
    await commands.frameElement.evaluate((node) => {
      Reflect.set(node, '__old', true);
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
          const report = commands.frame.locator('[data-role="assets-report"]');
          return report.getAttribute('data-css').catch(() => null);
        },
        { timeout: 30_000 },
      )
      .toBe('rgb(9, 8, 7)');
    // новый iframe, а не перезагруженный прежний
    expect(
      await commands.frameElement.evaluate((node) =>
        Reflect.get(node, '__old'),
      ),
    ).toBeUndefined();
    await stillSameWindow();
  });
});

describe('враждебное расширение', () => {
  const blockedProbes = [
    'other: script via import()',
    'other: main via import()',
    'other: css via link',
    'other: png via img',
    'other: svg via img',
    'other: font via @font-face',
    'other: css via @import',
    'other: png via css url()',
    'other: extension.json via link',
    'other: README.md via img',
    'own: extension.json via import()',
    'own: extension.json via link',
    'own: README.md via img',
    'own: extension.json via fetch',
  ];
  const controls = [
    'control: own png via img',
    'control: own css via link',
    'control: own css via @import',
    'control: own png via css url()',
    'control: own font via @font-face',
  ];

  it('рамка не загружает скрипты, стили, изображения и шрифты чужого расширения, не получает манифесты и README', async () => {
    const { commands } = await launch(
      { [ASSETS_ID]: ASSETS_DIR, [HOSTILE_ID]: HOSTILE_DIR },
      PLAIN_LIBRARY,
    );
    await commands.navItem(HOSTILE_PANEL).click();
    await expect
      .poll(
        async () => {
          const probes = await readProbes(commands.frame);
          return Object.keys(probes).length === 0
            ? ['pending']
            : Object.values(probes);
        },
        { timeout: 30_000 },
      )
      .not.toContain('pending');
    const probes = await readProbes(commands.frame);
    // контроль: свои ресурсы загружаются, значит пробы измеряют именно запрет
    for (const name of controls) expect(probes[name], name).toBe('reachable');
    for (const name of blockedProbes)
      expect(probes[name], name).toBe('blocked');
    expect(Object.keys(probes).sort()).toEqual(
      [...controls, ...blockedProbes].sort(),
    );
  });

  it('SVG со скриптом, скопированный вручную: отдаётся с песочницей и не выполняется', async () => {
    const { page, commands } = await launch(
      { [HOSTILE_ID]: HOSTILE_DIR },
      PLAIN_LIBRARY,
    );
    await commands.navItem(HOSTILE_PANEL).click();
    await commands.frame
      .getByRole('button', { name: 'Открыть SVG', exact: true })
      .click();
    const opened = async () =>
      page.frames().find((frame) => frame.url().endsWith('/assets/evil.svg'));
    await expect.poll(opened, { timeout: 30_000 }).toBeDefined();
    const frame = (await opened())!;
    // документ SVG загружен (корень svg), но ни `<script>`, ни `onload` не сработали
    await expect
      .poll(() => frame.evaluate(() => document.documentElement.localName), {
        timeout: 30_000,
      })
      .toBe('svg');
    expect(
      await frame.evaluate(() => Reflect.get(window, '__svgRan') ?? null),
    ).toBeNull();
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
      { [ASSETS_ID]: ASSETS_DIR, [HOSTILE_ID]: HOSTILE_DIR },
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
      at(HOSTILE_ID, 'assets/evil.svg'),
      at(ASSETS_ID, 'main.mjs'),
      at(ASSETS_ID, 'extension.json'),
      at(ASSETS_ID, 'README.md'),
      at(ASSETS_ID, 'assets/PIXEL.PNG'),
      at(ASSETS_ID, 'assets/pixel.gif'),
      at(ASSETS_ID, 'assets/huge.css'),
      at(ASSETS_ID, 'assets/leak.png'),
      at(ASSETS_ID, 'linked-dir/a.png'),
      at(ASSETS_ID, '__dolphy/frame.html'),
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
    expect(get(HOSTILE_ID, 'assets/evil.svg')).toMatchObject({
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
    expect(get(ASSETS_ID, '__dolphy/frame.html').csp).toContain(
      `script-src dolphy-ext://${ASSETS_ID};`,
    );
  });
});
