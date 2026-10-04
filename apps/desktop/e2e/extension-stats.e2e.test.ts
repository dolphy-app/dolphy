import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { CatalogClient } from './support/catalog-client.ts';
import { catalogEnv, startCatalogServer } from './support/catalog-server.ts';
import type { CatalogServer } from './support/catalog-server.ts';
import { Client } from './support/client.ts';
import type { Grade } from './support/client.ts';
import { CommandsClient } from './support/commands-client.ts';
import { course } from './support/courses.ts';
import { readExtensionData, shiftJournalBack } from './support/journal.ts';
import { expectText } from './support/locator.ts';

const STATS_EXTENSION = fileURLToPath(
  new URL('./fixtures/stats-extension', import.meta.url),
);
const DENIED_EXTENSION = fileURLToPath(
  new URL('./fixtures/stats-denied-extension', import.meta.url),
);
const STATS_ID = 'acme.stats';
const DENIED_ID = 'acme.nostats';
const REPORT = 'Статистика: записать';
const DENIED_REPORT = 'Статистика без разрешения: записать';
const PERMISSION_LABEL = 'Статистика обучения';

const COURSES = {
  alpha: 'Alpha (KnowledgeBase)',
  beta: 'Beta (KnowledgeBase)',
  gamma: 'Gamma (KnowledgeBase)',
  delta: 'Delta (KnowledgeBase)',
} as const;
const LIBRARY = Object.assign(
  {},
  ...Object.entries(COURSES).map(([id, name]) =>
    course(`${id}_kb`, name, `${name} question\n`),
  ),
) as Record<string, string>;

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;
let server: CatalogServer | null = null;

interface Session {
  client: Client;
  commands: CommandsClient;
  catalog: CatalogClient;
}

const launch = async (env?: Record<string, string>): Promise<Session> => {
  await app?.close();
  app = await launchApp(workspace!.userData, env);
  await app.page
    .getByRole('link', { name: /^(План на сегодня|Today's plan)$/ })
    .waitFor({ timeout: 30_000 });
  return {
    client: new Client(app.page),
    commands: new CommandsClient(app.page),
    catalog: new CatalogClient(app.page),
  };
};

/** Одна сессия по курсу: самооценка `grade` для его единственного упражнения. */
const study = async ({ client }: Session, name: string, grade: Grade) => {
  await client.openCourses();
  await client.focusCourse(name);
  await client.startSession();
  const summary = await client.runSession(() => grade);
  expect(summary.count).toBe(1);
  await client.backToPlan();
};

/** Проходят дни: закрыть приложение, сдвинуть журнал в прошлое, открыть снова. */
const passDays = async (days: number): Promise<Session> => {
  await app?.close();
  app = null;
  shiftJournalBack(workspace!.userData, days);
  return launch();
};

const runCommand = async ({ commands }: Session, title: string) => {
  await commands.openPalette();
  await commands.search(title);
  await expect.poll(() => commands.optionTitles()).toContain(title);
  await commands.option(title).first().click();
  await commands.palette.waitFor({ state: 'hidden' });
};

const pad = (value: number) => String(value).padStart(2, '0');

/** Местная дата `YYYY-MM-DD` со сдвигом в днях от сегодня (тот же пояс, что у движка). */
const localDate = (offset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface Day {
  date: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
}

const report = (id: string) =>
  readExtensionData(workspace!.userData, id).storage.report as Record<
    string,
    unknown
  >;

afterEach(async () => {
  await app?.close();
  app = null;
  await server?.close();
  server = null;
  await workspace?.dispose();
  workspace = null;
});

describe('learning.stats', () => {
  it('команда расширения с разрешением получает серию и дни по журналу; без разрешения — PermissionError, в изолированном процессе тоже', async () => {
    workspace = await createWorkspace({
      extensions: {
        [STATS_ID]: STATS_EXTENSION,
        [DENIED_ID]: DENIED_EXTENSION,
      },
      libraryFiles: LIBRARY,
    });
    let session = await launch();

    // три дня назад: одна неверная попытка по alpha и одна верная по beta
    await study(session, COURSES.alpha, 1);
    await study(session, COURSES.beta, 4);
    session = await passDays(2);
    // вчера, позавчера пустое: серия рвётся
    await study(session, COURSES.gamma, 5);
    session = await passDays(1);
    // сегодня
    await study(session, COURSES.delta, 3);

    await runCommand(session, REPORT);
    await expect
      .poll(() => report(STATS_ID)?.daily, { timeout: 15_000 })
      .toBeDefined();
    const got = report(STATS_ID) as {
      from: string;
      to: string;
      streak: unknown;
      daily: Day[];
      alpha: { streak: unknown; daily: Day[] };
      unknown: unknown;
      invalid: unknown;
    };
    expect(got.from).toBe(localDate(-3));
    expect(got.to).toBe(localDate(0));
    expect(got.streak).toEqual({ current: 2, longest: 2 });
    expect(got.daily).toEqual([
      { date: localDate(-3), attempts: 2, correct: 1, accuracy: 0.5 },
      { date: localDate(-2), attempts: 0, correct: 0, accuracy: null },
      { date: localDate(-1), attempts: 1, correct: 1, accuracy: 1 },
      { date: localDate(0), attempts: 1, correct: 1, accuracy: 1 },
    ]);
    expect(got.alpha.streak).toEqual({ current: 0, longest: 1 });
    expect(got.alpha.daily).toEqual([
      { date: localDate(-3), attempts: 1, correct: 0, accuracy: 0 },
      { date: localDate(-2), attempts: 0, correct: 0, accuracy: null },
      { date: localDate(-1), attempts: 0, correct: 0, accuracy: null },
      { date: localDate(0), attempts: 0, correct: 0, accuracy: null },
    ]);
    expect(got.unknown).toEqual({ current: 0, longest: 0 });
    expect(got.invalid).toMatchObject({ code: 'INVALID_ARGUMENT' });
    // приватность: ни идентификаторов курсов и упражнений, ни названий
    expect(
      JSON.stringify([got.streak, got.daily, got.alpha.daily]),
    ).not.toMatch(/alpha|beta|gamma|delta|::/);

    await runCommand(session, DENIED_REPORT);
    await expect
      .poll(() => report(DENIED_ID)?.daily, { timeout: 15_000 })
      .toBeDefined();
    const denied = {
      name: 'PermissionError',
      code: 'EXT_PERMISSION',
      permission: 'learning.stats',
    };
    expect(report(DENIED_ID)).toEqual({
      streak: { error: denied },
      daily: { error: denied },
    });
  });

  it('диалог установки и список установленных показывают метку разрешения', async () => {
    workspace = await createWorkspace();
    server = await startCatalogServer([
      {
        dir: STATS_EXTENSION,
        name: 'Habit tracker',
        description: 'Записывает серию дней и разбивку по дням',
        author: 'acme',
      },
    ]);
    const { client, catalog } = await launch(catalogEnv(server.url));

    await client.openSettingsExtensions();
    await catalog.openCatalogTab();
    await expectText(catalog.catalogCard(STATS_ID), PERMISSION_LABEL);
    await catalog.installButton(STATS_ID).click();
    await expectText(catalog.dialog, PERMISSION_LABEL);
    await catalog.confirmInstall();
    await expectText(catalog.dialog, 'Установлено. Расширение уже работает.');
    await catalog.closeDialog();

    await catalog.openInstalledTab();
    expect(await catalog.installedText(STATS_ID)).toContain(PERMISSION_LABEL);
  });
});
