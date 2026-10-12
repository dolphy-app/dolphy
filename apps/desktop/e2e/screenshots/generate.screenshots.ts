import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { openSqliteStorage } from '@dolphy-app/engine-sqlite';
import { createWorkspace, launchApp } from '../support/app.ts';
import type { DolphyApp, Workspace } from '../support/app.ts';
import { Client } from '../support/client.ts';
import type { Grade } from '../support/client.ts';
import { shiftJournalBack } from '../support/journal.ts';

// Генератор скриншотов для README (`pnpm screenshots`): настоящее приложение,
// английский интерфейс, детерминированный журнал, светлая и тёмная темы. Весь
// контент берётся из английской демо-библиотеки `./library` (только для этих
// скриншотов): курс SQL проверяется раннером, остальные — карточки вопрос/ответ.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const OUTPUT = join(REPO_ROOT, '.github/assets/screenshots');
/** Английская демо-библиотека: единственный источник курсов для скриншотов. */
const LIBRARY = join(HERE, 'library');

const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = Number(process.env.DOLPHY_SCREENSHOT_SCALE ?? 2);
/** Предел размера PNG, байт. */
const MAX_BYTES = 1_500_000;
/** Фиксированное «сегодня» окна: подпись даты на плане не меняется между запусками. */
const FROZEN_NOW = new Date('2026-03-12T09:30:00');
/** После `close()` процесс ещё отпускает замок единственного экземпляра. */
const PROCESS_EXIT_MS = 2000;

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/** Курс SQL (проверяется раннером): его граф и сессия попадают на скриншоты. */
const SQL_ID = 'sql_analytics';
const GIT_ID = 'git_practice';
const HTTP_ID = 'http_essentials';
const JS_ID = 'js_foundations';

// Граф SQL и сессия — широкие и невысокие: в окне 900px остаются большие пустые
// поля, поэтому их снимают в окне пониже, чтобы контент заполнял кадр.
const GRAPH_HEIGHT = 470;
const SESSION_HEIGHT = 760;
/**
 * Зерно плана: без него движок берёт случайное (криптографический ГСЧ), и состав
 * «Далее» и первое упражнение сессии плавают между запусками и темами. Окно
 * отправляет запросы в движок через `MessagePort`; init-скрипт дописывает
 * `seed` в `plan.getDay` (и план, и сессия идут через него). Код приложения не меняется.
 */
const PLAN_SEED = 20_260_312;
const seedPlanScript = (seed: number): string => `(() => {
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) {
    const request = message;
    if (
      request &&
      request.method === 'plan.getDay' &&
      Array.isArray(request.params)
    ) {
      const [scope = {}, ...tail] = request.params;
      if (scope.seed === undefined) {
        message = {
          ...request,
          params: [{ ...scope, seed: ${seed} }, ...tail],
        };
      }
    }
    return post.call(this, message, ...rest);
  };
})();`;

/** Время в шапке сессии: настоящее меняется от запуска к запуску. */
const FROZEN_TIMER_STYLE = `
  .top-bar .tabular { visibility: hidden; position: relative; }
  .top-bar .tabular::after {
    content: '04:17'; visibility: visible; position: absolute; right: 0;
  }
`;

/** Оценки самопроверки по кругу: ученик то вспоминает легко, то с трудом. */
const GRADES: Grade[] = [4, 3, 5, 4, 3, 5, 4, 4, 3, 5];

/**
 * Эталонные решения SQL-упражнений библиотеки: первая строка формулировки (как
 * её показывает интерфейс, без разметки) → текст решения. Путь к `reference`
 * задан во frontmatter и считается от корня библиотеки.
 */
