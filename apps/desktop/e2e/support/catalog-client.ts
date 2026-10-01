import type { Locator, Page } from 'playwright-core';

/** Строки интерфейса (`ru`) вкладок «Установленные» и «Каталог» и диалогов установки. */
const RU = {
  tabInstalled: 'Установленные',
  tabCatalog: 'Каталог',
  catalogList: 'Расширения из каталога',
  extensionList: 'Установленные расширения',
  search: 'Поиск по каталогу',
  refresh: 'Обновить каталог',
  retry: 'Повторить',
  kindsGroup: 'Фильтр по виду вклада',
  install: 'Установить',
  confirmUpdate: 'Обновить',
  close: 'Закрыть',
  remove: 'Удалить',
  offline: 'Нет связи с каталогом',
  unavailable: 'Каталог недоступен',
  updateAll: 'Обновить все',
} as const;

const TIMEOUT = 30_000;

/** Оператор вкладок «Установленные» и «Каталог»: клики и чтение экрана. */
export class CatalogClient {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Диалог установки или удаления. */
  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  private tab(name: string): Locator {
    return this.page.getByRole('tab', { name, exact: true });
  }

  async openInstalledTab() {
    await this.tab(RU.tabInstalled).click();
    await this.installedRow('')
      .first()
      .waitFor({ state: 'attached', timeout: TIMEOUT });
  }

  /** Вкладка «Каталог»: ждёт список, состояние «нет связи» или ошибку. */
  async openCatalogTab() {
    await this.tab(RU.tabCatalog).click();
    await this.page
      .locator(
        `[aria-label="${RU.catalogList}"], [data-testid="catalog-unavailable"]`,
      )
      .first()
      .waitFor({ timeout: TIMEOUT });
  }

  /** Названия карточек каталога в порядке показа. */
  async catalogNames(): Promise<string[]> {
    return (await this.catalogCards().getByRole('heading').allInnerTexts()).map(
      (text) => text.trim(),
    );
  }

  private catalogCards(): Locator {
    return this.page
      .getByRole('list', { name: RU.catalogList, exact: true })
      .getByRole('listitem');
  }

  catalogCard(id: string): Locator {
    return this.page
      .getByRole('list', { name: RU.catalogList, exact: true })
      .locator(`[data-extension-id="${id}"]`);
  }

  async search(text: string) {
    await this.page.getByRole('searchbox', { name: RU.search }).fill(text);
  }

  async toggleKind(label: string) {
    await this.page
      .getByRole('group', { name: RU.kindsGroup })
      .getByRole('button', { name: label, exact: true })
      .click();
  }

  async refreshCatalog() {
    await this.page
      .getByRole('button', { name: RU.refresh, exact: true })
      .click();
  }

  /** Кнопка «Установить»/«Обновить до…» карточки (по id расширения). */
  installButton(id: string): Locator {
    return this.catalogCard(id).getByRole('button', {
      name: new RegExp(`^(${RU.install}|${RU.confirmUpdate})`),
    });
  }

  /** Подтверждает диалог и ждёт итог установки: «Установлено…» или сообщение об ошибке. */
  async confirmInstall() {
    await this.dialog
      .getByRole('button', { name: /^(Установить|Обновить)$/ })
      .click();
    await this.dialog
      .locator('[data-testid="install-done"], [data-testid="install-error"]')
      .first()
      .waitFor({ timeout: TIMEOUT });
  }

  /** «Закрыть» в итоге установки: диалог закрывается, окно остаётся как есть. */
  async closeDialog() {
    await this.dialog
      .getByRole('button', { name: RU.close, exact: true })
      .click();
    await this.dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
  }

  installedRow(id: string): Locator {
    return this.page
      .getByRole('list', { name: RU.extensionList, exact: true })
      .locator(
        id === '' ? '[data-extension-id]' : `[data-extension-id="${id}"]`,
      );
  }

  async installedText(id: string): Promise<string> {
    const row = this.installedRow(id);
    await row.first().waitFor({ timeout: TIMEOUT });
    return row.first().innerText();
  }

  /** Число переключателей в строке расширения. */
  async installedSwitchCount(id: string): Promise<number> {
    await this.installedRow(id).first().waitFor({ timeout: TIMEOUT });
    return this.installedRow(id).getByRole('checkbox').count();
  }

  async openRemoveDialog(id: string) {
    await this.installedRow(id)
      .getByRole('button', { name: new RegExp(`^${RU.remove}`) })
      .click();
    await this.dialog.waitFor({ timeout: TIMEOUT });
  }

  async confirmRemove() {
    await this.dialog
      .getByRole('button', { name: RU.remove, exact: true })
      .click();
    await this.dialog.waitFor({ state: 'hidden', timeout: TIMEOUT });
  }

  updatesBanner(): Locator {
    return this.page.getByTestId('extensions-updates');
  }

  async updateFromRow(id: string) {
    await this.installedRow(id)
      .getByRole('button', { name: /^Обновить до/ })
      .click();
    await this.dialog.waitFor({ timeout: TIMEOUT });
  }

  async updateAll() {
    await this.updatesBanner()
      .getByRole('button', { name: RU.updateAll, exact: true })
      .click();
    await this.dialog.waitFor({ timeout: TIMEOUT });
  }
}
