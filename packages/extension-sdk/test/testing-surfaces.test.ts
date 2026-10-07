import { afterEach, describe, expect, it } from 'vitest';
import {
  defineAnswerView,
  defineExtensionPanel,
  type JsonValue,
} from '../src/index.ts';
import { loadPanel, loadView } from '../src/testing.ts';

afterEach(() => {
  document.body.replaceChildren();
});

const views = {
  'acme.echo': defineAnswerView((api, initial) => {
    const input = document.createElement('input');
    input.value = typeof initial.value === 'string' ? initial.value : '';
    input.addEventListener('input', () =>
      api.setAnswer(input.value, input.value !== ''),
    );
    input.addEventListener('keydown', () => api.submit());
    if (api.label !== null) input.setAttribute('aria-label', api.label);
    api.root.append(input);
    return {
      update: (next) => {
        input.disabled = next.disabled;
        if (next.verdict !== null) input.dataset.outcome = next.verdict.outcome;
      },
    };
  }),
};

describe('loadView', () => {
  it('mounts the view with the initial properties and label, and reads its DOM', async () => {
    const loaded = await loadView(views, 'acme.echo', {
      value: 'abc',
      label: 'Answer',
    });
    const input = loaded.query<HTMLInputElement>('input');
    expect(input?.value).toBe('abc');
    expect(input?.getAttribute('aria-label')).toBe('Answer');
    expect(loaded.queryAll('input')).toHaveLength(1);
    expect(loaded.root).toBe(loaded.element.shadowRoot);
  });

  it('records answer changes and submissions emitted by the view', async () => {
    const loaded = await loadView(views, 'acme.echo');
    const input = loaded.query<HTMLInputElement>('input') as HTMLInputElement;
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('keydown'));
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(loaded.changes).toEqual([
      { value: 'x', complete: true },
      { value: '', complete: false },
    ]);
    expect(loaded.submissions).toBe(1);
  });

  it('applies property updates before update() resolves', async () => {
    const loaded = await loadView(views, 'acme.echo');
    await loaded.update({ disabled: true, verdict: { outcome: 'failed' } });
    const input = loaded.query<HTMLInputElement>('input');
    expect(input?.disabled).toBe(true);
    expect(input?.dataset.outcome).toBe('failed');
  });

  it('dispose removes the element and the default container', async () => {
    const loaded = await loadView(views, 'acme.echo');
    expect(document.body.contains(loaded.element)).toBe(true);
    loaded.dispose();
    expect(document.body.children).toHaveLength(0);
  });

  it('mounts into a given container and leaves it in the document on dispose', async () => {
    const container = document.body.appendChild(document.createElement('main'));
    const loaded = await loadView(views, 'acme.echo', { container });
    expect(container.contains(loaded.element)).toBe(true);
    loaded.dispose();
    expect(document.body.contains(container)).toBe(true);
    expect(container.children).toHaveLength(0);
  });

  it('names the missing view', async () => {
    await expect(loadView(views, 'acme.other')).rejects.toThrow(
      "view 'acme.other' was not exported",
    );
  });

  it('gives two loads of the same view separate elements', async () => {
    const first = await loadView(views, 'acme.echo');
    const second = await loadView(views, 'acme.echo');
    expect(first.element.localName).not.toBe(second.element.localName);
    expect(first.root).not.toBe(second.root);
  });
});

const panels = {
  'acme.panel': defineExtensionPanel({
    async mount(container, ctx) {
      container.textContent = `${ctx.panelId}:${JSON.stringify(ctx.props)}`;
      const result = await ctx
        .call('acme.ping', { n: 1 })
        .catch((error: Error) => error.message);
      const status = document.createElement('p');
      status.textContent = String(result);
      container.append(status);
      ctx.onProps(
        (props) => void (container.dataset.props = JSON.stringify(props)),
      );
      ctx.signal.addEventListener(
        'abort',
        () => void (container.dataset.closed = 'yes'),
      );
      ctx.onContextChange(
        ({ courseId }) => void (container.dataset.course = String(courseId)),
      );
      container.dataset.course = String(ctx.context.courseId);
    },
  }),
};

describe('loadPanel', () => {
  it('mounts with the panel id and props and awaits an asynchronous mount', async () => {
    const loaded = await loadPanel(panels, 'acme.panel', {
      props: { from: 'test' },
      call: async () => 'pong',
    });
    expect(loaded.container.textContent).toBe('acme.panel:{"from":"test"}pong');
    expect(loaded.calls).toEqual([{ commandId: 'acme.ping', args: { n: 1 } }]);
  });

  it('rejects ctx.call unless the test provides call()', async () => {
    const loaded = await loadPanel(panels, 'acme.panel');
    expect(loaded.container.textContent).toContain(
      "command 'acme.ping' is not available in this test",
    );
  });

  it('delivers new props to subscribers and aborts the signal on dispose', async () => {
    const loaded = await loadPanel(panels, 'acme.panel');
    const props: JsonValue = { page: 2 };
    loaded.setProps(props);
    expect(loaded.container.dataset.props).toBe('{"page":2}');
    expect(loaded.aborted).toBe(false);
    loaded.dispose();
    expect(loaded.aborted).toBe(true);
    expect(loaded.container.dataset.closed).toBe('yes');
    expect(document.body.children).toHaveLength(0);
  });

  it('names the missing panel', async () => {
    await expect(loadPanel(panels, 'acme.nope')).rejects.toThrow(
      "panel 'acme.nope' was not exported",
    );
  });
});

describe('panel context', () => {
  it('starts with all courses and follows setContext through ctx.context and onContextChange', async () => {
    const loaded = await loadPanel(panels, 'acme.panel');
    expect(loaded.container.dataset.course).toBe('null');
    loaded.setContext({ courseId: 'c1' });
    expect(loaded.container.dataset.course).toBe('c1');
  });

  it('starts with the context the test passes', async () => {
    const loaded = await loadPanel(panels, 'acme.panel', {
      context: { courseId: 'c9' },
    });
    expect(loaded.container.dataset.course).toBe('c9');
  });
});
