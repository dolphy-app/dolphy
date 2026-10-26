import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createWorkspace, launchApp } from './support/app.ts';
import type { DolphyApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const SHAPE_EXTENSION = fileURLToPath(
  new URL('./fixtures/shape-theme', import.meta.url),
);

let workspace: Workspace | null = null;
let app: DolphyApp | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  await workspace?.dispose();
  workspace = null;
});

describe('токены и стили тем расширений', () => {
  it('скругления, шрифт и css применяются, пока тема выбрана; встроенная тема выглядит как прежде', async () => {
    workspace = await createWorkspace({
      extensions: { 'acme.shape': SHAPE_EXTENSION },
    });
    app = await launchApp(workspace.userData);
    const page = app.page;
    const client = new Client(page);

    const look = () =>
      page.evaluate(() => {
        const radius = (selector: string) => {
          const element = document.querySelector(selector);
          return element ? getComputedStyle(element).borderTopLeftRadius : null;
        };
        return {
          button: radius('.course-card .v-btn'),
          card: radius('.course-card'),
          chip: radius('.v-chip'),
          field: radius('.v-field'),
          font: getComputedStyle(document.body).fontFamily,
          spacing: getComputedStyle(document.body).letterSpacing,
          styles: document.querySelectorAll('style[data-dolphy-theme]').length,
        };
      });

    await client.openSettingsAppearance();
    await client.selectTheme('Светлая');
    await client.openCourses();
    // значения Vuetify по умолчанию (rounded-lg у кнопки и карточки, md у чипа и поля)
    await expect.poll(look).toMatchObject({
      button: '8px',
      card: '8px',
      chip: '4px',
      field: '4px',
      styles: 0,
      spacing: 'normal',
    });

    await client.openSettingsAppearance();
    await client.selectTheme('Форма');
    await client.openCourses();
    const shaped = await expect
      .poll(look)
      .toMatchObject({
        button: '13px',
        card: '13px',
        chip: '3px',
        field: '3px',
        spacing: '0.5px',
        styles: 1,
      })
      .then(look);
    expect(shaped.font).toContain('Courier New');

    await client.openSettingsAppearance();
    await client.selectTheme('Светлая');
    await client.openCourses();
    await expect.poll(look).toMatchObject({
      button: '8px',
      card: '8px',
      chip: '4px',
      field: '4px',
      styles: 0,
      spacing: 'normal',
    });
  });
});
