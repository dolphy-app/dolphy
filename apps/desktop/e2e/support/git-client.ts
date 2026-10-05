import type { Locator, Page } from 'playwright-core';

/** Строки интерфейса (`ru`) диалога «Добавить из Git» и списка репозиториев. */
const RU = {
  navCourses: 'Курсы',
  navSettings: 'Настройки',
  tabLibrary: 'Библиотека',
  open: 'Добавить из Git',
  url: 'Адрес репозитория',
  ref: 'Ветка или тег',
  next: 'Далее',
  submit: 'Добавить',
  back: 'Назад',
  chooseLabel: 'Выбрать курсы репозитория',
  apply: 'Применить',
  close: 'Закрыть',
  update: 'Обновить репозиторий',
  remove: 'Удалить репозиторий',
  confirmRemove: 'Удалить',
  upToDate: 'Уже актуально',
  updated: 'Обновлено: 1 курс',
  updatedTwo: 'Обновлено: 2 курса',
  removedNotice: 'Репозиторий удалён',
  removedWithProgressNotice: 'Репозиторий и прогресс удалены',
  removeProgress: 'Удалить и прогресс курсов',
  emptyList: 'Репозиториев пока нет',
  checkUpdates: 'Проверить обновления',
  checkUpToDate: 'Все курсы актуальны',
  checkFound: 'Найдено 1 обновление',
  noticeOpen: 'К курсам',
  bannerUpdate: /^Обновить курсы из /,
  updateChip: 'Есть обновление',
} as const;

const TIMEOUT = 30_000;

export interface RepositoryRowView {
  url: string;
  /** Строка «ветка · коммит · дата · курсы» под адресом. */
  details: string;
  status: string;
  /** Тексты всех чипов строки (статус, обновление, «не установлено»). */
  chips: string[];
}

/** Оператор диалога добавления и списка репозиториев: клики и чтение экрана. */
export class GitClient {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private get dialog(): Locator {
    return this.page.locator('.v-dialog .v-card');
  }

  async openCourses() {
    await this.page
      .getByRole('link', { name: RU.navCourses, exact: true })
      .click();
    await this.page
      .getByRole('button', { name: RU.open, exact: true })
      .waitFor({ timeout: TIMEOUT });
  }

  /** Названия карточек курсов на экране «Курсы» (без ожидания появления). */
  async courseNames(): Promise<string[]> {
    return (await this.page.locator('.course-card h2').allInnerTexts()).map(
      (text) => text.trim(),
    );
  }

  courseCard(name: string): Locator {
    return this.page.locator('.course-card', {
      has: this.page.getByRole('heading', { name, exact: true }),
    });
  }

  async openAddDialog() {
    await this.page.getByRole('button', { name: RU.open, exact: true }).click();
    await this.dialog.getByLabel(RU.url).waitFor({ timeout: TIMEOUT });
  }

  /** Вводит адрес (и ветку/тег) и нажимает «Добавить». */
  async submitAdd(url: string, ref?: string) {
    await this.dialog.getByLabel(RU.url).fill(url);
    if (ref !== undefined) await this.dialog.getByLabel(RU.ref).fill(ref);
    await this.dialog
      .getByRole('button', { name: RU.next, exact: true })
      .click();
    // даём Vue отрисовать состояние после клика: иначе видна прежняя ошибка
    await this.page.evaluate(
      'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
    );
  }

  /** Диалог закрылся: курсы добавлены. */
  async waitAdded() {
    try {
      await this.dialog.waitFor({ state: 'detached', timeout: TIMEOUT });
    } catch (error) {
      const shown = await this.dialog.innerText().catch(() => '(нет диалога)');
      throw new Error(`диалог не закрылся:\n${shown}`, { cause: error });
    }
  }

  /** Список курсов на втором шаге диалога: названия в порядке показа. */
  async chooserCourses(): Promise<string[]> {
    const rows = this.dialog.locator('ul.courses li.course');
    await rows.first().waitFor({ timeout: TIMEOUT });
    return (await rows.locator('.text-body-large').allInnerTexts()).map(
      (text) => text.trim(),
    );
  }

  /** Текст строки курса в списке выбора (название, id, пояснение). */
  async chooserRow(title: string): Promise<string> {
    return (
      await this.dialog
        .locator('li.course', { hasText: title })
        .first()
        .innerText()
    ).trim();
  }

  /** Чекбокс курса в списке выбора. */
  courseCheckbox(title: string): Locator {
    return this.dialog.getByRole('checkbox', { name: title, exact: true });
  }

  /** Нажимает «Добавить» на втором шаге диалога. */
  async confirmChoice() {
    await this.dialog
      .getByRole('button', { name: RU.submit, exact: true })
      .click();
  }

  /** «Назад» на втором шаге диалога. */
  async backToAddress() {
    await this.dialog
      .getByRole('button', { name: RU.back, exact: true })
      .click();
    await this.dialog.getByLabel(RU.url).waitFor({ timeout: TIMEOUT });
  }

  /** Кнопка «Добавить» второго шага. */
  get confirmButton(): Locator {
    return this.dialog.getByRole('button', { name: RU.submit, exact: true });
  }

  /** «Курсы…» в строке репозитория → окно выбора с загруженным списком. */
  async openCourseChooser(url: string) {
    await this.page
      .getByRole('button', { name: `${RU.chooseLabel} ${url}`, exact: true })
      .click();
    await this.dialog
      .locator('li.course')
      .first()
      .waitFor({ timeout: TIMEOUT });
  }

  /** «Применить» в окне выбора курсов репозитория. */
  async applyChoice() {
    await this.dialog
      .getByRole('button', { name: RU.apply, exact: true })
      .click();
  }

