/** Элемент ввода ответа `lms-sql-answer`; побочный эффект загрузки — регистрация. */
import { defineAnswerElement } from '@lms/extension-sdk';

const STYLE = `
  :host { display: block; }
  textarea {
    box-sizing: border-box;
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: rgb(var(--v-theme-on-surface));
    background: rgb(var(--v-theme-surface));
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
    padding: 8px;
  }
`;

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

defineAnswerElement('lms-sql-answer', (api, initial) => {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const textarea = document.createElement('textarea');
  textarea.spellcheck = false;
  textarea.rows = 6;
  if (api.label !== null) textarea.setAttribute('aria-label', api.label);
  // значение свойства применяется только при его смене: приложение может не
  // возвращать введённый текст, и обновление `disabled` не должно его стирать
  const state = { value: initial.value };
  textarea.value = toText(initial.value);
  textarea.disabled = initial.disabled;

  textarea.addEventListener('input', () => {
    api.setAnswer(textarea.value, textarea.value.trim().length > 0);
  });
  textarea.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      api.submit();
    }
  });
  api.root.append(style, textarea);

  return {
    update: (props) => {
      if (props.value !== state.value) {
        state.value = props.value;
        textarea.value = toText(props.value);
      }
      textarea.disabled = props.disabled;
    },
  };
});
