import { expect } from 'vitest';
import type { Locator, Page } from 'playwright-core';

/** Строки интерфейса (`ru`), по которым находятся элементы (i18n слайсов). */
const RU = {
  navPlan: 'План на сегодня',
  navCourses: 'Курсы',
  study: 'Учить',
  startSession: 'Начать сессию',
  reveal: 'Показать ответ',
  check: 'Проверить',
  giveUp: 'Сдаться',
  next: 'Далее',
  finish: 'Завершить',
  toPlan: 'К плану дня',
  sessionFinished: 'Сессия завершена',
  sessionEmpty: 'Сегодня нечего проходить',
  planEmpty: 'План на сегодня пуст',
  navSettings: 'Настройки',
  settingsExtensions: 'Расширения',
  settingsLearning: 'Обучение',
  gradePolicy: 'Правило оценки',
  gradePolicyMissing: 'недоступно',
  settingsAppearance: 'Внешний вид',
  themeGroup: 'Тема оформления',
  extensionList: 'Установленные расширения',
  verdictPassed: 'Верно',
  verdictFailed: 'Пока неверно',
  grades: {
    1: 'Не вспомнил',
    2: 'С трудом',
    3: 'Вспомнил',
    4: 'Хорошо',
    5: 'Легко',
  },
  states: [
    'Не начат',
    'В процессе',
    'Пройден',
    'Закрыт зависимостями',
    'Скрыт',
    'Заменён',
  ],
} as const;

const TIMEOUT = 15_000;

export type Grade = 1 | 2 | 3 | 4 | 5;

export interface CourseCardView {
  name: string;
  focused: boolean;
  attempts: number;
  lessonsDone: number;
  lessonCount: number;
  percent: number;
  state: string;
  /** Число повторений на карточке; 0, если строки нет. */
  due: number;
}

export interface SessionSummary {
  count: number;
  passed: number;
  averageGrade: number;
}

export interface Exercise {
  /** Первая строка формулировки. */
  prompt: string;
  verifiable: boolean;
}

/** Ввод ответа проверяемого упражнения: SQL, варианты выбора или текст поля расширения. */
export type AnswerInput =
  { sql: string } | { choose: string[] } | { text: string };

/** Ответ на упражнение сессии: оценка для самопроверки, `AnswerInput` — для проверяемых. */
export type Answerer = (exercise: Exercise) => Grade | AnswerInput;

const int = (match: RegExpMatchArray | null, index = 1) =>
  match ? Number(match[index]) : Number.NaN;

/** Клиент — оператор настоящего окна: только клики и чтение экрана. */
export class Client {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private get main() {
    return this.page.locator('.v-main');
  }

  async openCourses() {
    await this.page
      .getByRole('link', { name: RU.navCourses, exact: true })
      .click();
    await this.page.locator('.course-card').first().waitFor({
      timeout: TIMEOUT,
    });
  }

  async openPlan() {
    await this.page
      .getByRole('link', { name: RU.navPlan, exact: true })
      .click();
    await this.planTotalLocator().waitFor({ timeout: TIMEOUT });
  }

  private card(name: string): Locator {
    return this.page.locator('.course-card', {
      has: this.page.getByRole('heading', { name, exact: true }),
    });
  }

  async courseNames(): Promise<string[]> {
    const headings = this.page.locator('.course-card h2');
    await headings.first().waitFor({ timeout: TIMEOUT });
    return (await headings.allInnerTexts()).map((text) => text.trim());
  }

  async readCard(name: string): Promise<CourseCardView> {
    const card = this.card(name);
    await card.waitFor({ timeout: TIMEOUT });
    const text = await card.innerText();
    const done = text.match(/Пройдено уроков: (\d+) из (\d+)/);
    const state = RU.states.find((entry) => text.includes(entry));
    if (!done || !state) throw new Error(`Unexpected card text: ${text}`);
    return {
      name,
      focused: (await card.getAttribute('aria-current')) === 'true',
      attempts: /нет попыток/.test(text) ? 0 : int(text.match(/(\d+) попыт/)),
      lessonsDone: int(done, 1),
      lessonCount: int(done, 2),
      percent: int(text.match(/(\d+)%/)),
      state,
      due: int(text.match(/(\d+) повтор/)) || 0,
    };
  }

  /** «Учить»: курс становится единственным в плане дня; открывается план. */
  async focusCourse(name: string) {
    await this.card(name)
      .getByRole('button', { name: RU.study, exact: true })
      .click();
    await this.planTotalLocator().waitFor({ timeout: TIMEOUT });
  }

  private planTotalLocator() {
    return this.main.getByText(/Всего в плане: \d+/);
  }

