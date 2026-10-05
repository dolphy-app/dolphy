import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';

let workspace: Workspace;
let app: DolphyApp;

beforeEach(async () => {
  workspace = await createWorkspace();
  app = await launchApp(workspace.userData);
});

afterEach(async () => {
  await app.close();
  await workspace.dispose();
});

const COURSE = 'SQL: аналитика данных';

describe('граф знаний в карточке курса', () => {
  it('кнопка на карточке открывает граф на всё окно; клик по уроку открывает панель урока', async () => {
    const { page } = app;
    // строкой: tsconfig e2e без DOM-типов
    await page.evaluate("location.hash = '#/courses'");
    await page
      .locator('.course-card', { hasText: COURSE })
      .getByRole('button', { name: 'Посмотреть граф знаний' })
      .click();
    const dialog = page.getByRole('dialog', { name: COURSE });
    await dialog.waitFor();
    const covers = await page.evaluate(`(() => {
      const box = document.querySelector('.graph-dialog').getBoundingClientRect();
      return box.width === innerWidth && box.height === innerHeight;
    })()`);
    expect(covers).toBe(true);

    // стартовый урок виден сразу; первый узел в DOM может быть за краем окна
    const node = page.getByRole('button', { name: /^SELECT и выражения/ });
    await node.waitFor();
    // координаты центра, а не `locator.click()`: проверяем, что узел получает
    // мышь сам, а не подложка Vue Flow под ним
    const box = await node.boundingBox();
    if (!box) throw new Error('lesson node has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => dialog.getByRole('button', { name: 'Учить' }).count())
      .toBe(1);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Курсы', exact: true }).waitFor();
  });

  it('ссылка ?graph= открывает граф курса и не оставляет параметр в адресе', async () => {
    const { page } = app;
    await page.evaluate("location.hash = '#/courses?graph=sql_analytics'");
    await page.getByRole('dialog', { name: COURSE }).waitFor();
    expect(await page.evaluate('location.hash')).toBe('#/courses');
  });
});
