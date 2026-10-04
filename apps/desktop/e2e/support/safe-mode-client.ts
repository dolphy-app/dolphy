import { expect } from 'vitest';
import type { Locator, Page } from 'playwright-core';

/** Строки интерфейса (`ru`), по которым находятся элементы. */
const RU = {
  switchLabel: 'Безопасный режим',
  disable: 'Выключить безопасный режим',
} as const;

/** Оператор баннера безопасного режима и переключателя в «Настройки → Расширения». */
export class SafeModeClient {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get banner(): Locator {
    return this.page.getByTestId('safe-mode-banner');
  }

  get disableButton(): Locator {
    return this.banner.getByRole('button', { name: RU.disable, exact: true });
  }

  /** Переключатель «Безопасный режим» на экране расширений. */
  get toggle(): Locator {
    return this.page.getByRole('checkbox', {
      name: RU.switchLabel,
      exact: true,
    });
  }

  /** Включает или выключает режим переключателем и ждёт, пока движок применит набор (переключатель снова доступен). */
  async setToggle(value: boolean) {
    await this.toggle.waitFor({ state: 'attached', timeout: 15_000 });
    await this.toggle.setChecked(value, { force: true });
    await expect
      .poll(() => this.toggle.isDisabled(), { timeout: 15_000 })
      .toBe(false);
  }
}
