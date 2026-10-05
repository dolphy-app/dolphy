import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { readJournal } from './support/journal.ts';

const GIT = 'Git: основы';
const TIMEOUT = 30_000;

let workspace: Workspace;
let app: DolphyApp | null = null;

beforeEach(async () => {
  workspace = await createWorkspace();
  app = await launchApp(workspace.userData);
});

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
});

const journal = () =>
  readJournal(workspace.userData).map(({ kind, op, source }) =>
    kind === 'attempt' ? `attempt:${source}` : `${kind}:${op ?? ''}`,
  );

/** Открывает входной тест по курсу Git и нажимает «Начать». */
const openPlacementTest = async (page: DolphyApp['page']) => {
  await page.getByRole('link', { name: 'Курсы', exact: true }).click();
  const card = page.locator('.course-card', {
    has: page.getByRole('heading', { name: GIT, exact: true }),
  });
  await card
    .getByRole('button', { name: 'Проверить, что я знаю', exact: true })
    .click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
};

/** Проходит входной тест по курсу Git: на каждую пробу «Легко», пока не появится итог. */
const takePlacementTest = async (page: DolphyApp['page']) => {
  await page.getByRole('link', { name: 'Курсы', exact: true }).click();
  const card = page.locator('.course-card', {
    has: page.getByRole('heading', { name: GIT, exact: true }),
  });
  await card
    .getByRole('button', { name: 'Проверить, что я знаю', exact: true })
    .click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  const finished = page.getByRole('heading', {
    name: 'Вот что вы уже знаете',
    exact: true,
  });
  const reveal = page.getByRole('button', {
    name: 'Показать ответ',
    exact: true,
  });
  for (let probe = 0; probe < 60; probe++) {
    if (await finished.isVisible()) return;
    if (await reveal.isVisible()) {
      await reveal.click();
      await page.getByRole('button', { name: /^5\s*Легко$/ }).click();
    }
    await page.waitForTimeout(100);
  }
  await finished.waitFor({ timeout: TIMEOUT });
};

describe('отмена результата входного теста', () => {
  it('«Отменить результат» снимает всю пачку одной записью retract, «Вернуть результат» возвращает', async () => {
    const { page } = app!;
    await takePlacementTest(page);

    const attempts = journal();
    expect(attempts.length).toBeGreaterThan(0);
    expect(new Set(attempts)).toEqual(new Set(['attempt:placement']));

    await page
      .getByRole('button', { name: 'Отменить результат', exact: true })
      .click();
    await expect.poll(journal).toEqual([...attempts, 'retract:set']);
    await page
      .getByText('Результат отменён', { exact: false })
      .waitFor({ timeout: TIMEOUT });

    await page
      .getByRole('button', { name: 'Вернуть результат', exact: true })
      .click();
    await expect
      .poll(journal)
      .toEqual([...attempts, 'retract:set', 'retract:unset']);
    await page
      .getByRole('button', { name: 'Отменить результат', exact: true })
      .waitFor({ timeout: TIMEOUT });
  });
});

describe('отмена ответа внутри входного теста', () => {
  it('«Отменить ответ» возвращает ту же пробу, «Вернуть ответ» — следующую; в журнал до конца теста ничего не пишется', async () => {
    const { page } = app!;
    await openPlacementTest(page);
    const prompt = page.locator('.content-inner .prompt-lead').first();
    const back = page.getByRole('button', {
      name: 'Отменить ответ',
      exact: true,
    });
    const forward = page.getByRole('button', {
      name: 'Вернуть ответ',
      exact: true,
    });
    await prompt.waitFor({ timeout: TIMEOUT });
    const first = await prompt.innerText();
    await expect(back.isDisabled()).resolves.toBe(true);

    await page
      .getByRole('button', { name: 'Не знаю / пропустить', exact: true })
      .click();
    await expect.poll(() => back.isEnabled()).toBe(true);
    const second = await prompt.innerText();
    expect(second).not.toBe(first);

    await back.click();
    await expect.poll(() => prompt.innerText()).toBe(first);
    await expect.poll(() => forward.isEnabled()).toBe(true);
    await expect(back.isDisabled()).resolves.toBe(true);

    await forward.click();
    await expect.poll(() => prompt.innerText()).toBe(second);
    expect(journal()).toEqual([]);
  });
});
