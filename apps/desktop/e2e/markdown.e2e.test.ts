import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, launchApp } from './support/app.ts';
import type { SpirulaApp, Workspace } from './support/app.ts';
import { Client } from './support/client.ts';

const NAME = 'Markdown (KnowledgeBase)';
const BAD_EXTENSION = fileURLToPath(
  new URL('./fixtures/bad-markdown-extension', import.meta.url),
);

/** Курс из одного упражнения; `prompt` — текст формулировки. */
const markdownCourse = (prompt: string) => ({
  'markdown_kb/course_manifest.json': JSON.stringify({
    dependencies: [],
    description: 'Markdown course',
    engine: { tags: ['markdown'] },
    generator_config: { KnowledgeBase: {} },
    id: 'markdown_kb',
    name: NAME,
  }),
  'markdown_kb/basic.lesson/lesson.name.json': JSON.stringify('Blocks'),
  'markdown_kb/basic.lesson/q1.front.md': `${prompt}\n`,
  'markdown_kb/basic.lesson/q1.back.md': 'Answer\n',
});

let workspace: Workspace | null = null;
let app: SpirulaApp | null = null;

afterEach(async () => {
  await app?.close();
  await workspace?.dispose();
  app = null;
  workspace = null;
});

const startSession = async (
  libraryFiles: Record<string, string>,
  extensions?: Record<string, string>,
) => {
  workspace = await createWorkspace({
    libraryFiles,
    ...(extensions ? { extensions } : {}),
  });
  app = await launchApp(workspace.userData);
  const client = new Client(app.page);
  await client.openCourses();
  await client.focusCourse(NAME);
  await client.startSession();
  return { client, page: app.page };
};

describe('блоки кода в Markdown', () => {
  it('math выводится формулой, неизвестный язык остаётся кодом', async () => {
    const { page } = await startSession(
      markdownCourse(
        [
          'Formulas',
          '',
          '```math',
          'E = mc^2',
          '```',
          '',
          '```unknownlang',
          'plain text',
          '```',
        ].join('\n'),
      ),
    );
    await page
      .locator('.spirula-md-block[data-language=math] svg')
      .waitFor({ state: 'visible' });
    expect(
      await page.locator('.spirula-md-block[data-language=math] pre').count(),
    ).toBe(0);
    await page
      .locator('pre code', { hasText: 'plain text' })
      .waitFor({ state: 'visible' });
    expect(
      await page
        .locator('.spirula-md-block[data-language=unknownlang]')
        .count(),
    ).toBe(0);
  });

  it('сбой рендерера оставляет исходник, страница работает', async () => {
    const { client, page } = await startSession(
      markdownCourse(['Broken', '', '```boom', 'raw source', '```'].join('\n')),
      { 'acme.bad-markdown': BAD_EXTENSION },
    );
    const block = page.locator('.spirula-md-block[data-language=boom]');
    await block.locator('.spirula-md-error').waitFor({ state: 'visible' });
    expect(await block.locator('pre code').textContent()).toContain(
      'raw source',
    );
    expect(await block.getAttribute('data-state')).toBe('error');
    // интерфейс остаётся рабочим: «Показать ответ» доступно и сессия проходит
    const summary = await client.runSession(() => 3);
    expect(summary.count).toBe(1);
  });
});
