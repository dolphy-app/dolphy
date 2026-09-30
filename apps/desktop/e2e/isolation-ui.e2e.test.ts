import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FrameLocator, Locator } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { SpirulaApp, Workspace } from './support/app.ts';
import { ANSWER_FRAME, Client } from './support/client.ts';
import { readJournal } from './support/journal.ts';

const HOSTILE_UI = 'Hostile UI (KnowledgeBase)';
const ECHO = 'Echo (KnowledgeBase)';
const MARKDOWN = 'Frames (KnowledgeBase)';
const MARKDOWN_FRAME = 'iframe[sandbox][data-mode="markdown"]';
const PROBES = [
  'parent.spirula',
  'top.document',
  'localStorage',
  'document.cookie',
  'fetch',
];

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** Курс из одного упражнения: `front` — всё после frontmatter. */
const course = (id: string, name: string, front: string) => ({
  [`${id}/course_manifest.json`]: JSON.stringify({
    dependencies: [],
    description: name,
    engine: { tags: [id] },
    generator_config: { KnowledgeBase: {} },
    id,
    name,
  }),
  [`${id}/basic.lesson/lesson.name.json`]: JSON.stringify('Frames'),
  [`${id}/basic.lesson/q1.front.md`]: front,
  [`${id}/basic.lesson/q1.back.md`]: 'Answer\n',
});

const exerciseFront = (type: string, spec: string[], prompt: string) =>
  [
    '---',
    'engine:',
    '  exercise:',
    `    type: ${type}`,
    ...spec,
    '---',
    prompt,
    '',
  ].join('\n');

const HOSTILE_COURSE = course(
  'hostile_ui_kb',
  HOSTILE_UI,
  exerciseFront('acme.hostile-ui', [], 'Probe the frame.'),
);
const ECHO_COURSE = course(
  'echo_kb',
  ECHO,
  exerciseFront(
    'acme.echo',
    ['    spec:', '      expected: "42"'],
    'What is the answer to everything?',
  ),
);
const markdownCourse = (language: string) =>
  course(
    'frames_kb',
    MARKDOWN,
    ['Blocks', '', `\`\`\`${language}`, 'hello', '```', ''].join('\n'),
  );

let workspace: Workspace | null = null;
let app: SpirulaApp | null = null;

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

const startSession = async (client: Client, name: string) => {
  await client.openCourses();
  await client.focusCourse(name);
  await client.startSession();
};

const answerFrame = (client: Client): FrameLocator =>
  client.page.frameLocator(ANSWER_FRAME);

/** Состояния проб «враждебного» элемента: имя → `blocked`/`reachable`/`pending`. */
const readProbes = async (scope: Locator | FrameLocator) => {
  const lines = await scope
    .locator('acme-hostile-ui-answer [data-probe]')
    .allInnerTexts();
  return Object.fromEntries(
    lines.map((line) => {
      const at = line.lastIndexOf(': ');
      return [line.slice(0, at), line.slice(at + 2)];
    }),
  );
};

const submitVerdict = (client: Client, text: string) =>
  client.page.getByText(text, { exact: true });

