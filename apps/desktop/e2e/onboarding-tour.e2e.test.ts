import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { runAxe } from './support/axe.ts';
import { MOD_KEY } from './support/keys.ts';
import { expectFocused, expectText } from './support/locator.ts';
import { TOUR, TourClient, readTours } from './support/tour-client.ts';

const TIMEOUT = 30_000;

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

/** Запуск приложения; `tours: {}` — чистая база, первый запуск. */
const launch = async (
  options: Parameters<typeof createWorkspace>[0] = { tours: {} },
  extraArgs: readonly string[] = [],
) => {
  workspace ??= await createWorkspace(options);
  app = await launchApp(workspace.userData, undefined, extraArgs);
  const { page } = app;
  await page
    .getByRole('link', { name: 'План на сегодня', exact: true })
    .waitFor({ timeout: TIMEOUT });
  return { page, tour: new TourClient(page) };
};

const relaunch = async () => {
  await app?.close();
  app = null;
  return launch();
};

/** Прошло ли время, за которое диалог появился бы, если бы его предлагали. */
const settle = (page: Page) => page.waitForTimeout(1500);

const readTourOutcomes = () => readTours(workspace!.userData);

describe('обучающий тур: предложение при первом запуске', () => {
  it('на чистой базе показывается диалог с фокусом на «Начать»; «Пропустить» записывает skipped, и тур не возвращается', async () => {
    const { page, tour } = await launch();
    await tour.offer.waitFor({ timeout: TIMEOUT });
    await expectFocused(
      tour.offer.getByRole('button', { name: TOUR.start, exact: true }),
    );
    expect(await runAxe(page, { include: '[role="dialog"]' })).toEqual([]);

    await tour.offer
      .getByRole('button', { name: TOUR.skipOffer, exact: true })
      .click();
    await tour.offer.waitFor({ state: 'hidden' });
    expect(await tour.card.count()).toBe(0);
    await expect.poll(readTourOutcomes).toEqual({ welcome: 'skipped' });

    const { page: again, tour: next } = await relaunch();
    await settle(again);
    expect(await next.offer.count()).toBe(0);
  });

  it('Escape в диалоге равен «Пропустить»', async () => {
    const { page, tour } = await launch();
    await tour.offer.waitFor({ timeout: TIMEOUT });
    await page.keyboard.press('Escape');
    await tour.offer.waitFor({ state: 'hidden' });
    await expect.poll(readTourOutcomes).toEqual({ welcome: 'skipped' });
  });

  it('в безопасном режиме тур не предлагается', async () => {
    const { page, tour } = await launch({ tours: {} }, ['--safe-mode']);
    await settle(page);
    expect(await tour.offer.count()).toBe(0);
    expect(readTourOutcomes()).toEqual({});
  });
});

