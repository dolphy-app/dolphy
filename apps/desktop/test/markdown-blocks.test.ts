// @vitest-environment happy-dom
import type { MarkdownRendererDto } from '@lms/engine-contract';
import { describe, expect, it, vi } from 'vitest';
import { hydrateMarkdownBlocks } from '../src/pages/session/lib/markdown-blocks.ts';
import { createMarkdownRenderer } from '../src/pages/session/lib/markdown.ts';

const renderers: MarkdownRendererDto[] = [
  {
    language: 'math',
    extensionId: 'lms.math',
    rendererUrl: 'lms-ext://m/a.mjs',
    isolated: false,
  },
];
const describeError = (language: string) => `failed:${language}`;

const mount = (source: string, languages = ['math']) => {
  const root = document.createElement('div');
  root.innerHTML = createMarkdownRenderer(new Set(languages))(source);
  return root;
};

describe('правило fence', () => {
  it('объявленный язык становится заглушкой с экранированным исходником', () => {
    const root = mount('```math\n<script>alert(1)</script> & x\n```');
    const block = root.querySelector('.lms-md-block');
    expect(block?.getAttribute('data-language')).toBe('math');
    expect(block?.getAttribute('data-state')).toBe('pending');
    expect(block?.querySelector('script')).toBeNull();
    expect(block?.querySelector('pre code')?.textContent).toBe(
      '<script>alert(1)</script> & x\n',
    );
  });

  it('необъявленный язык остаётся обычным кодом', () => {
    const root = mount('```other\nx\n```');
    expect(root.querySelector('.lms-md-block')).toBeNull();
    expect(root.querySelector('pre code')?.textContent).toBe('x\n');
  });

  it('дополнительные слова info-строки не мешают', () => {
    const root = mount('```math title="a"\nx\n```');
    expect(
      root.querySelector('.lms-md-block')?.getAttribute('data-language'),
    ).toBe('math');
  });
});

describe('hydrateMarkdownBlocks', () => {
  const run = (
    root: HTMLElement,
    render: (source: string, container: HTMLElement) => unknown,
    signal = new AbortController().signal,
    loadModule = vi.fn(async () => ({ render })),
  ) =>
    hydrateMarkdownBlocks({
      root,
      renderers,
      signal,
      describeError,
      loadModule: loadModule as never,
    }).then(() => loadModule);

  it('заменяет pre результатом рендерера', async () => {
    const root = mount('```math\nE=mc^2\n```');
    const sources: string[] = [];
    await run(root, (source, container) => {
      sources.push(source);
      container.innerHTML = '<svg></svg>';
    });
    const block = root.querySelector('.lms-md-block');
    expect(sources).toEqual(['E=mc^2\n']);
    expect(block?.getAttribute('data-state')).toBe('done');
    expect(block?.querySelector('pre')).toBeNull();
    expect(block?.querySelector('svg')).not.toBeNull();
  });

  it.each([
    ['исключение', () => Promise.reject(new Error('x'))],
    [
      'синхронное исключение',
      () => {
        throw new Error('x');
      },
    ],
  ])('сбой рендерера (%s) оставляет исходник', async (_name, render) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = mount('```math\nE\n```');
    await run(root, render);
    const block = root.querySelector('.lms-md-block');
    expect(block?.getAttribute('data-state')).toBe('error');
    expect(block?.querySelector('pre code')?.textContent).toBe('E\n');
    const note = block?.querySelector('p.lms-md-error');
    expect(note?.getAttribute('role')).toBe('note');
    expect(note?.textContent).toBe('failed:math');
  });

  it('сбой загрузки модуля и язык без рендерера оставляют исходник', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = mount('```math\nE\n```');
    await hydrateMarkdownBlocks({
      root: failing,
      renderers,
      signal: new AbortController().signal,
      describeError,
      loadModule: () => Promise.reject(new Error('import failed')),
    });
    expect(failing.querySelector('[data-state=error] pre code')).not.toBeNull();

    const unknown = mount('```chart\nE\n```', ['chart']);
    await run(unknown, () => undefined);
    expect(unknown.querySelector('[data-state=error] pre code')).not.toBeNull();
  });

  it('повторный запуск не трогает готовые и ошибочные блоки', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = mount('```math\nA\n```\n\n```math\nB\n```');
    const render = vi.fn((source: string, container: HTMLElement) => {
      if (source.startsWith('B')) throw new Error('x');
      container.textContent = 'ok';
    });
    await run(root, render);
    await run(root, render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('.lms-md-error')).toHaveLength(1);
  });

  it('прерванный сигнал останавливает работу и оставляет блоки ожидающими', async () => {
    const root = mount('```math\nA\n```\n\n```math\nB\n```');
    const controller = new AbortController();
    const render = vi.fn(() => controller.abort());
    await run(root, render, controller.signal);
    expect(render).toHaveBeenCalledTimes(1);
    const states = [...root.querySelectorAll('.lms-md-block')].map((b) =>
      b.getAttribute('data-state'),
    );
    expect(states).toEqual(['pending', 'pending']);
    expect(root.querySelectorAll('pre')).toHaveLength(2);
  });
});
