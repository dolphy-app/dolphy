import type { Locator, Page } from 'playwright-core';

/** Оператор журнала и «Скопировать диагностику» в «Настройки → Расширения». */
export class DiagnosticsClient {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get openButton(): Locator {
    return this.page.getByTestId('extensions-log-open');
  }

  openForExtension(id: string): Locator {
    return this.page.getByTestId(`extension-log-open-${id}`);
  }

  get dialog(): Locator {
    return this.page.getByTestId('extension-log-dialog');
  }

  get entries(): Locator {
    return this.dialog.getByTestId('extension-log-entry');
  }

  get empty(): Locator {
    return this.dialog.getByTestId('extension-log-empty');
  }

  get refresh(): Locator {
    return this.dialog.getByTestId('extension-log-refresh');
  }

  get extensionFilter(): Locator {
    return this.dialog.getByTestId('extension-log-filter-extension');
  }

  get levelFilter(): Locator {
    return this.dialog.getByTestId('extension-log-filter-level');
  }

  get copyDiagnostics(): Locator {
    return this.page.getByTestId('extensions-copy-diagnostics');
  }

  /** Тексты записей диалога сверху вниз. */
  async entryTexts(): Promise<string[]> {
    return this.entries.allInnerTexts();
  }
}