describe('обучающий тур: прохождение', () => {
  it('девять шагов по вкладкам, подсветка цели, axe на каждом шаге, «Готово» записывает completed', async () => {
    const { page, tour } = await launch();
    await tour.offer.waitFor({ timeout: TIMEOUT });
    await tour.offer
      .getByRole('button', { name: TOUR.start, exact: true })
      .click();

    const total = TOUR.steps.length;
    for (const [index, title] of TOUR.steps.entries()) {
      await tour.expectStep(title);
      await expectText(tour.card, `Шаг ${index + 1} из ${total}`);
      // фокус на карточке, Tab не уходит со страницы-подложки
      await expectFocused(tour.card);
      // axe читает цвета, пока карточка проявляется: ждём конца перехода
      await page.waitForTimeout(500);
      expect(await runAxe(page, { include: '.tour-card' })).toEqual([]);

      if (index === 0) {
        expect(await tour.hole.count()).toBe(0);
        expect(await tour.button(TOUR.back).count()).toBe(0);
      } else {
        // дыра подсветки накрывает цель шага
        await tour.hole.waitFor();
        const box = await tour.hole.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(20);
        // карточка не наезжает на подсвеченное, не выходит за окно и не обрезает кнопки
        // прокрутка к цели идёт плавно: положение карточки устанавливается за несколько кадров
        const measure = () =>
          page.evaluate(() => {
            const rect = (selector: string) =>
              document.querySelector(selector)!.getBoundingClientRect();
            const card = rect('[data-tour-card]');
            const hole = rect('.tour-hole');
            const overlap =
              Math.max(
                0,
                Math.min(card.right, hole.right) -
                  Math.max(card.left, hole.left),
              ) *
              Math.max(
                0,
                Math.min(card.bottom, hole.bottom) -
                  Math.max(card.top, hole.top),
              );
            const buttons = [
              ...document.querySelectorAll('[data-tour-card] button'),
            ].map((button) => button.getBoundingClientRect());
            return {
              overlap,
              inside:
                card.left >= 0 &&
                card.top >= 0 &&
                card.right <= window.innerWidth &&
                card.bottom <= window.innerHeight,
              clipped: buttons.some(
                (b) => b.left < card.left || b.right > card.right,
              ),
            };
          });
        await expect
          .poll(measure, { timeout: 5000 })
          .toEqual({ overlap: 0, inside: true, clipped: false });
        expect(await tour.button(TOUR.back).count()).toBe(1);
      }
      if (index < total - 1) {
        await tour.button(TOUR.next).click();
      }
    }
    expect(page.url()).toContain('settings');
    expect(await tour.button(TOUR.done).count()).toBe(1);
    await tour.button(TOUR.done).click();
    await tour.card.waitFor({ state: 'detached' });
    await expect.poll(readTourOutcomes).toEqual({ welcome: 'completed' });

    const { page: again, tour: next } = await relaunch();
    await settle(again);
    expect(await next.offer.count()).toBe(0);
  });

  it('тур сам переходит между вкладками: «Курсы» на шаге про проверку знаний, «Настройки» на остальных', async () => {
    const { page, tour } = await launch();
    await tour.offer.getByRole('button', { name: TOUR.start }).click();
    await tour.expectStep(TOUR.steps[0]);
    expect(page.url()).not.toContain('courses');
    await tour.button(TOUR.next).click();
    await tour.expectStep(TOUR.steps[1]);
    expect(page.url()).toContain('courses');
    // подсвечена одна кнопка, а не вся страница
    await tour.hole.waitFor();
    const box = await tour.hole.boundingBox();
    const height = await page.evaluate(() => window.innerHeight);
    expect(box!.height).toBeLessThan(height / 4);
    await tour.button(TOUR.next).click();
    await tour.expectStep(TOUR.steps[2]);
    expect(page.url()).toContain('settings');
  });

  it('клавиатура: → и ← листают, Tab не выходит из карточки, Escape пропускает и пишет skipped', async () => {
    const { page, tour } = await launch();
    await tour.offer.getByRole('button', { name: TOUR.start }).click();
    await tour.expectStep(TOUR.steps[0]);
    await page.keyboard.press('ArrowRight');
    await tour.expectStep(TOUR.steps[1]);
    await page.keyboard.press('ArrowRight');
    await tour.expectStep(TOUR.steps[2]);
    await page.keyboard.press('ArrowLeft');
    await tour.expectStep(TOUR.steps[1]);
    // карточка пересоздаётся при смене шага: фокус приходит в неё чуть позже
    await expectFocused(tour.card);

    for (let press = 0; press < 6; press++) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('.tour-card') !== null,
        ),
      ).toBe(true);
    }
    for (let press = 0; press < 6; press++) {
      await page.keyboard.press('Shift+Tab');
      expect(
        await page.evaluate(
          () => document.activeElement?.closest('.tour-card') !== null,
        ),
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
    await tour.card.waitFor({ state: 'detached' });
    await expect.poll(readTourOutcomes).toEqual({ welcome: 'skipped' });
  });

  it('«Пропустить тур» на шаге закрывает его и пишет skipped', async () => {
    const { tour } = await launch();
    await tour.offer.getByRole('button', { name: TOUR.start }).click();
    await tour.expectStep(TOUR.steps[0]);
    await tour.button(TOUR.skip).click();
    await tour.card.waitFor({ state: 'detached' });
    await expect.poll(readTourOutcomes).toEqual({ welcome: 'skipped' });
  });
});

describe('обучающий тур: повтор', () => {
  it('«Пройти тур снова» в «О движке» запускает тур, фокус после закрытия возвращается на кнопку', async () => {
    const { page, tour } = await launch({ tours: { welcome: 'completed' } });
    await settle(page);
    expect(await tour.offer.count()).toBe(0);

    expect(
      await page.getByRole('button', { name: 'Пройти тур снова' }).count(),
    ).toBe(0);
    await page.getByRole('link', { name: 'Настройки', exact: true }).click();
    await page.getByRole('tab', { name: 'О движке', exact: true }).click();
    const replay = page.getByRole('button', { name: TOUR.replay, exact: true });
    await replay.click();
    await tour.expectStep(TOUR.steps[0]);
    await page.keyboard.press('Escape');
    await tour.card.waitFor({ state: 'detached' });
    // тур ходил по вкладкам, но ученик остаётся там, откуда начал, и фокус на кнопке
    await replay.waitFor();
    expect(page.url()).toContain('about');
    await expectFocused(replay);
    // повтор перезаписывает исход
    await expect.poll(readTourOutcomes).toEqual({ welcome: 'skipped' });
  });

  it('команда палитры «Показать обучающий тур» запускает тур', async () => {
    const { page, tour } = await launch({ tours: { welcome: 'completed' } });
    await page.keyboard.press(`${MOD_KEY}+K`);
    const palette = page.getByRole('dialog', {
      name: 'Палитра команд',
      exact: true,
    });
    await palette.waitFor();
    await palette
      .getByRole('combobox', { name: 'Найти команду', exact: true })
      .fill('обучающий');
    await palette.getByRole('option').first().click();
    await tour.expectStep(TOUR.steps[0]);
  });
});
