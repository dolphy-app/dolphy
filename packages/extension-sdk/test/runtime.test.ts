import { describe, expect, it, vi } from 'vitest';
import type { MarkdownRenderContext, PanelContext } from '../src/index.ts';
import { dispatchMarkdown, dispatchPanels } from '../src/runtime.ts';

const signal = new AbortController().signal;

describe('dispatchPanels', () => {
  const panelContext = (panelId: string): PanelContext => ({
    panelId,
    props: undefined,
    signal,
    context: { courseId: null },
    call: async () => undefined,
    onProps: () => () => undefined,
    onContextChange: () => () => undefined,
  });

  it('mounts the panel named by ctx.panelId and passes the arguments through', async () => {
    const first = { mount: vi.fn() };
    const second = { mount: vi.fn(async () => undefined) };
    const module = dispatchPanels({ 'a.first': first, 'a.second': second });
    const container = document.createElement('div');
    const context = panelContext('a.second');
    await module.mount(container, context);
    expect(second.mount).toHaveBeenCalledWith(container, context);
    expect(first.mount).not.toHaveBeenCalled();
  });

  it('rejects a panel that the file does not export', () => {
    const module = dispatchPanels({ 'a.first': { mount() {} } });
    expect(() =>
      module.mount(document.createElement('div'), panelContext('a.other')),
    ).toThrow("panel 'a.other' is not exported");
  });
});

describe('dispatchMarkdown', () => {
  const context = (language: string): MarkdownRenderContext => ({
    language,
    signal,
  });

  it('renders with the renderer of the block language', async () => {
    const container = document.createElement('div');
    const module = dispatchMarkdown({
      math: {
        render: (source, target) => void (target.textContent = `m:${source}`),
      },
      chart: {
        render: (source, target) => void (target.textContent = `c:${source}`),
      },
    });
    await module.render('x', container, context('chart'));
    expect(container.textContent).toBe('c:x');
  });

  it('rejects a language that the file does not export', () => {
    const module = dispatchMarkdown({ math: { render() {} } });
    expect(() =>
      module.render('x', document.createElement('div'), context('chart')),
    ).toThrow("markdown renderer 'chart' is not exported");
  });
});
