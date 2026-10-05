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

describe('граф знаний', () => {
  it('клик мышью по уроку открывает панель урока', async () => {
    const { page } = app;
    // строкой: tsconfig e2e без DOM-типов
    await page.evaluate("location.hash = '#/graph?course=sql_analytics'");
    // стартовый урок виден сразу; первый узел в DOM может быть за краем окна
    const node = page.getByRole('button', { name: /^SELECT и выражения/ });
    await node.waitFor();
    // координаты центра, а не `locator.click()`: проверяем, что узел получает
    // мышь сам, а не подложка Vue Flow под ним
    const box = await node.boundingBox();
    if (!box) throw new Error('lesson node has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() => page.getByRole('button', { name: 'Учить' }).count())
      .toBe(1);
  });

  it('граф открыт на всё окно, Escape закрывает, кнопка открывает снова', async () => {
    const { page } = app;
    await page.evaluate("location.hash = '#/graph?course=sql_analytics'");
    const dialog = page.getByRole('dialog', { name: 'Граф знаний' });
    await dialog.waitFor();
    // строкой: tsconfig e2e без DOM-типов
    const covers = await page.evaluate(`(() => {
      const box = document.querySelector('.graph-dialog').getBoundingClientRect();
      return box.width === innerWidth && box.height === innerHeight;
    })()`);
    expect(covers).toBe(true);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Открыть граф' }).click();
    await dialog.waitFor();
    await page.getByRole('button', { name: 'Приблизить' }).waitFor();
  });
});
