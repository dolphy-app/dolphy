import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { LmsApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';
import {
  readJournal,
  readSetting,
  shiftJournalBack,
} from './support/journal.ts';
import { sqlReferenceSolutions } from './support/library.ts';

const GIT = 'Git: основы';
const SQL = 'SQL (KnowledgeBase)';
const GIT_EXERCISES = ['commits', 'branches', 'history'].flatMap((lesson) =>
  ['q1', 'q2', 'q3'].map((q) => `git_kb::${lesson}::${q}`),
);

let workspace: Workspace;
let app: LmsApp | null = null;
let client: Client;

const start = async () => {
  app = await launchApp(workspace.userData);
  client = new Client(app.page);
  return client;
};

const stop = async () => {
  await app?.close();
  app = null;
};

/** Проходит дни: закрыть приложение, сдвинуть журнал в прошлое, открыть снова. */
const passDays = async (days: number) => {
  await stop();
  shiftJournalBack(workspace.userData, days);
  await start();
  await client.openPlan();
};

type Grade = 1 | 2 | 3 | 4 | 5;

/** Одна сессия по всему плану на экране; возвращает число упражнений. */
const studySession = async (grade: Grade) => {
  const planned = await client.planTotal();
  await client.startSession();
  const summary = await client.runSession(() => grade);
  expect(summary.count, 'сессия проходит весь план').toBe(planned);
  expect(summary.averageGrade).toBe(grade);
  await client.backToPlan();
  return summary.count;
};

/** Сессии, пока план на сегодня не опустеет (но не больше пяти). */
const studyToday = async (grade: Grade) => {
  const counts: number[] = [];
  for (let round = 0; round < 5 && !(await client.planIsEmpty()); round++) {
    counts.push(await studySession(grade));
  }
  return counts;
};

beforeEach(async () => {
  workspace = await createWorkspace();
});

afterEach(async () => {
  await stop();
  await workspace?.dispose();
});

describe('каталог курсов', () => {
  it('показывает библиотеку: все курсы не начаты, у каждого 0 из N', async () => {
    await start();
    await client.openCourses();
    expect(await client.courseNames()).toEqual(
      expect.arrayContaining([GIT, 'HTTP', 'JavaScript: основы', SQL]),
    );
    const git = await client.readCard(GIT);
    expect(git).toMatchObject({
      lessonCount: 3,
      lessonsDone: 0,
      percent: 0,
      attempts: 0,
      state: 'Не начат',
      focused: false,
    });
  });

  it('«Учить» ставит курс в фокус: карточка, план и настройки в БД согласованы', async () => {
    await start();
    await client.openCourses();
    await client.focusCourse(GIT);
    expect(await client.planTotal()).toBe(3);
    await client.openCourses();
    expect((await client.readCard(GIT)).focused).toBe(true);
    expect((await client.readCard('HTTP')).focused).toBe(false);
    expect(readSetting(workspace.userData, 'ui')).toMatchObject({
      activeCourseId: 'git_kb',
    });
  });
});

describe('прохождение курса Git через клиент', () => {
  it('курс доходит до «Пройден» 3 из 3, журнал в БД совпадает с тем, что нажато', async () => {
    await start();
    await client.openCourses();
    await client.focusCourse(GIT);

    const sessions: number[] = [];
    let previous = { attempts: 0, lessonsDone: 0 };
    let completed = false;
    for (let day = 1; day <= 6 && !completed; day++) {
      sessions.push(...(await studyToday(5)));
      await client.openCourses();
      const card = await client.readCard(GIT);
      expect(card.attempts, 'попытки не убывают').toBeGreaterThanOrEqual(
        previous.attempts,
      );
      expect(
        card.lessonsDone,
        'пройденные уроки не убывают',
      ).toBeGreaterThanOrEqual(previous.lessonsDone);
      expect(card.attempts).toBe(sessions.reduce((sum, n) => sum + n, 0));
      previous = card;
      completed = card.state === 'Пройден';
      if (!completed) await passDays(7);
    }

    const card = await client.readCard(GIT);
    expect(card).toMatchObject({
      state: 'Пройден',
      lessonsDone: 3,
      lessonCount: 3,
      percent: 100,
    });

    const journal = readJournal(workspace.userData);
    expect(journal).toHaveLength(card.attempts);
    expect(journal.map(({ seq }) => seq)).toEqual(
      journal.map((_, index) => index + 1),
    );
    expect(new Set(journal.map(({ id }) => id)).size).toBe(journal.length);
    for (const row of journal) {
      expect(row).toMatchObject({ kind: 'attempt', grade: 5, source: 'self' });
    }
    expect(new Set(journal.map((row) => row.unit_id))).toEqual(
      new Set(GIT_EXERCISES),
    );

    await passDays(0);
    await client.openCourses();
    expect(await client.readCard(GIT), 'после перезапуска то же').toEqual(card);
  });

  it('непройденный урок остаётся в плане сразу, следующий открывается после повтора', async () => {
    await start();
    await client.openCourses();
    await client.focusCourse(GIT);
    await studySession(5);
    await client.openCourses();
    const first = await client.readCard(GIT);
    expect(first.attempts).toBe(3);
    expect(first.lessonsDone).toBeLessThan(3);

    await client.openPlan();
    expect(await client.planIsEmpty(), 'план не пуст до повтора').toBe(false);
    expect(await client.planTotal()).toBe(3);

    await studySession(5);
    await client.openPlan();
    expect(await client.planTotal(), 'открылся следующий урок').toBe(3);
    await client.openCourses();
    const second = await client.readCard(GIT);
    expect(second.attempts).toBe(6);
    expect(second.lessonsDone).toBeGreaterThan(0);
  });

  it('оценки «1» оседают в БД, а упражнения сразу остаются в плане', async () => {
    await start();
    await client.openCourses();
    await client.focusCourse(GIT);
    await studySession(1);
    await client.openCourses();
    expect(await client.readCard(GIT)).toMatchObject({
      attempts: 3,
      lessonsDone: 0,
      state: 'В процессе',
    });
    expect(readJournal(workspace.userData).map(({ grade }) => grade)).toEqual([
      1, 1, 1,
    ]);

    await client.openPlan();
    expect(await client.planTotal(), 'провал не оставляет план пустым').toBe(3);
    expect(await client.planIsEmpty()).toBe(false);
  });
});

describe('SQL-курс: проверка ответа раннером', () => {
  it('неверный запрос не записывается, верный — записывается с source=runner', async () => {
    const solutions = sqlReferenceSolutions('ddl.lesson');
    await start();
    await client.openCourses();
    await client.focusCourse(SQL);
    expect(await client.planTotal()).toBe(3);
    await client.startSession();

    await client.submitWrongSql('SELECT 1');
    expect(
      readJournal(workspace.userData),
      'неверный ответ не в журнале',
    ).toHaveLength(0);

    const summary = await client.runSession(({ prompt, verifiable }) => {
      expect(verifiable).toBe(true);
      const sql = solutions.get(prompt);
      if (sql === undefined) throw new Error(`no reference for «${prompt}»`);
      return { sql };
    });

    expect(summary.count).toBe(3);
    const journal = readJournal(workspace.userData);
    expect(journal).toHaveLength(3);
    for (const row of journal) {
      expect(row.source).toBe('runner');
      expect(row.grade).toBeGreaterThan(1);
      expect(row.unit_id).toMatch(/^sql_kb::ddl::q[123]$/);
    }
  });

  it('«Сдаться» засчитывает попытку как «не решено» (оценка 1)', async () => {
    await start();
    await client.openCourses();
    await client.focusCourse(SQL);
    await client.startSession();
    await client.giveUp();
    await expect.poll(() => readJournal(workspace.userData).length).toBe(1);
    expect(readJournal(workspace.userData)[0]).toMatchObject({
      grade: 1,
      source: 'runner',
    });
  });
});
