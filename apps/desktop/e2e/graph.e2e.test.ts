import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { SpirulaApp, Workspace } from './support/app.ts';

let workspace: Workspace;
let app: SpirulaApp;

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
    const node = page.locator('.vue-flow__node-lesson [role="button"]').first();
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
});
