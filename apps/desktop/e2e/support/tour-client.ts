import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Locator, Page } from 'playwright-core';

/** Строки интерфейса (`ru`), по которым находится тур. */
export const TOUR = {
  offer: 'Показать краткий тур?',
  start: 'Начать',
  skipOffer: 'Пропустить',
  skip: 'Пропустить тур',
  next: 'Далее',
  back: 'Назад',
  done: 'Готово',
  replay: 'Пройти тур снова',
  steps: [
    'Как это работает',
    'Проверить, что я знаю',
    'Обучение',
    'Целевая запоминаемость',
    'Закрепление основ',
    'Правило оценки',
    'Библиотека',
    'Расширения',
    'Сочетания клавиш',
  ],
} as const;

/** Исходы туров из `engine.db` (чтение, приложение может быть запущено). */
export const readTours = (userData: string): Record<string, string> => {
  const db = new Database(join(userData, 'data', 'engine.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const row = db
      .prepare("select value from setting where key = 'ui'")
      .get() as { value: string } | undefined;
    const ui = row
      ? (JSON.parse(row.value) as { tours?: Record<string, string> })
      : {};
    return ui.tours ?? {};
  } finally {
    db.close();
  }
};

export class TourClient {
  constructor(readonly page: Page) {}

  get offer(): Locator {
    return this.page.getByRole('dialog', { name: TOUR.offer, exact: true });
  }

  /** Карточка шага тура (а не диалог предложения). */
  get card(): Locator {
    return this.page.locator('.tour-card');
  }

  get hole(): Locator {
    return this.page.locator('.tour-hole');
  }

  button(name: string): Locator {
    return this.card.getByRole('button', { name, exact: true });
  }

  /** Открыта карточка шага с этим заголовком. */
  async expectStep(title: string) {
    await this.card
      .getByRole('heading', { name: title, exact: true })
      .waitFor({ timeout: 15_000 });
  }
}
