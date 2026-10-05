import { expect } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import type { Client } from './client.ts';
import { exerciseFront } from './courses.ts';

const TIMEOUT = 15_000;

export const STATE_ID = 'acme.state';
export const STATE_COURSE = 'State (KnowledgeBase)';
export const PLAIN_COURSE = 'Plain (KnowledgeBase)';

/** Курс из трёх упражнений вида `acme.state` (расширение-фикстура `state-extension`). */
export const STATE_LIBRARY: Record<string, string> = {
  'state_kb/course_manifest.json': JSON.stringify({
    dependencies: [],
    description: STATE_COURSE,
    engine: { tags: ['state'] },
    generator_config: { KnowledgeBase: {} },
    id: 'state_kb',
    name: STATE_COURSE,
  }),
  'state_kb/basic.lesson/lesson.name.json': JSON.stringify('State'),
  ...Object.fromEntries(
    ['q1', 'q2', 'q3'].map((q) => [
      `state_kb/basic.lesson/${q}.front.md`,
      exerciseFront(
        'acme.state',
        ['    spec:', `      label: ${q}`],
        `State question ${q}`,
      ),
    ]),
  ),
};

/** Курс из одного упражнения без проверки: оценку ставит ученик, расширения тут нет. */
export const PLAIN_LIBRARY: Record<string, string> = {
  'plain_kb/course_manifest.json': JSON.stringify({
    dependencies: [],
    description: PLAIN_COURSE,
    engine: { tags: ['plain'] },
    generator_config: { KnowledgeBase: {} },
    id: 'plain_kb',
    name: PLAIN_COURSE,
  }),
  'plain_kb/basic.lesson/lesson.name.json': JSON.stringify('Plain'),
  'plain_kb/basic.lesson/q1.front.md': 'Plain question\n',
  'plain_kb/basic.lesson/q1.back.md': 'Answer\n',
};

/** Отчёт расширения (`acme.state`) на ответ `report`. */
export interface StateReport {
  reports: number;
  activations: number;
  started: number;
  finished: number;
  closed: number;
  last: { exerciseId: string; grade: number; outcome: string } | null;
  changes: number;
  greeting: string;
  loud: boolean;
  limit: number;
  mode: string;
  quota?: string;
  quotaKind?: string;
  quotaLimit?: number;
}

const ANSWER = { element: 'acme-state-answer' } as const;

const RU = {
  next: 'Далее',
  finish: 'Завершить',
  leave: 'Выйти из сессии',
  removeData: 'Удалить данные расширения',
  clear: 'Очистить данные',
} as const;

