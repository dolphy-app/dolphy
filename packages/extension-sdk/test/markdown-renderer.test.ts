import { describe, expect, it } from 'vitest';
import { defineMarkdownRenderer } from '../src/index.ts';

describe('defineMarkdownRenderer', () => {
  it('отдаёт функцию вывода как render модуля и передаёт ей аргументы', async () => {
    const signal = new AbortController().signal;
    const module = defineMarkdownRenderer(
      async (source, container, context) => {
        container.textContent = `${context.language}:${source}`;
      },
    );
    const container = document.createElement('div');
    await module.render('x', container, { language: 'math', signal });
    expect(container.textContent).toBe('math:x');
  });

  it('пробрасывает отказ рендерера', async () => {
    const module = defineMarkdownRenderer(() => {
      throw new Error('boom');
    });
    const container = document.createElement('div');
    const signal = new AbortController().signal;
    await expect(
      Promise.resolve().then(() =>
        module.render('x', container, { language: 'a', signal }),
      ),
    ).rejects.toThrow('boom');
  });
});
