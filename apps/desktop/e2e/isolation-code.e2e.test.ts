import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { SpirulaApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import { readJournal } from './support/journal.ts';

const HOSTILE = 'Hostile (KnowledgeBase)';
const PERMITTED = 'Permitted (KnowledgeBase)';
const CHOICE = 'Choice (KnowledgeBase)';
/** Заведомо неверные ответы на упражнения курса choice по первой строке формулировки. */
const CHOICE_WRONG: Record<string, string[]> = {
  'Which statement reads data from a table?': ['GROUP'],
  'Which of these are SQL join types? Select all that apply.': ['FORWARD'],
  'Pick the second option.': ['a'],
};
const HOSTILE_EXTENSION = fileURLToPath(
  new URL('./fixtures/hostile-extension', import.meta.url),
);
const PERMITTED_EXTENSION = fileURLToPath(
  new URL('./fixtures/permitted-extension', import.meta.url),
);

/** Курс из одного упражнения вида `type`; расширение отвечает отчётом о том, что ему удалось. */
const probeCourse = (kind: 'hostile' | 'permitted', name: string) => ({
  [`${kind}_kb/course_manifest.json`]: JSON.stringify({
    dependencies: [],
    description: name,
    engine: { tags: [kind] },
    generator_config: { KnowledgeBase: {} },
    id: `${kind}_kb`,
    name,
  }),
  [`${kind}_kb/basic.lesson/lesson.name.json`]: JSON.stringify('Probe'),
  [`${kind}_kb/basic.lesson/q1.front.md`]: [
    '---',
    'engine:',
    '  exercise:',
    `    type: acme.${kind}`,
    '    spec:',
    `      libraryPath: ${kind}_kb/course_manifest.json`,
    '---',
    'Probe the sandbox.',
    '',
  ].join('\n'),
});

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

type Report = Record<string, string>;

/** Вводит ответ в элемент расширения, проверяет и читает отчёт из текста вердикта. */
const probe = async (
  client: Client,
  kind: 'hostile' | 'permitted',
  marker: string,
): Promise<Report> => {
  const element = await client.answerElement(`acme-${kind}-answer`);
  await element.locator('input').fill(marker);
  await client.page
    .getByRole('button', { name: 'Проверить', exact: true })
    .click();
  const alert = client.page.getByRole('alert');
  await expect
    .poll(async () => (await alert.allInnerTexts()).join('\n'), {
      timeout: 30_000,
    })
    .toContain('[');
  const text = (await alert.allInnerTexts()).join('\n');
  const lines = JSON.parse(text.slice(text.indexOf('['))) as string[];
  return Object.fromEntries(
    lines.map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );
};

const leaveSession = async (client: Client) => {
  await client.page
    .getByRole('button', { name: 'Выйти из сессии', exact: true })
    .click();
};

/** Курс ставится в фокус один раз, дальше сессию можно начинать прямо с плана. */
const startProbe = async (client: Client, course: string, focus = true) => {
  if (focus) {
    await client.openCourses();
    await client.focusCourse(course);
  } else {
    await client.openPlan();
  }
  await client.startSession();
};

describe('изоляция кода расширений', () => {
  it('враждебное расширение без разрешений: чтение, запись, процессы и потоки запрещены, приложение живо', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.hostile': HOSTILE_EXTENSION },
      libraryFiles: probeCourse('hostile', HOSTILE),
    });
    const marker = join(workspace.userData, 'pwned.txt');
    const client = await launch(workspace.userData);
    await startProbe(client, HOSTILE);

    const report = await probe(client, 'hostile', marker);
    expect(report).toEqual({
      'read:/etc/hosts': 'denied',
      write: 'denied',
      spawn: 'denied',
      worker: 'denied',
      'env:HOME': 'unset',
      library: 'denied',
    });
    expect(existsSync(marker)).toBe(false);
    expect(readJournal(workspace.userData)).toHaveLength(0);

    // движок и расширения из поставки продолжают работать
    await leaveSession(client);
    await client.openCourses();
    await client.focusCourse(CHOICE);
    await client.startSession();
    const first = await client.currentExercise();
    expect(first.verifiable).toBe(true);
    await client.submitWrong({ choose: CHOICE_WRONG[first.prompt] ?? [] });
  });

  it('расширение с объявленными process.spawn и library.read: запуск процесса и чтение библиотеки через посредника, остальное закрыто', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.permitted': PERMITTED_EXTENSION },
      libraryFiles: probeCourse('permitted', PERMITTED),
    });
    const marker = join(workspace.userData, 'pwned.txt');
    const client = await launch(workspace.userData);
    await startProbe(client, PERMITTED);

    const report = await probe(client, 'permitted', marker);
    expect(report).toMatchObject({
      'read:/etc/hosts': 'denied',
      write: 'denied',
      spawn: 'allowed',
      worker: 'denied',
      'env:HOME': 'unset',
    });
    expect(report.library).toMatch(/^allowed:[1-9]\d*$/);
    expect(existsSync(marker)).toBe(false);
  });

  it('«Доверять» в настройках снимает ограничения сразу, без перезапуска приложения', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.hostile': HOSTILE_EXTENSION },
      libraryFiles: probeCourse('hostile', HOSTILE),
    });
    const marker = join(workspace.userData, 'pwned.txt');
    const client = await launch(workspace.userData);
    await startProbe(client, HOSTILE);
    expect((await probe(client, 'hostile', marker)).write).toBe('denied');
    expect(existsSync(marker)).toBe(false);

    await leaveSession(client);
    await client.openSettingsExtensions();
    await client.setExtensionSwitch('acme.hostile', 'trusted', true);
    await client.reloadFromExtensions();

    await startProbe(client, HOSTILE, false);
    const trusted = await probe(client, 'hostile', marker);
    expect(trusted).toMatchObject({
      'read:/etc/hosts': 'allowed',
      write: 'allowed',
      spawn: 'allowed',
      worker: 'allowed',
    });
    expect(trusted.library).toMatch(/^allowed:/);
    expect(existsSync(marker)).toBe(true);

    await leaveSession(client);
    await client.openSettingsExtensions();
    await client.setExtensionSwitch('acme.hostile', 'trusted', false);
    await client.reloadFromExtensions();
    await startProbe(client, HOSTILE, false);
    expect((await probe(client, 'hostile', marker)).write).toBe('denied');
  });
});
