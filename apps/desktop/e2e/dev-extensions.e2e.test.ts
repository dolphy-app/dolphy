import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { LmsApp, Workspace } from './support/app.ts';
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
let app: LmsApp | null = null;

beforeEach(async () => {
  workspace = await createWorkspace({ libraryFiles: ECHO_LIBRARY });
  devRoot = await mkdtemp(join(tmpdir(), 'lms-e2e-dev-ext-'));
  await cp(ECHO_EXTENSION, join(devRoot, 'acme.echo'), { recursive: true });
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  await rm(devRoot, { recursive: true, force: true });
});

describe('режим разработчика (LMS_DEV_EXTENSIONS)', () => {
  it('правка main.mjs в каталоге разработчика меняет вердикт без перезапуска приложения', async () => {
    app = await launchApp(workspace.userData, {
      LMS_DEV_EXTENSIONS: devRoot,
    });
    const { page } = app;
    const client = new Client(page);
    await client.openCourses();
    await client.focusCourse(ECHO);
    expect(await client.planTotal()).toBe(1);
    await client.startSession();
    await client.submitWrong({ text: '41' });
    expect(readJournal(workspace.userData)).toHaveLength(0);

    // маркер исчезнет только с перезагрузкой страницы
    await page.evaluate(() => Reflect.set(globalThis, 'devMarker', true));
    const reloaded = page.waitForEvent('load', { timeout: 30_000 });
    await writeFile(join(devRoot, 'acme.echo', 'main.mjs'), ALWAYS_PASSES);
    await reloaded;
    await expect
      .poll(() => page.evaluate(() => Reflect.get(globalThis, 'devMarker')), {
        timeout: 15_000,
      })
      .toBeUndefined();

    // маршрут сессии переживает перезагрузку: то же упражнение появляется заново
    expect((await client.currentExercise()).verifiable).toBe(true);
    const summary = await client.runSession(() => ({ text: '41' }));
    expect(summary.count).toBe(1);
    expect(readJournal(workspace.userData)).toMatchObject([
      { unit_id: 'echo_kb::basic::q1', source: 'runner' },
    ]);
  });
});
