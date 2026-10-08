import { expect } from 'vitest';
import type { Page } from 'playwright-core';
import { MOD_KEY } from './keys.ts';

const TIMEOUT = 15_000;

export const paletteOf = (page: Page) => {
  const palette = page.getByTestId('command-palette');
  return {
    palette,
    combobox: palette.locator('input[role="combobox"]'),
    options: palette.getByRole('option'),
  };
};

/** Палитра на любом языке интерфейса: открывает её и вводит запрос. */
export const openPalette = async (page: Page, query: string) => {
  const found = paletteOf(page);
  await page.keyboard.press(`${MOD_KEY}+K`);
  await found.combobox.waitFor({ timeout: TIMEOUT });
  // Escape доходит до диалога, только когда переход закончился и поле поиска в фокусе
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement?.getAttribute('role') === 'combobox' &&
            document
              .querySelector('.v-dialog .v-overlay__content')
              ?.className.includes('transition') === false,
        ),
      { timeout: TIMEOUT },
    )
    .toBe(true);
  await found.combobox.fill(query);
  return found;
};

export const closePalette = async (page: Page) => {
  await page.keyboard.press('Escape');
  await paletteOf(page).palette.waitFor({ state: 'hidden' });
};

/** Меняет язык окна командой палитры (`Язык: English`, `Language: Русский`). */
export const switchLanguage = async (page: Page, command: string) => {
  const found = await openPalette(page, command);
  await found.options
    .filter({ hasText: command })
    .first()
    .click({ timeout: TIMEOUT });
  await found.palette.waitFor({ state: 'hidden' });
};