describe('изоляция интерфейса расширений', () => {
  it('элемент пользовательского расширения живёт в iframe sandbox="allow-scripts" и не выбирается наружу', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.hostile-ui': fixture('hostile-ui-extension') },
      libraryFiles: HOSTILE_COURSE,
    });
    const client = await launch(workspace.userData);
    await startSession(client, HOSTILE_UI);

    const frame = client.page.locator(ANSWER_FRAME);
    await frame.waitFor({ state: 'attached' });
    expect(await client.page.locator('iframe').count()).toBe(1);
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(await frame.getAttribute('src')).toBe(
      'spirula-ext://acme.hostile-ui/__spirula/frame.html',
    );
    expect(await frame.getAttribute('title')).toContain('Ответ');
    // элемента нет в окне приложения: только внутри рамки
    expect(await client.page.locator('acme-hostile-ui-answer').count()).toBe(0);

    const scope = answerFrame(client);
    await expect
      .poll(async () => Object.values(await readProbes(scope)), {
        timeout: 30_000,
      })
      .toEqual(PROBES.map(() => 'blocked'));
    expect(Object.keys(await readProbes(scope))).toEqual(PROBES);

    // рамка растёт по высоте содержимого (блок 400 px + поле + строки проб)
    await expect
      .poll(async () => (await frame.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(400);
    expect((await frame.boundingBox())?.height ?? 0).toBeLessThan(700);

    // у приложения окно по-прежнему с window.spirula, у рамки его нет
    expect(
      await client.page.evaluate(
        () => typeof (window as unknown as { spirula?: unknown }).spirula,
      ),
    ).toBe('object');
  });

  it('ввод в рамке: неверный ответ — «Пока неверно», верный — «Верно»; Ctrl+Enter в рамке отправляет', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.echo': fixture('echo-extension') },
      libraryFiles: ECHO_COURSE,
    });
    const client = await launch(workspace.userData);
    await startSession(client, ECHO);
    await client.page.locator(ANSWER_FRAME).waitFor({ state: 'attached' });
    expect(await client.page.locator('acme-echo-answer').count()).toBe(0);

    // отправка клавишами внутри рамки: кнопку не нажимаем
    const input = answerFrame(client).locator('acme-echo-answer input');
    await input.fill('41');
    await input.press('Control+Enter');
    await submitVerdict(client, 'Пока неверно').waitFor({ timeout: 15_000 });
    expect(readJournal(workspace.userData)).toHaveLength(0);

    const summary = await client.runSession(() => ({ text: '42' }));
    expect(summary.count).toBe(1);
    expect(readJournal(workspace.userData)[0]).toMatchObject({
      unit_id: 'echo_kb::basic::q1',
      source: 'runner',
    });
  });

  it('фокус: Tab переходит в рамку и обратно', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.echo': fixture('echo-extension') },
      libraryFiles: ECHO_COURSE,
    });
    const client = await launch(workspace.userData);
    await startSession(client, ECHO);
    const input = answerFrame(client).locator('acme-echo-answer input');
    await input.waitFor();
    const frame = client.page.locator(ANSWER_FRAME);
    const focused = () => input.evaluate((node) => node.matches(':focus'));
    await frame.focus();
    await client.page.keyboard.press('Tab');
    await expect.poll(focused).toBe(true);
    await client.page.keyboard.press('Shift+Tab');
    await expect.poll(focused).toBe(false);
  });

  it('тема приложения доходит до рамки и следует за сменой темы', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.echo': fixture('echo-extension') },
      libraryFiles: ECHO_COURSE,
    });
    const client = await launch(workspace.userData);
    await startSession(client, ECHO);
    const frameBody = answerFrame(client).locator('body');
    await frameBody.waitFor();

    const appColor = () =>
      client.page.evaluate(() => {
        const root = document.querySelector('.v-application') as HTMLElement;
        const [r, g, b] = getComputedStyle(root)
          .getPropertyValue('--v-theme-on-surface')
          .trim()
          .split(',');
        return `rgb(${r}, ${g?.trim()}, ${b?.trim()})`;
      });
    const frameColor = () =>
      frameBody.evaluate((node) => getComputedStyle(node).color);
    const setTheme = (name: 'light' | 'dark') =>
      client.page.evaluate((next) => {
        const root = document.querySelector('.v-application') as HTMLElement;
        root.className = root.className.replace(
          /v-theme--\S+/,
          `v-theme--${next}`,
        );
      }, name);

    await setTheme('dark');
    await expect.poll(appColor).not.toBe('');
    const dark = await appColor();
    await expect.poll(frameColor).toBe(dark);
    await setTheme('light');
    const light = await appColor();
    expect(light).not.toBe(dark);
    await expect.poll(frameColor).toBe(light);
  });

  it('рендерер Markdown пользовательского расширения выводит блок в рамке', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.good-markdown': fixture('good-markdown-extension') },
      libraryFiles: markdownCourse('good'),
    });
    const client = await launch(workspace.userData);
    await startSession(client, MARKDOWN);

    const block = client.page.locator('.spirula-md-block[data-language=good]');
    await expect
      .poll(() => block.getAttribute('data-state'), { timeout: 15_000 })
      .toBe('done');
    const frame = block.locator(MARKDOWN_FRAME);
    await client.page
      .frameLocator(MARKDOWN_FRAME)
      .getByText('good block: hello', { exact: true })
      .waitFor({ state: 'visible' });
    expect((await frame.boundingBox())?.height ?? 0).toBeGreaterThan(0);
    const summary = await client.runSession(() => 3);
    expect(summary.count).toBe(1);
  });

  it('сбой рендерера в рамке оставляет исходник и заметку, страница работает', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.bad-markdown': fixture('bad-markdown-extension') },
      libraryFiles: markdownCourse('boom'),
    });
    const client = await launch(workspace.userData);
    await startSession(client, MARKDOWN);

    const block = client.page.locator('.spirula-md-block[data-language=boom]');
    await block.locator('.spirula-md-error').waitFor({ state: 'visible' });
    expect(await block.getAttribute('data-state')).toBe('error');
    expect(await block.locator('pre code').textContent()).toContain('hello');
    expect(await block.locator('iframe').count()).toBe(0);
    const summary = await client.runSession(() => 3);
    expect(summary.count).toBe(1);
  });

  it('после «Доверять» элемент рисуется в окне без iframe', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.hostile-ui': fixture('hostile-ui-extension') },
      libraryFiles: HOSTILE_COURSE,
    });
    const client = await launch(workspace.userData);
    await client.openSettingsExtensions();
    await client.setExtensionSwitch('acme.hostile-ui', 'trusted', true);
    await client.reloadFromExtensions();
    await client.openCourses();
    await startSession(client, HOSTILE_UI);

    const element = client.page.locator('acme-hostile-ui-answer');
    await element.waitFor({ state: 'attached' });
    expect(await client.page.locator('iframe').count()).toBe(0);
    await expect
      .poll(() => readProbes(client.page.locator('body')), { timeout: 30_000 })
      .toMatchObject({ 'parent.spirula': 'reachable', fetch: 'blocked' });

    await element.locator('input').fill('x');
    await client.page
      .getByRole('button', { name: 'Проверить', exact: true })
      .click();
    await submitVerdict(client, 'Верно').waitFor({ timeout: 15_000 });
    expect(readJournal(workspace.userData)[0]).toMatchObject({
      unit_id: 'hostile_ui_kb::basic::q1',
      source: 'runner',
    });
  });
});