/** Оператор экранов состояния расширения: диалог настроек, данные, сессия `acme.state`. */
export class StateClient {
  readonly page: Page;
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
    this.page = client.page;
  }

  private row(id: string): Locator {
    return this.page
      .getByRole('list', { name: 'Установленные расширения', exact: true })
      .locator(`[data-extension-id="${id}"]`);
  }

  // --- сессия ---

  /** Шлёт ответ `answer`, ждёт вердикт «Пока неверно» и возвращает отчёт расширения. */
  async report(answer = 'report'): Promise<StateReport> {
    const before = await this.alertText();
    await this.client.submitWrong({ text: answer, ...ANSWER });
    let text = '';
    await expect
      .poll(
        async () => {
          text = await this.alertText();
          return text !== before && text.includes('{');
        },
        { timeout: TIMEOUT },
      )
      .toBe(true);
    return JSON.parse(text.slice(text.indexOf('{'))) as StateReport;
  }

  private async alertText(): Promise<string> {
    return (await this.page.getByRole('alert').allInnerTexts()).join('\n');
  }

  /** Запрашивает отчёт, пока `ready` не выполнится; возвращает его. */
  async reportUntil(
    ready: (report: StateReport) => boolean,
  ): Promise<StateReport> {
    let last: StateReport | null = null;
    await expect
      .poll(
        async () => {
          last = await this.report();
          return ready(last);
        },
        { timeout: 20_000, interval: 300 },
      )
      .toBe(true);
    return last as unknown as StateReport;
  }

  /**
   * Верный ответ закрывает попытку; затем «Далее» / «Завершить». `true` —
   * нажато «Завершить» (сессия закончена).
   */
  async passAndAdvance(): Promise<boolean> {
    await this.client.fillAnswer({ text: 'pass', ...ANSWER });
    await this.page
      .getByRole('button', { name: 'Проверить', exact: true })
      .click();
    await this.page.getByText('Верно', { exact: true }).waitFor({
      timeout: TIMEOUT,
    });
    const advance = this.page.getByRole('button', {
      name: new RegExp(`^(${RU.next}|${RU.finish})$`),
    });
    const last = (await advance.innerText()).trim() === RU.finish;
    await advance.click();
    return last;
  }

  /** Проходит верными ответами всё до экрана «Сессия завершена»; число закрытых попыток. */
  async passUntilFinished(): Promise<number> {
    let closed = 1;
    while (!(await this.passAndAdvance())) closed += 1;
    await this.page
      .getByText('Сессия завершена', { exact: true })
      .waitFor({ timeout: TIMEOUT });
    return closed;
  }

  async leaveSession() {
    await this.page
      .getByRole('button', { name: RU.leave, exact: true })
      .click();
  }

  // --- диалог настроек ---

  dialog(): Locator {
    return this.page.getByTestId('extension-settings');
  }

  async openSettings(id = STATE_ID) {
    await this.row(id).getByTestId(`settings-${id}`).click();
    await this.dialog().waitFor({ timeout: TIMEOUT });
    await this.dialog().getByTestId(`setting-${id}.greeting`).waitFor({
      timeout: TIMEOUT,
    });
  }

  async closeSettings() {
    await this.dialog().getByTestId('settings-close').click();
    await this.dialog().waitFor({ state: 'hidden', timeout: TIMEOUT });
  }

  private field(name: string): Locator {
    return this.dialog().getByTestId(`setting-${STATE_ID}.${name}`);
  }

  /** Вводит строку или число и уходит из поля: тогда значение записывается. */
  async typeSetting(name: 'greeting' | 'limit', value: string) {
    const input = this.field(name).locator('input');
    await input.fill(value);
    await input.press('Tab');
  }

  async settingText(name: 'greeting' | 'limit' | 'note'): Promise<string> {
    return this.field(name).locator('input').inputValue();
  }

  async setLoud(value: boolean) {
    if ((await this.isLoud()) === value) return;
    // диалог ещё может анимироваться: setChecked ждёт, пока элемент встанет на место
    await this.field('loud').locator('input').setChecked(value);
  }

  async isLoud(): Promise<boolean> {
    return this.field('loud').locator('input').isChecked();
  }

  async chooseMode(label: string) {
    await this.field('mode').locator('.v-field').click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async modeText(): Promise<string> {
    return (
      await this.field('mode').locator('.v-select__selection').innerText()
    ).trim();
  }

  /** Сообщение под полем (ошибка проверки или подсказка). */
  async fieldMessage(name: string): Promise<string> {
    return (await this.field(name).locator('.v-messages').innerText()).trim();
  }

  async resetSettings() {
    await this.dialog().getByTestId('settings-reset').click();
  }

  // --- данные ---

  /**
   * Строка «Данные» в карточке расширения или `null`, если её нет. Читается
   * одним обращением к странице: пара `count()` + `innerText()` не атомарна, и
   * строка, исчезнувшая между ними (очистка данных), заставляла `innerText()`
   * ждать вернувшегося элемента весь таймаут Playwright.
   */
  async dataLine(id = STATE_ID): Promise<string | null> {
    const [text] = await this.row(id).getByTestId('data-usage').allInnerTexts();
    return text === undefined ? null : text.trim();
  }

  async clearData(id = STATE_ID) {
    await this.row(id).getByTestId(`clear-${id}`).click();
    await this.page.getByTestId('clear-confirm').click();
  }

  // --- удаление ---

  async openRemove(id = STATE_ID) {
    await this.row(id).getByTestId(`remove-${id}`).click();
    await this.page.getByRole('dialog').waitFor({ timeout: TIMEOUT });
  }

  async tickRemoveData(value: boolean) {
    await this.page
      .getByRole('dialog')
      .getByRole('checkbox', { name: RU.removeData })
      .setChecked(value);
  }

  async confirmRemove(id = STATE_ID) {
    await this.page.getByTestId('remove-confirm').click();
    await this.row(id).waitFor({ state: 'detached', timeout: TIMEOUT });
  }
}
