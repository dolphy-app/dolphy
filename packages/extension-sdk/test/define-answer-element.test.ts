import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_EVENT,
  defineAnswerElement,
  type AnswerElementApi,
  type AnswerElementInstance,
  type AnswerElementProps,
} from '../src/index.ts';

interface TestElement extends HTMLElement {
  view: unknown;
  value: unknown;
  disabled: boolean;
  verdict: AnswerElementProps['verdict'];
}

let counter = 0;
const nextTag = () => `sdk-test-${++counter}`;

const flush = () => Promise.resolve();

const setup = (
  overrides: (
    api: AnswerElementApi,
  ) => Partial<AnswerElementInstance> = () => ({}),
) => {
  const tag = nextTag();
  const apis: AnswerElementApi[] = [];
  const updates: AnswerElementProps[] = [];
  const mounts: AnswerElementProps[] = [];
  const destroy = vi.fn();
  defineAnswerElement(tag, (api, props) => {
    apis.push(api);
    mounts.push(props);
    return {
      update: (next) => void updates.push(next),
      destroy,
      ...overrides(api),
    };
  });
  const element = document.createElement(tag) as TestElement;
  return { tag, element, apis, updates, mounts, destroy };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('defineAnswerElement', () => {
  it('rejects tags that are not valid element names', () => {
    expect(() =>
      defineAnswerElement('nodash', () => ({ update() {} })),
    ).toThrow(TypeError);
    expect(() =>
      defineAnswerElement('Bad-Tag', () => ({ update() {} })),
    ).toThrow(TypeError);
  });

  it('is idempotent: a second definition keeps the first implementation', () => {
    const tag = nextTag();
    const first = vi.fn(() => ({ update() {} }));
    const second = vi.fn(() => ({ update() {} }));
    defineAnswerElement(tag, first);
    defineAnswerElement(tag, second);
    document.body.append(document.createElement(tag));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('mounts on connection with initial props and the properties set before', () => {
    const { element, mounts } = setup();
    expect(element.view).toBeUndefined();
    expect(element.disabled).toBe(false);
    expect(element.verdict).toBeNull();
    element.view = { options: ['a'] };
    element.value = [0];
    document.body.append(element);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toEqual({
      view: { options: ['a'] },
      value: [0],
      disabled: false,
      verdict: null,
    });
    expect(Object.isFrozen(mounts[0])).toBe(true);
  });

  it('coalesces property changes into one update per microtask', async () => {
    const { element, updates } = setup();
    document.body.append(element);
    element.view = 1;
    element.value = 2;
    element.disabled = true;
    element.verdict = { outcome: 'passed' };
    expect(updates).toHaveLength(0);
    await flush();
    expect(updates).toEqual([
      { view: 1, value: 2, disabled: true, verdict: { outcome: 'passed' } },
    ]);
    expect(Object.isFrozen(updates[0])).toBe(true);

    element.value = 3;
    await flush();
    expect(updates).toHaveLength(2);
    expect(updates[1]?.value).toBe(3);
  });

  it('does not call update for changes made before the connection', async () => {
    const { element, updates } = setup();
    element.value = 'x';
    await flush();
    document.body.append(element);
    await flush();
    expect(updates).toHaveLength(0);
  });

  it('dispatches composed bubbling events with the exact detail', () => {
    const { element, apis } = setup();
    document.body.append(element);
    const received: CustomEvent[] = [];
    document.body.addEventListener(ANSWER_EVENT.change, (event) =>
      received.push(event as CustomEvent),
    );
    document.body.addEventListener(ANSWER_EVENT.submit, (event) =>
      received.push(event as CustomEvent),
    );
    apis[0]?.setAnswer([1, 2], true);
    apis[0]?.submit();
    expect(received.map((event) => event.type)).toEqual([
      'dolphy-answer-change',
      'dolphy-answer-submit',
    ]);
    expect(received[0]?.detail).toEqual({ value: [1, 2], complete: true });
    expect(received[0]?.bubbles).toBe(true);
    expect(received[0]?.composed).toBe(true);
    expect(received[1]?.bubbles).toBe(true);
    expect(received[1]?.composed).toBe(true);
  });

  it('exposes an open shadow root and the live aria-label', () => {
    const { element, apis } = setup();
    document.body.append(element);
    expect(apis[0]?.root).toBe(element.shadowRoot);
    expect(apis[0]?.label).toBeNull();
    element.setAttribute('aria-label', 'Ответ');
    expect(apis[0]?.label).toBe('Ответ');
  });

  it('destroys on disconnect and remounts on reconnect', async () => {
    const { element, mounts, updates, destroy } = setup((api) => ({
      update: () => api.root.append('rendered'),
    }));
    document.body.append(element);
    element.value = 'first';
    await flush();
    expect(element.shadowRoot?.textContent).toBe('rendered');

    element.remove();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(element.shadowRoot?.childNodes).toHaveLength(0);

    element.value = 'second';
    await flush();
    expect(updates).toHaveLength(0);

    document.body.append(element);
    expect(mounts).toHaveLength(2);
    expect(mounts[1]?.value).toBe('second');
  });

  it('contains errors thrown by mount and stays inert', async () => {
    const tag = nextTag();
    const error = new Error('mount failed');
    const mount = vi.fn(() => {
      throw error;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defineAnswerElement(tag, mount);
    const element = document.createElement(tag) as TestElement;
    document.body.append(element);
    element.value = 1;
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ error, tag }, expect.any(String));
    expect(element.value).toBe(1);
    expect(() => element.remove()).not.toThrow();
  });

  it('contains errors thrown by update and destroy', async () => {
    const error = new Error('broken');
    const { element, tag } = setup(() => ({
      update: () => {
        throw error;
      },
      destroy: () => {
        throw error;
      },
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.body.append(element);
    element.value = 1;
    await flush();
    expect(log).toHaveBeenCalledWith({ error, tag }, expect.any(String));

    const other = setup();
    document.body.append(other.element);
    element.remove();
    expect(log).toHaveBeenCalledTimes(2);
    other.element.value = 'ok';
    await flush();
    expect(other.updates).toHaveLength(1);
  });
});
