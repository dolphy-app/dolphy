import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { readJournal } from './support/journal.ts';

const ECHO = 'Echo (KnowledgeBase)';
const ECHO_EXTENSION = fileURLToPath(
  new URL('./fixtures/echo-extension', import.meta.url),
);

const ECHO_LIBRARY = {
  'echo_kb/course_manifest.json': JSON.stringify({
    dependencies: [],
    description: 'Echo course',
    engine: { tags: ['echo'] },
    generator_config: { KnowledgeBase: {} },
    id: 'echo_kb',
    name: ECHO,
  }),
  'echo_kb/basic.lesson/lesson.name.json': JSON.stringify('Echo basics'),
  'echo_kb/basic.lesson/q1.front.md': [
    '---',
    'engine:',
    '  exercise:',
    '    type: acme.echo',
    '    spec:',
    '      expected: "42"',
    '---',
    'What is the answer to everything?',
    '',
  ].join('\n'),
};

/** Расширение, которое засчитывает любой ответ. */
const ALWAYS_PASSES = `export default {
  activate(ctx) {
    ctx.registerExerciseType('acme.echo', {
      project: () => ({}),
      grade: () => ({ outcome: 'passed' }),
      referenceAnswer: ({ spec }) => spec.expected,
    });
  },
};
`;

let workspace: Workspace;
let devRoot: string;
let app: DolphyApp | null = null;

beforeEach(async () => {
  workspace = await createWorkspace({ libraryFiles: ECHO_LIBRARY });
  devRoot = await mkdtemp(join(tmpdir(), 'dolphy-e2e-dev-ext-'));
  await cp(ECHO_EXTENSION, join(devRoot, 'acme.echo'), { recursive: true });
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  await rm(devRoot, { recursive: true, force: true });
});

const PASSED = 'Верно';

/** Нажимает «Проверить», пока правка не вступит в силу: проходит первая же проверка после неё. */
const checkUntilPassed = async (client: Client) => {
  const check = client.page.getByRole('button', {
    name: 'Проверить',
    exact: true,
  });
  await expect
    .poll(
      async () => {
        if (await client.page.getByText(PASSED, { exact: true }).isVisible()) {
          return true;
        }
        if (await check.isEnabled()) await check.click();
        return client.page.getByText(PASSED, { exact: true }).isVisible();
      },
      { timeout: 30_000, interval: 500 },
    )
    .toBe(true);
};

describe('режим разработчика (DOLPHY_DEV_EXTENSIONS)', () => {
  it('правка main.mjs в каталоге разработчика меняет вердикт, окно не перезагружается', async () => {
    app = await launchApp(workspace.userData, {
      DOLPHY_DEV_EXTENSIONS: devRoot,
    });
    const client = new Client(app.page);
    await client.openCourses();
    await client.focusCourse(ECHO);
    expect(await client.planTotal()).toBe(1);
    await client.startSession();
    await client.submitWrong({ text: '41' });
    expect(readJournal(workspace.userData)).toHaveLength(0);

    const stillSameWindow = await client.markWindow();
    await writeFile(join(devRoot, 'acme.echo', 'main.mjs'), ALWAYS_PASSES);
    await checkUntilPassed(client);
    await stillSameWindow();

    // сессия осталась открытой: она завершается обычным путём
    await client.page
      .getByRole('button', { name: /^(Далее|Завершить)$/ })
      .click();
    await client.page
      .getByText('Сессия завершена', { exact: true })
      .waitFor({ timeout: 15_000 });
    expect(readJournal(workspace.userData)).toMatchObject([
      { unit_id: 'echo_kb::basic::q1', source: 'runner' },
    ]);
    await stillSameWindow();
  });

  it('правка вида ответа пересоздаёт смонтированный компонент расширения dev', async () => {
    app = await launchApp(workspace.userData, {
      DOLPHY_DEV_EXTENSIONS: devRoot,
    });
    const { page } = app;
    const client = new Client(page);
    await client.openCourses();
    await client.focusCourse(ECHO);
    await client.startSession();
    const answer = page.getByTestId('acme-echo-answer');
    await answer.waitFor();
    await answer.evaluate((node) => Reflect.set(node, '__old', true));
    const stillSameWindow = await client.markWindow();

    const view = await readFile(join(devRoot, 'acme.echo', 'view.mjs'), 'utf8');
    await writeFile(
      join(devRoot, 'acme.echo', 'view.mjs'),
      view.replace(
        "{ 'data-testid': 'acme-echo-answer'",
        "{ 'data-edited': 'yes', 'data-testid': 'acme-echo-answer'",
      ),
    );
    // компонент пересоздан: старый узел заменён, новый уже правленый
    await page
      .locator('[data-testid="acme-echo-answer"][data-edited=yes]')
      .waitFor({ timeout: 30_000 });
    expect(
      await page
        .getByTestId('acme-echo-answer')
        .evaluate((node) => Reflect.get(node, '__old')),
    ).toBeUndefined();
    await stillSameWindow();
  });

  it('сбой одного расширения в каталоге разработчика не мешает остальным, причина видна в настройках', async () => {
    app = await launchApp(workspace.userData, {
      DOLPHY_DEV_EXTENSIONS: devRoot,
    });
    const client = new Client(app.page);
    await client.openSettingsExtensions();
    const stillSameWindow = await client.markWindow();

    const broken = join(devRoot, 'acme.broken');
    await mkdir(broken);
    await writeFile(
      join(broken, 'extension.json'),
      JSON.stringify({ id: 'acme.broken' }),
    );
    // список обновляется сам: правка сообщает только о вкладах
    await expect
      .poll(async () => (await client.readExtensions('acme.broken'))[0], {
        timeout: 30_000,
      })
      .toContain('Не загрузилось');
    const [echo] = await client.readExtensions('acme.echo');
    expect(echo).toContain('Загружено');
    expect(echo).toContain('Разработка');

    await client.openCourses();
    await client.focusCourse(ECHO);
    await client.startSession();
    await client.submitWrong({ text: '41' });
    await stillSameWindow();
  });
});
