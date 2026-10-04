// @vitest-environment happy-dom
import { loadView } from '@dolphy-app/extension-sdk/testing';
import type {
  LoadedView,
  LoadViewOptions,
} from '@dolphy-app/extension-sdk/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { views } from '../src/index.ts';

const loaded: LoadedView[] = [];

const mountView = async (options: LoadViewOptions = {}) => {
  const view = await loadView(views, 'dolphy.js', options);
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

describe('вид dolphy.js', () => {
  it('рисует моноширинное многострочное поле без автоисправлений', async () => {
    const { textarea } = await mountView({ label: 'Ваш код' });
    expect(Number(textarea.rows)).toBeGreaterThanOrEqual(10);
    expect(textarea.spellcheck).toBe(false);
    expect(textarea.getAttribute('autocapitalize')).toBe('off');
    expect(textarea.getAttribute('aria-label')).toBe('Ваш код');
    expect(
      (textarea.getRootNode() as ShadowRoot).querySelector('style')
        ?.textContent,
    ).toContain('monospace');
  });

  it('заполняется заготовкой, когда ответа ещё нет, и не сообщает об этом', async () => {
    const { view, textarea } = await mountView({
      view: { starter: 'function add(a, b) {\n}' },
    });
    expect(textarea.value).toBe('function add(a, b) {\n}');
    expect(view.changes).toEqual([]);
  });

  it('заготовка приходит позже монтирования', async () => {
    const { view, textarea } = await mountView();
    expect(textarea.value).toBe('');
    await view.update({ view: { starter: '// start' } });
    expect(textarea.value).toBe('// start');
  });

  it('уже введённый текст не затирается заготовкой', async () => {
    const { view, textarea } = await mountView();
    type(textarea, 'let x');
    await view.update({ view: { starter: '// start' } });
    expect(textarea.value).toBe('let x');
  });

  it('сохранённый ответ важнее заготовки, пустая строка — тоже ответ', async () => {
    const saved = await mountView({
      view: { starter: '// start' },
      value: 'let a = 1;',
    });
    expect(saved.textarea.value).toBe('let a = 1;');
    const cleared = await mountView({
      view: { starter: '// start' },
      value: '',
    });
    expect(cleared.textarea.value).toBe('');
  });

  it('view без starter даёт пустое поле', async () => {
    const { textarea } = await mountView({ view: {} });
    expect(textarea.value).toBe('');
  });

  it('ввод сообщает текст и complete по непустому после trim', async () => {
    const { view, textarea } = await mountView();
    type(textarea, 'let x');
    type(textarea, ' \n ');
    type(textarea, '');
    expect(view.changes).toEqual([
      { value: 'let x', complete: true },
      { value: ' \n ', complete: false },
      { value: '', complete: false },
    ]);
  });

  it('Tab вставляет два пробела в позицию курсора и сообщает ответ', async () => {
    const { view, textarea } = await mountView();
    textarea.value = 'ab';
    textarea.setSelectionRange(1, 1);
    const event = press(textarea, { key: 'Tab' });
    expect(event.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('a  b');
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);
    expect(view.changes).toEqual([{ value: 'a  b', complete: true }]);
  });

  it('Tab заменяет выделение', async () => {
    const { textarea } = await mountView();
    textarea.value = 'abcd';
    textarea.setSelectionRange(1, 3);
    press(textarea, { key: 'Tab' });
    expect(textarea.value).toBe('a  d');
  });

  it('после Escape Tab покидает поле', async () => {
    const { view, textarea } = await mountView();
    textarea.value = 'ab';
    press(textarea, { key: 'Escape' });
    const event = press(textarea, { key: 'Tab' });
    expect(event.defaultPrevented).toBe(false);
    expect(textarea.value).toBe('ab');
    // и снова вставляет отступ, когда ученик вернулся к вводу
    expect(press(textarea, { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(view.changes).toHaveLength(1);
  });

  it('Shift+Tab и Tab с модификаторами не перехватываются', async () => {
    const { view, textarea } = await mountView();
    for (const init of [
      { key: 'Tab', shiftKey: true },
      { key: 'Tab', ctrlKey: true },
      { key: 'Tab', altKey: true },
      { key: 'Tab', metaKey: true },
    ]) {
      expect(press(textarea, init).defaultPrevented).toBe(false);
    }
    expect(view.changes).toEqual([]);
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

  it('обычный Enter не отправляет', async () => {
    const { view, textarea } = await mountView();
    expect(press(textarea, { key: 'Enter' }).defaultPrevented).toBe(false);
    expect(view.submissions).toBe(0);
  });

  it('value обновляет текст', async () => {
    const { view, textarea } = await mountView({ view: { starter: 's' } });
    await view.update({ value: 'code' });
    expect(textarea.value).toBe('code');
    await view.update({ value: null });
    expect(textarea.value).toBe('s');
  });

  it('disabled блокирует поле, не стирая введённый текст', async () => {
    const { view, textarea } = await mountView({ disabled: true });
    expect(textarea.disabled).toBe(true);
    await view.update({ disabled: false });
    type(textarea, 'let y');
    await view.update({ disabled: true });
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe('let y');
  });

  it('провал помечает поле как недопустимое до следующего ввода', async () => {
    const { view, textarea } = await mountView();
    await view.update({
      verdict: { outcome: 'failed', reason: 'tests_failed' },
    });
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    type(textarea, 'let z');
    expect(textarea.hasAttribute('aria-invalid')).toBe(false);
  });

  it('верный вердикт после провала снимает пометку недопустимого поля', async () => {
    const { view, textarea } = await mountView();
    await view.update({
      verdict: { outcome: 'failed', reason: 'tests_failed' },
    });
    await view.update({ verdict: { outcome: 'passed' } });
    expect(textarea.hasAttribute('aria-invalid')).toBe(false);
  });
});