const sqlSolutions = (): Map<string, string> => {
  const solutions = new Map<string, string>();
  const courseDir = join(LIBRARY, SQL_ID);
  for (const lesson of readdirSync(courseDir)) {
    if (!lesson.endsWith('.lesson')) continue;
    for (const file of readdirSync(join(courseDir, lesson))) {
      if (!file.endsWith('.front.md')) continue;
      const source = readFileSync(join(courseDir, lesson, file), 'utf8');
      const [, frontmatter = '', body = ''] = source.split(/^---$/m);
      const reference = frontmatter.match(/reference: (.+)/)?.[1]?.trim();
      if (!reference) continue;
      const prompt = body.trim().split('\n')[0]?.replaceAll(/[`*]/g, '') ?? '';
      solutions.set(prompt, readFileSync(join(LIBRARY, reference), 'utf8'));
    }
  }
  return solutions;
};

/** Раунд истории: сессия по курсу и сдвиг журнала в прошлое после неё. */
interface Round {
  /** Курс в фокусе плана. */
  course: string;
  /** Сколько суток журнал сдвигается в прошлое после раунда. */
  shiftAfterDays: number;
}

// Больше всего проходов у SQL: его лесенка зависимостей даёт на графе смесь
// «освоено / в процессе / можно учить / закрыто», остальные курсы — немного
// прогресса, чтобы карточки и план выглядели обжитыми.
const HISTORY: Round[] = [
  { course: SQL_ID, shiftAfterDays: 0 },
  { course: SQL_ID, shiftAfterDays: 3 },
  { course: GIT_ID, shiftAfterDays: 0 },
  { course: SQL_ID, shiftAfterDays: 2 },
  { course: HTTP_ID, shiftAfterDays: 2 },
  { course: SQL_ID, shiftAfterDays: 1 },
  { course: JS_ID, shiftAfterDays: 1 },
  { course: SQL_ID, shiftAfterDays: 0 },
  { course: GIT_ID, shiftAfterDays: 0 },
];

/** Подготавливает `engine.db`: интерфейс на английском, тема, курс в фокусе. */
const configure = (
  userData: string,
  locale: 'ru' | 'en',
  theme: Theme,
  activeCourseId?: string,
): void => {
  const storage = openSqliteStorage({
    path: join(userData, 'data', 'engine.db'),
  });
  storage.settings.saveUi({
    theme,
    locale,
    tours: { welcome: 'skipped' },
    ...(activeCourseId === undefined ? {} : { activeCourseId }),
  });
  storage.events.close();
};

/** Прошедшие дни: история ответов, записанная настоящими сессиями. */
const seedHistory = async (workspace: Workspace): Promise<void> => {
  const solutions = sqlSolutions();
  // самооценки по кругу, одним счётчиком на всю историю (не из переменной цикла)
  let graded = 0;
  const nextGrade = (): Grade => GRADES[graded++ % GRADES.length] as Grade;
  for (const [index, round] of HISTORY.entries()) {
    // курс в фокусе задаёт настройка: план дня тогда содержит только его уроки
    configure(workspace.userData, 'ru', 'light', round.course);
    const app = await launchApp(workspace.userData);
    try {
      // свой фиксированный seed у каждого раунда: порядок упражнений и оценки
      // истории не зависят от запуска, значит, и план после неё тоже
      await app.page.addInitScript(seedPlanScript(PLAN_SEED + index + 1));
      await app.page.reload();
      await app.page.waitForLoadState('domcontentloaded');
      const client = new Client(app.page);
      await client.openPlan();
      await client.startSession();
      await client.runSession(({ prompt, verifiable }) => {
        if (!verifiable) return nextGrade();
        const sql = solutions.get(prompt);
        if (sql === undefined) throw new Error(`no reference for «${prompt}»`);
        return { sql };
      });
    } finally {
      await app.close();
      await sleep(PROCESS_EXIT_MS);
    }
    if (round.shiftAfterDays > 0) {
      shiftJournalBack(workspace.userData, round.shiftAfterDays);
    }
  }
};

/**
 * Урок SQL, который ученик начал, но не закончил: на графе он «в процессе»
 * (иначе в смеси статусов не хватало бы жёлтого). Новый урок в плане по seed
 * может оказаться не первым, поэтому ответы идут по порядку, пока сессия не
 * дойдёт до него.
 */
const STARTED_LESSON = 'Inner joins';
const MAX_PARTIAL_STEPS = 10;

/** Решает текущее SQL-упражнение эталонным запросом и ждёт вердикт «Correct» (интерфейс — английский). */
const solveCurrent = async (
  page: Page,
  solutions: Map<string, string>,
): Promise<void> => {
  const lead = page.locator('.content-inner .prompt-lead').first();
  const prompt = ((await lead.innerText()).split('\n')[0] ?? '').trim();
  const sql = solutions.get(prompt);
  if (sql === undefined) throw new Error(`no reference for «${prompt}»`);
  await page.getByRole('textbox').first().fill(sql);
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByText('Correct', { exact: true }).waitFor();
};

/** Последний раунд истории: SQL-сессия, оборванная на первом упражнении `STARTED_LESSON`. */
const startLesson = async (
  workspace: Workspace,
  solutions: Map<string, string>,
): Promise<void> => {
  configure(workspace.userData, 'en', 'light', SQL_ID);
  const app = await launchApp(workspace.userData);
  try {
    const { page } = app;
    await page.addInitScript(seedPlanScript(PLAN_SEED + HISTORY.length + 1));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate("location.hash = '#/'");
    await page.getByRole('button', { name: 'Start session' }).click();
    for (let step = 0; step < MAX_PARTIAL_STEPS; step++) {
      await page.getByRole('button', { name: 'Check' }).waitFor();
      const title = await page
        .locator('.top-bar .title-block .text-title-medium')
        .first()
        .innerText();
      await solveCurrent(page, solutions);
      // верный ответ уже записан в журнал: сессию дальше не проходим
      if (title.trim() === STARTED_LESSON) return;
      await page.getByRole('button', { name: /^(Next|Finish)$/ }).click();
    }
    throw new Error(`lesson «${STARTED_LESSON}» was not reached`);
  } finally {
    await app.close();
    await sleep(PROCESS_EXIT_MS);
  }
};

/** Окно ровно `w`×`h` CSS-пикселей с `SCALE` пикселей на CSS-пиксель; часы заморожены. */
const prepareWindow = async (app: DolphyApp, h = HEIGHT): Promise<Page> => {
  const { page } = app;
  await app.evaluateMain(
    ({ BrowserWindow }, size) => {
      const [window] = BrowserWindow.getAllWindows();
      window?.setContentSize(size.width, size.height);
    },
    { width: WIDTH, height: h },
  );
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: h,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
  await page.clock.setFixedTime(FROZEN_NOW);
  await page.addInitScript(seedPlanScript(PLAN_SEED));
  // Date заморожен, зерно плана подставлено: перезагрузка применяет оба с первого кадра
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  return page;
};

const settle = async (page: Page): Promise<void> => {
  // шрифты, графика и последний кадр анимаций
  await page.evaluate('document.fonts.ready.then(() => undefined)');
  await page.mouse.move(WIDTH - 1, 1);
  await page.waitForTimeout(1200);
};

const shoot = async (
  page: Page,
  name: string,
  theme: Theme,
  style?: string,
): Promise<void> => {
  await settle(page);
  await page.screenshot({
    ...(style === undefined ? {} : { style }),
    path: join(OUTPUT, `${name}-${theme}.png`),
    animations: 'disabled',
    caret: 'hide',
  });
};

const withApp = async (
  workspace: Workspace,
  work: (page: Page) => Promise<void>,
  h = HEIGHT,
): Promise<void> => {
  const app = await launchApp(workspace.userData);
  try {
    await work(await prepareWindow(app, h));
  } finally {
    await app.close();
    await sleep(PROCESS_EXIT_MS);
  }
};

/** Сжатие без потерь, если `oxipng` есть в `PATH`. */
const hasOxipng = (): boolean => {
  try {
    execFileSync('oxipng', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** Заменяет содержимое библиотеки воркспейса английской демо-библиотекой. */
const installLibrary = (userData: string): void => {
  const library = join(userData, 'library');
  rmSync(library, { recursive: true, force: true });
  mkdirSync(library, { recursive: true });
  cpSync(LIBRARY, library, { recursive: true });
};

/**
 * Снимок БД после прогона истории. Скриншот сессии записывает настоящий ответ,
 * поэтому перед каждым проходом (и каждой темой) БД возвращается к снимку:
 * светлые и тёмные кадры показывают одно и то же состояние.
 */
const snapshotData = (userData: string): string => {
  const backup = join(userData, '..', 'data-seeded');
  rmSync(backup, { recursive: true, force: true });
  cpSync(join(userData, 'data'), backup, { recursive: true });
  return backup;
};

const restoreData = (userData: string, backup: string): void => {
  const data = join(userData, 'data');
  rmSync(data, { recursive: true, force: true });
  cpSync(backup, data, { recursive: true });
};

let workspace: Workspace | null = null;

afterAll(async () => {
  await workspace?.dispose();
});

describe('скриншоты README', () => {
  it('план, граф, сессия и курсы в светлой и тёмной темах', async () => {
    mkdirSync(OUTPUT, { recursive: true });
    workspace = await createWorkspace();
    installLibrary(workspace.userData);
    await seedHistory(workspace);
    const solutions = sqlSolutions();
    await startLesson(workspace, solutions);
    const seeded = snapshotData(workspace.userData);

    for (const theme of THEMES) {
      restoreData(workspace.userData, seeded);
      configure(workspace.userData, 'en', theme);
      await withApp(workspace, async (page) => {
        await page.evaluate("location.hash = '#/'");
        await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page
          .getByText(/Total in plan|In today/i)
          .first()
          .waitFor();
        await shoot(page, 'plan', theme);

        await page.evaluate("location.hash = '#/courses'");
        await page.locator('.course-card').first().waitFor();
        await shoot(page, 'courses', theme);
      });

      // граф — в окне пониже, чтобы «вписать» заполнил кадр по высоте
      await withApp(
        workspace,
        async (page) => {
          await page.evaluate(`location.hash = '#/courses?graph=${SQL_ID}'`);
          await page.getByRole('dialog').waitFor();
          await page.locator('.vue-flow__node').first().waitFor();
          await page
            .getByRole('button', { name: 'Fit graph to window' })
            .click();
          await shoot(page, 'graph', theme);
        },
        GRAPH_HEIGHT,
      );

      restoreData(workspace.userData, seeded);
      configure(workspace.userData, 'en', theme, SQL_ID);
      await withApp(
        workspace,
        async (page) => {
          await page.evaluate("location.hash = '#/'");
          await page.getByRole('button', { name: 'Start session' }).click();
          await page.getByRole('button', { name: 'Check' }).waitFor();
          // теория урока слева раскрыта (экран заполнен), ответ вписан в поле
          await solveCurrent(page, solutions);
          await shoot(page, 'session', theme, FROZEN_TIMER_STYLE);
        },
        SESSION_HEIGHT,
      );
    }

    const names = THEMES.flatMap((theme) =>
      ['plan', 'graph', 'session', 'courses'].map(
        (name) => `${name}-${theme}.png`,
      ),
    );
    if (hasOxipng()) {
      execFileSync(
        'oxipng',
        ['-o', '4', '--strip', 'safe', ...names.map((n) => join(OUTPUT, n))],
        { stdio: 'inherit' },
      );
    } else {
      console.warn('oxipng is not on PATH: PNGs are not recompressed');
    }
    for (const name of names) {
      const { size } = statSync(join(OUTPUT, name));
      console.log(`${name}: ${(size / 1024).toFixed(0)} KiB`);
      expect(size, `${name} is under 1.5 MB`).toBeLessThan(MAX_BYTES);
    }
  });
});
