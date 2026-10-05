import { expect } from 'vitest';
import type { FrameLocator, Locator, Page } from 'playwright-core';
import { MOD_KEY } from './keys.ts';

export const COMMANDS_ID = 'acme.commands';
export const VICTIM_ID = 'acme.victim';
export const PANEL_TITLE = 'Приветствия';

/** Рамка панели расширения (`PanelFrame`, режим `panel`). */
export const PANEL_FRAME = 'iframe[sandbox][data-mode="panel"]';

/** Строки интерфейса (`ru`), по которым находятся элементы. */
const RU = {
  palette: 'Палитра команд',
  find: 'Найти команду',
  list: 'Команды',
  nav: 'Панели расширений',
  back: 'Назад',
} as const;

/** Оператор палитры команд, уведомлений и страницы панели: клики и чтение экрана. */
export class CommandsClient {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // --- палитра ---

  get palette(): Locator {
    return this.page.getByRole('dialog', { name: RU.palette, exact: true });
  }

  get combobox(): Locator {
    return this.palette.getByRole('combobox', { name: RU.find, exact: true });
  }

  get options(): Locator {
    return this.palette.getByRole('option');
  }

  /** Строки команд расширений: у них есть подпись с id расширения, у команд приложения — нет. */
  get extensionOptions(): Locator {
    return this.options.filter({ has: this.page.locator('.caption') });
  }

  /** Названия команд расширений (без команд приложения, которые есть всегда). */
  async extensionTitles(): Promise<string[]> {
    return (await this.extensionOptions.locator('.title').allInnerTexts()).map(
      (text) => text.trim(),
    );
  }

  option(title: string): Locator {
    return this.options.filter({ hasText: title });
  }

  /** Поле поиска видно, в фокусе и переход диалога закончился (до этого Escape ещё не доходит до диалога). */
  async waitForPalette() {
    await this.combobox.waitFor({ timeout: 15_000 });
    await expect
      .poll(
        () =>
          this.page.evaluate(
            () =>
              document.activeElement?.getAttribute('role') === 'combobox' &&
              document
                .querySelector('.v-dialog .v-overlay__content')
                ?.className.includes('transition') === false,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
  }

  /** Ctrl+K на текущей странице; ждёт поле поиска в фокусе. */
  async openPalette() {
    await this.page.keyboard.press(`${MOD_KEY}+K`);
    await this.waitForPalette();
  }

  async search(text: string) {
    await this.combobox.fill(text);
  }

  async optionTitles(): Promise<string[]> {
    return (await this.options.locator('.title').allInnerTexts()).map((text) =>
      text.trim(),
    );
  }

  // --- уведомления ---

  /** Уведомление приложения (`role="status"`). */
  get notice(): Locator {
    return this.page.locator('.v-snackbar[role="status"]');
  }

  // --- панель ---

  navItem(title: string): Locator {
    return this.page
      .getByRole('navigation', { name: RU.nav, exact: true })
      .getByRole('link', { name: title, exact: true });
  }

  get panelHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  get frameElement(): Locator {
    return this.page.locator(PANEL_FRAME);
  }

  get frame(): FrameLocator {
    return this.page.frameLocator(PANEL_FRAME);
  }

  private panelButton(name: string): Locator {
    return this.frame.getByRole('button', { name, exact: true });
  }

  /**
   * Нажимает кнопку панели. Рамка панели — отдельный процесс (непрозрачный
   * origin): пока браузер не получил её поверхность для маршрутизации ввода
   * (десятки миллисекунд после появления DOM панели, дольше под нагрузкой),
   * мышь попадает в родительский `<iframe>`, а не в рамку. Playwright такой
   * клик не замечает (проверка попадания идёт внутри рамки), и он теряется.
   * Поэтому нажатию предшествует наведение, подтверждённое состоянием `:hover`
   * кнопки: оно появляется, только когда рамка получает события мыши.
   */
  async pressPanelButton(name: string) {
    const button = this.panelButton(name);
    await expect
      .poll(
        async () => {
          await button.hover();
          return button.evaluate((node) => node.matches(':hover'));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await button.click();
  }

  panelRole(role: string): Locator {
    return this.frame.locator(`[data-role="${role}"]`);
  }

  get backButton(): Locator {
    return this.page.getByRole('button', { name: RU.back, exact: true });
  }

  get unavailable(): Locator {
    return this.page.getByTestId('panel-unavailable');
  }

  /** Адрес маршрута (hash) текущей страницы. */
  route(): string {
    return new URL(this.page.url()).hash;
  }
}