  /** Число упражнений в плане дня, как его видит ученик. */
  async planTotal(): Promise<number> {
    const label = this.planTotalLocator();
    await label.waitFor({ timeout: TIMEOUT });
    return int((await label.innerText()).match(/(\d+)/));
  }

  /** Экран плана: пустое состояние и заявленное число упражнений согласованы. */
  async planIsEmpty(): Promise<boolean> {
    const total = await this.planTotal();
    const emptyShown = await this.main
      .getByText(RU.planEmpty, { exact: true })
      .isVisible();
    expect(emptyShown, 'пустое состояние ⇔ «Всего в плане: 0»').toBe(
      total === 0,
    );
    return emptyShown;
  }

  async startSession() {
    await this.main
      .getByRole('button', { name: RU.startSession, exact: true })
      .click();
  }

  /** Текущее упражнение или `null`, пока экран между упражнениями. */
  private async readPrompt(): Promise<Exercise | null> {
    const check = this.page.getByRole('button', {
      name: RU.check,
      exact: true,
    });
    const reveal = this.page.getByRole('button', {
      name: RU.reveal,
      exact: true,
    });
    const verifiable = await check.isVisible();
    if (!verifiable && !(await reveal.isVisible())) return null;
    const prompt = this.page
      .locator('.content-inner .text-title-large')
      .first();
    const text = (await prompt.innerText()).split('\n')[0]?.trim() ?? '';
    return { prompt: text, verifiable };
  }

  /** Текущее упражнение сессии (ждёт, пока экран не покажет формулировку). */
  async currentExercise(): Promise<Exercise> {
    let exercise: Exercise | null = null;
    await expect
      .poll(async () => (exercise = await this.readPrompt()), {
        timeout: TIMEOUT,
      })
      .not.toBeNull();
    return exercise as unknown as Exercise;
  }

  /**
   * Проходит сессию до экрана «Сессия завершена». Каждое упражнение
   * отвечается через `answer`; возвращает итог с экрана.
   */
  async runSession(answer: Answerer): Promise<SessionSummary> {
    for (;;) {
      const exercise = await this.currentExercise();
      const reply = answer(exercise);
      if (typeof reply === 'object') {
        await this.fillAnswer(reply);
        await this.page
          .getByRole('button', { name: RU.check, exact: true })
          .click();
        await this.page.getByText(RU.verdictPassed, { exact: true }).waitFor({
          timeout: TIMEOUT,
        });
      } else {
        await this.page
          .getByRole('button', { name: RU.reveal, exact: true })
          .click();
        await this.page
          .getByRole('button', {
            name: new RegExp(`^${reply}\\s*${RU.grades[reply]}$`),
          })
          .click();
      }
      // самооценка сама переходит дальше, кроме ремедиации; после проверки
      // SQL и после ремедиации нужно нажать «Далее» / «Завершить»
      const advance = this.page.getByRole('button', {
        name: new RegExp(`^(${RU.next}|${RU.finish})$`),
      });
      const finished = this.page.getByText(RU.sessionFinished, { exact: true });
      const stage = async () => {
        if (await finished.isVisible()) return 'finished';
        if (await advance.isVisible()) return 'advance';
        const now = await this.readPrompt();
        return now !== null && now.prompt !== exercise.prompt ? 'next' : 'wait';
      };
      await expect
        .poll(stage, { timeout: TIMEOUT })
        .toMatch(/^(finished|advance|next)$/);
      const reached = await stage();
      if (reached === 'advance') await advance.click();
      if ((await stage()) === 'finished') break;
    }
    await this.page
      .getByText(RU.sessionFinished, { exact: true })
      .waitFor({ timeout: TIMEOUT });
    return this.readSummary();
  }

  private async stat(label: string): Promise<string> {
    return (
      await this.page
        .locator(`div:has(> dt:text-is("${label}")) > dd`)
        .innerText()
    ).trim();
  }

  private async readSummary(): Promise<SessionSummary> {
    return {
      count: Number(await this.stat('Упражнений')),
      passed: Number(await this.stat('Пройдено')),
      averageGrade: Number(await this.stat('Средняя оценка')),
    };
  }

  /** Вводит ответ в элемент расширения (custom element в shadow DOM). */
  private async fillAnswer(reply: AnswerInput) {
    if ('sql' in reply) {
      await this.page.locator('lms-sql-answer textarea').fill(reply.sql);
    } else if ('choose' in reply) {
      // после неверной попытки флажки остаются отмеченными: начинаем с чистого выбора
      const marked = this.page.locator(
        'lms-choice-answer input[type=checkbox]:checked',
      );
      while ((await marked.count()) > 0) await marked.first().uncheck();
      for (const option of reply.choose) {
        await this.page
          .locator('lms-choice-answer')
          .getByLabel(option, { exact: true })
          .check();
      }
    } else {
      await this.page.locator('acme-echo-answer input').fill(reply.text);
    }
  }