  /** Текст ошибки в диалоге (поле адреса или общий блок) после неудачи. */
  async dialogError(): Promise<string> {
    const error = this.dialog.locator(
      '.v-alert, .v-input--error .v-messages__message',
    );
    await error.first().waitFor({ timeout: TIMEOUT });
    // диалог не закрылся, индикатор не висит
    await this.dialog
      .locator('[role="status"]')
      .waitFor({ state: 'detached', timeout: TIMEOUT });
    return (await error.allInnerTexts()).join('\n');
  }

  async closeDialog() {
    await this.dialog
      .getByRole('button', { name: RU.close, exact: true })
      .click();
    await this.dialog.waitFor({ state: 'detached', timeout: TIMEOUT });
  }

  async openLibrarySettings() {
    await this.page
      .getByRole('link', { name: RU.navSettings, exact: true })
      .click();
    await this.page.getByRole('tab', { name: RU.tabLibrary }).click();
    await this.page
      .getByRole('heading', { name: 'Репозитории', exact: true })
      .waitFor({ timeout: TIMEOUT });
    // список загружен: либо строки, либо «пока нет»
    await this.page
      .locator('li.item')
      .or(this.page.getByText(RU.emptyList))
      .first()
      .waitFor({ timeout: TIMEOUT });
  }

  async repositories(): Promise<RepositoryRowView[]> {
    const items = this.page.locator('li.item');
    const rows: RepositoryRowView[] = [];
    for (const item of await items.all()) {
      rows.push({
        url: (await item.locator('.url').innerText()).trim(),
        details: (await item.locator('p').first().innerText()).trim(),
        status: (await item.locator('.v-chip').first().innerText()).trim(),
        chips: (await item.locator('.v-chip').allInnerTexts()).map((text) =>
          text.trim(),
        ),
      });
    }
    return rows;
  }

  async emptyListShown(): Promise<boolean> {
    return (await this.page.getByText(RU.emptyList).count()) > 0;
  }

  /** Уведомление при запуске: «Доступно обновление курсов: …». */
  get startupNotice(): Locator {
    return this.page.getByTestId('course-updates-notice');
  }

  /** Нажимает «К курсам» в уведомлении при запуске. */
  async openCoursesFromNotice() {
    await this.startupNotice
      .getByRole('button', { name: RU.noticeOpen, exact: true })
      .click();
    await this.page
      .getByRole('button', { name: RU.open, exact: true })
      .waitFor({ timeout: TIMEOUT });
  }

  /** Плашки обновлений на экране «Курсы». */
  get updateBanners(): Locator {
    return this.page.locator('[data-testid^="course-update-"]');
  }

  /** «Обновить» в плашке обновления. */
  async updateFromBanner() {
    await this.updateBanners
      .first()
      .getByRole('button', { name: RU.bannerUpdate })
      .click();
  }

  /** Карточка курса с пометкой «Есть обновление». */
  updatedCourseCard(name: string): Locator {
    return this.courseCard(name).getByText(RU.updateChip, { exact: true });
  }

  /** «Проверить обновления» в шапке экрана «Курсы». */
  async checkUpdates() {
    await this.page
      .getByRole('button', { name: RU.checkUpdates, exact: true })
      .click();
  }

  /** Уведомление по итогу ручной проверки. */
  async waitCheckNotice(kind: 'up-to-date' | 'found') {
    await this.page
      .getByTestId('check-outcome')
      .filter({ hasText: kind === 'found' ? RU.checkFound : RU.checkUpToDate })
      .waitFor({ timeout: TIMEOUT });
  }

  async updateRepository(url: string) {
    await this.page
      .getByRole('button', { name: `${RU.update} ${url}`, exact: true })
      .click();
  }

  /** Уведомление после «Обновить»: «Уже актуально» или «Обновлено: …». */
  async waitUpdateNotice(kind: 'up-to-date' | 'updated' | 'updated-two') {
    const text = {
      'up-to-date': RU.upToDate,
      updated: RU.updated,
      'updated-two': RU.updatedTwo,
    }[kind];
    await this.page
      .locator('.v-snackbar__content', { hasText: text })
      .waitFor({ timeout: TIMEOUT });
  }

  /**
   * «Удалить» → подтверждение в диалоге. Флажок «Удалить и прогресс курсов» при
   * открытии снят; `withProgress` отмечает его до подтверждения.
   */
  async removeRepository(url: string, { withProgress = false } = {}) {
    await this.page
      .getByRole('button', { name: `${RU.remove} ${url}`, exact: true })
      .click();
    const box = this.dialog.getByRole('checkbox', { name: RU.removeProgress });
    if (await box.isChecked()) {
      throw new Error('флажок «Удалить и прогресс курсов» должен быть снят');
    }
    if (withProgress) await box.check();
    await this.dialog
      .getByRole('button', { name: RU.confirmRemove, exact: true })
      .click();
    await this.page
      .getByText(withProgress ? RU.removedWithProgressNotice : RU.removedNotice)
      .waitFor({ timeout: TIMEOUT });
  }

  /** Названия уроков курса в окне графа курса. */
  async lessonNames(courseId: string): Promise<string[]> {
    // строкой: tsconfig e2e без DOM-типов
    await this.page.evaluate(`location.hash = '#/courses?graph=${courseId}'`);
    const nodes = this.page.locator('.vue-flow__node-lesson');
    await nodes.first().waitFor({ timeout: TIMEOUT });
    const names = (await nodes.allInnerTexts()).map((text) => text.trim());
    // граф открыт на всё окно и закрывает боковое меню: дальше тест ходит по экранам
    await this.page.keyboard.press('Escape');
    await nodes.first().waitFor({ state: 'detached', timeout: TIMEOUT });
    return names;
  }
}
