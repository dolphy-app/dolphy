// @vitest-environment happy-dom
import { loadView } from '@dolphy-app/extension-sdk/testing';
import type { LoadedView } from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { views } from '../src/index.ts';

const loaded: LoadedView[] = [];

const mountView = async (label?: string) => {
  const view = await loadView(views, 'dolphy.sql', {
    ...(label === undefined ? {} : { label }),
  });
  loaded.push(view);
  const textarea = view.query<HTMLTextAreaElement>('textarea');
  if (!textarea) throw new Error('textarea is not rendered');
  return { view, textarea };
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
  for (const view of loaded.splice(0)) view.dispose();
});

describe('вид dolphy.sql', () => {
  it('рисует textarea без проверки орфографии', async () => {
    const { textarea } = await mountView();
    expect(textarea.spellcheck).toBe(false);
  });

  it('ввод сообщает текст и complete', async () => {
    const { view, textarea } = await mountView();
    type(textarea, 'select 1');
    type(textarea, '   ');
    type(textarea, '');
    expect(view.changes).toEqual([
      { value: 'select 1', complete: true },
      { value: '   ', complete: false },
      { value: '', complete: false },
    ]);
  });

  it.each([
    ['Ctrl+Enter', { key: 'Enter', ctrlKey: true }],
    ['Cmd+Enter', { key: 'Enter', metaKey: true }],
  ])('%s отправляет ответ и гасит перевод строки', async (_name, init) => {
    const { view, textarea } = await mountView();
    const event = press(textarea, init);
    expect(view.submissions).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('обычный Enter и другие сочетания не отправляют', async () => {
    const { view, textarea } = await mountView();
    expect(press(textarea, { key: 'Enter' }).defaultPrevented).toBe(false);
    press(textarea, { key: 'a', ctrlKey: true });
    expect(view.submissions).toBe(0);
  });

  it('value задаёт текст, нестрока даёт пустой текст', async () => {
    const { view, textarea } = await mountView();
    await view.update({ value: 'select 2' });
    expect(textarea.value).toBe('select 2');
    await view.update({ value: null });
    expect(textarea.value).toBe('');
  });

  it('disabled блокирует textarea, не стирая введённый текст', async () => {
    const { view, textarea } = await mountView();
    type(textarea, 'select 3');
    await view.update({ disabled: true });
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe('select 3');
    await view.update({ disabled: false });
    expect(textarea.disabled).toBe(false);
  });

  it('aria-label хоста попадает на textarea', async () => {
    const { textarea } = await mountView('Ваш SQL');
    expect(textarea.getAttribute('aria-label')).toBe('Ваш SQL');
  });
});