  /** Неверный ответ: вердикт «Пока неверно», попытка не закрыта. */
  async submitWrong(reply: AnswerInput) {
    await this.fillAnswer(reply);
    await this.page
      .getByRole('button', { name: RU.check, exact: true })
      .click();
    await this.page.getByText(RU.verdictFailed, { exact: true }).waitFor({
      timeout: TIMEOUT,
    });
  }

  async giveUp() {
    await this.page
      .getByRole('button', { name: RU.giveUp, exact: true })
      .click();
  }

  /** С экрана итога и с пустой сессии — обратно на план. */
  async backToPlan() {
    await this.page
      .getByRole('button', { name: RU.toPlan, exact: true })
      .click();
    await this.planTotalLocator().waitFor({ timeout: TIMEOUT });
  }

  async sessionIsEmpty(): Promise<boolean> {
    return this.page.getByText(RU.sessionEmpty, { exact: true }).isVisible();
  }

  /** «Настройки» → «Расширения»: ждёт список установленных расширений. */
  async openSettingsExtensions() {
    await this.page
      .getByRole('link', { name: RU.navSettings, exact: true })
      .click();
    await this.page
      .getByRole('tab', { name: RU.settingsExtensions, exact: true })
      .click();
    await this.extensionList().waitFor({ timeout: TIMEOUT });
  }

  private extensionList(): Locator {
    return this.page.getByRole('list', { name: RU.extensionList, exact: true });
  }

  /** Тексты строк расширения `id` из списка «Расширения» (id может повторяться). */
  async readExtensions(id: string): Promise<string[]> {
    const rows = this.extensionList()
      .getByRole('listitem')
      .filter({
        has: this.page.getByRole('heading', { name: id, exact: true }),
      });
    await rows.first().waitFor({ timeout: TIMEOUT });
    return rows.allInnerTexts();
  }

  /** «Настройки» → «Обучение»: ждёт выбор правила оценки. */
  async openSettingsLearning() {
    await this.page
      .getByRole('link', { name: RU.navSettings, exact: true })
      .click();
    await this.page
      .getByRole('tab', { name: RU.settingsLearning, exact: true })
      .click();
    await this.gradePolicySelect().waitFor({ timeout: TIMEOUT });
  }

  private gradePolicySelect(): Locator {
    return this.page.getByRole('combobox', { name: RU.gradePolicy });
  }

  /** Название выбранного правила оценки, как его показывает выбор. */
  async selectedGradePolicy(): Promise<string> {
    return (
      await this.page
        .locator('.grade-policy-select .v-select__selection')
        .innerText()
    ).trim();
  }

  async selectGradePolicy(title: string) {
    // поле перекрывает скрытый input: открываем меню кликом по самому полю
    await this.page.locator('.grade-policy-select .v-field').click();
    await this.page
      .getByRole('option', { name: new RegExp(`^${title}`) })
      .click();
    await expect
      .poll(() => this.selectedGradePolicy(), { timeout: TIMEOUT })
      .toBe(title);
  }

  /** Предупреждение о недоступном сохранённом правиле или `null`. */
  async gradePolicyWarning(): Promise<string | null> {
    const alert = this.page.locator('.grade-policy-missing');
    return (await alert.isVisible()) ? (await alert.innerText()).trim() : null;
  }

  /** «Настройки» → «Внешний вид»: ждёт группу плиток тем. */
  async openSettingsAppearance() {
    await this.page
      .getByRole('link', { name: RU.navSettings, exact: true })
      .click();
    await this.page
      .getByRole('tab', { name: RU.settingsAppearance, exact: true })
      .click();
    await this.themeTile('').first().waitFor({ timeout: TIMEOUT });
  }

  private themeTile(label: string): Locator {
    return this.page
      .getByRole('radiogroup', { name: RU.themeGroup, exact: true })
      .getByRole('radio', { name: label });
  }

  async themeTileExists(label: string): Promise<boolean> {
    return (await this.themeTile(label).count()) > 0;
  }

  async selectTheme(label: string) {
    await this.themeTile(label).first().check({ force: true });
  }

  /** Подпись выбранной плитки темы (по `checked` радио). */
  async isThemeSelected(label: string): Promise<boolean> {
    return this.themeTile(label).first().isChecked();
  }

  /** Вычисленный фон корня приложения (`.v-application`). */
  async appBackground(): Promise<string> {
    return this.page
      .locator('.v-application')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
  }
}
