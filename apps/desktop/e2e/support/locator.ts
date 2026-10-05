import { expect } from 'vitest';
import type { Locator } from 'playwright-core';

const TIMEOUT = 30_000;

/** Утверждения о локаторе Playwright в духе `expect.poll`: повторяются до таймаута. */
export const expectText = (locator: Locator, text: string, timeout = TIMEOUT) =>
  expect.poll(() => locator.first().innerText(), { timeout }).toContain(text);

export const expectVisible = (locator: Locator, timeout = TIMEOUT) =>
  expect.poll(() => locator.first().isVisible(), { timeout }).toBe(true);

export const expectCount = (
  locator: Locator,
  count: number,
  timeout = TIMEOUT,
) => expect.poll(() => locator.count(), { timeout }).toBe(count);

export const expectDisabled = (
  locator: Locator,
  disabled: boolean,
  timeout = TIMEOUT,
) =>
  expect.poll(() => locator.first().isDisabled(), { timeout }).toBe(disabled);

export const expectAttribute = (
  locator: Locator,
  name: string,
  value: string,
  timeout = TIMEOUT,
) =>
  expect
    .poll(() => locator.first().getAttribute(name), { timeout })
    .toBe(value);

/** Элемент в фокусе (`document.activeElement`); повторяется до таймаута. */
export const expectFocused = (locator: Locator, timeout = TIMEOUT) =>
  expect
    .poll(
      () => locator.first().evaluate((el) => el === document.activeElement),
      {
        timeout,
      },
    )
    .toBe(true);
