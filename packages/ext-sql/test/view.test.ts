// @vitest-environment happy-dom
import { ANSWER_EVENT } from '@spirula-app/extension-api';
import type { AnswerChangeDetail } from '@spirula-app/extension-api';
import { afterEach, describe, expect, it } from 'vitest';
import '../src/view.ts';

interface SqlElement extends HTMLElement {
  view: unknown;
  value: unknown;
  disabled: boolean;
}

const flush = () => Promise.resolve();

const mountElement = async (label: string | null = null) => {
  const element = document.createElement('spirula-sql-answer') as SqlElement;
  if (label !== null) element.setAttribute('aria-label', label);
  document.body.append(element);
  await flush();
  const changes: AnswerChangeDetail[] = [];
  const submits: Event[] = [];
  element.addEventListener(ANSWER_EVENT.change, (event) => {
    changes.push((event as CustomEvent<AnswerChangeDetail>).detail);
  });
  element.addEventListener(ANSWER_EVENT.submit, (event) => {
    submits.push(event);
  });
  const textarea = element.shadowRoot?.querySelector('textarea');
  if (!textarea) throw new Error('textarea is not rendered');
  return { element, changes, submits, textarea };
};

const type = (textarea: HTMLTextAreaElement, text: string) => {
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
};

const press = (
  textarea: HTMLTextAreaElement,
  init: KeyboardEventInit,
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    cancelable: true,
    bubbles: true,
    ...init,
  });
  textarea.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('spirula-sql-answer', () => {
  it('рисует textarea без проверки орфографии', async () => {
    const { textarea } = await mountElement();
    expect(textarea.spellcheck).toBe(false);
  });

  it('ввод сообщает текст и complete', async () => {
    const { textarea, changes } = await mountElement();
    type(textarea, 'select 1');
    type(textarea, '   ');
    type(textarea, '');
    expect(changes).toEqual([
      { value: 'select 1', complete: true },
      { value: '   ', complete: false },
      { value: '', complete: false },
    ]);
  });

  it.each([
    ['Ctrl+Enter', { key: 'Enter', ctrlKey: true }],
    ['Cmd+Enter', { key: 'Enter', metaKey: true }],
  ])('%s отправляет ответ и гасит перевод строки', async (_name, init) => {
    const { textarea, submits } = await mountElement();
    const event = press(textarea, init);
    expect(submits).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('обычный Enter и другие сочетания не отправляют', async () => {
    const { textarea, submits } = await mountElement();
    expect(press(textarea, { key: 'Enter' }).defaultPrevented).toBe(false);
    press(textarea, { key: 'a', ctrlKey: true });
    expect(submits).toEqual([]);
  });

  it('value задаёт текст, нестрока даёт пустой текст', async () => {
    const { element, textarea } = await mountElement();
    element.value = 'select 2';
    await flush();
    expect(textarea.value).toBe('select 2');
    element.value = null;
    await flush();
    expect(textarea.value).toBe('');
  });

  it('disabled блокирует textarea, не стирая введённый текст', async () => {
    const { element, textarea } = await mountElement();
    type(textarea, 'select 3');
    element.disabled = true;
    await flush();
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe('select 3');
    element.disabled = false;
    await flush();
    expect(textarea.disabled).toBe(false);
  });

  it('aria-label хоста попадает на textarea', async () => {
    const { textarea } = await mountElement('Ваш SQL');
    expect(textarea.getAttribute('aria-label')).toBe('Ваш SQL');
  });
});
