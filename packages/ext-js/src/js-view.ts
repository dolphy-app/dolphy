/** Вид ввода ответа `dolphy.js`: многострочное моноширинное поле в теневом корне элемента. */
import type { MountAnswerView } from '@dolphy-app/extension-sdk';

const INDENT = '  ';

const STYLE = `
  :host { display: block; }
  textarea {
    box-sizing: border-box;
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9rem;
    line-height: 1.45;
    tab-size: 2;
    resize: vertical;
    color: rgb(var(--v-theme-on-surface));
    background: rgb(var(--v-theme-surface));
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
    padding: 8px;
  }
  textarea[aria-invalid='true'] { border-color: rgb(var(--v-theme-error)); }
`;

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

const starterOf = (view: unknown): string =>
  typeof view === 'object' && view !== null
    ? toText(Reflect.get(view, 'starter'))
    : '';

export const mountJsEditor: MountAnswerView = (api, initial) => {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const textarea = document.createElement('textarea');
  textarea.spellcheck = false;
  textarea.rows = 12;
  textarea.wrap = 'off';
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  if (api.label !== null) textarea.setAttribute('aria-label', api.label);

  // `value` и `view` — последние значения свойств, а не введённый текст:
  // приложение может не возвращать ответ, и обновление не должно его стирать;
  // `isTyped` — ученик уже менял текст, заготовку поверх него не кладём
  const state = {
    value: initial.value,
    view: initial.view,
    isTyped: false,
    // после Escape следующий Tab покидает поле (иначе фокус не уйти с клавиатуры)
    isTabEscape: false,
  };
  // ответа ещё нет — поле заполняет заготовка из `spec.starter`
  const initialText = (value: unknown, view: unknown) =>
    typeof value === 'string' ? value : starterOf(view);
  textarea.value = initialText(initial.value, initial.view);
  textarea.disabled = initial.disabled;

  const report = () => {
    state.isTyped = true;
    textarea.removeAttribute('aria-invalid');
    api.setAnswer(textarea.value, textarea.value.trim().length > 0);
  };

  const insertIndent = () => {
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    textarea.value = `${value.slice(0, start)}${INDENT}${value.slice(end)}`;
    const caret = start + INDENT.length;
    textarea.setSelectionRange(caret, caret);
    report();
  };

  textarea.addEventListener('input', report);
  textarea.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      api.submit();
      return;
    }
    if (event.key === 'Escape') {
      state.isTabEscape = true;
      return;
    }
    const isPlainTab =
      event.key === 'Tab' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing;
    if (isPlainTab && !state.isTabEscape) {
      event.preventDefault();
      insertIndent();
      return;
    }
    state.isTabEscape = false;
  });
  textarea.addEventListener('blur', () => {
    state.isTabEscape = false;
  });
  api.root.append(style, textarea);

  return {
    update: (props) => {
      if (props.value !== state.value) {
        state.value = props.value;
        state.view = props.view;
        textarea.value = initialText(props.value, props.view);
      } else if (props.view !== state.view) {
        state.view = props.view;
        if (!state.isTyped && typeof props.value !== 'string') {
          textarea.value = starterOf(props.view);
        }
      }
      textarea.disabled = props.disabled;
      if (props.verdict?.outcome === 'failed') {
        textarea.setAttribute('aria-invalid', 'true');
      } else {
        textarea.removeAttribute('aria-invalid');
      }
    },
  };
};
