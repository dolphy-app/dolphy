/**
 * Вид ввода ответа `dolphy.js`: многострочное моноширинное поле в теневом корне
 * элемента. Подсветка — слой `pre` поверх прозрачного текста `textarea`: ввод,
 * выделение и каретку ведёт сам браузер, а слой только раскрашивает тот же
 * текст с теми же метриками. Цвета — `--sh-*` с корня приложения (палитра из
 * текущей темы), они наследуются через границу теневого DOM.
 */
import type { MountAnswerView } from '@dolphy-app/extension-sdk';
import { highlightJs } from './highlight.ts';

const INDENT = '  ';

const STYLE = `
  :host { display: block; }
  .editor { position: relative; }
  textarea, .mirror {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9rem;
    line-height: 1.45;
    letter-spacing: normal;
    font-variant-ligatures: none;
    tab-size: 2;
    white-space: pre;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 4px;
  }
  textarea {
    display: block;
    resize: vertical;
    overflow: auto;
    color: transparent;
    caret-color: rgb(var(--v-theme-on-surface));
    background: rgb(var(--v-theme-surface));
    border-color: rgba(var(--v-border-color), var(--v-border-opacity));
  }
  textarea::selection {
    color: transparent;
    background: rgba(var(--v-theme-primary), 0.3);
  }
  textarea[aria-invalid='true'] { border-color: rgb(var(--v-theme-error)); }
  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: rgb(var(--v-theme-on-surface));
  }
  /* запас под полосы прокрутки поля: слою нужно доехать до тех же смещений */
  .mirror code {
    display: inline-block;
    min-width: 100%;
    padding: 0 24px 24px 0;
    font: inherit;
  }
  .editor[data-disabled] .mirror { opacity: 0.6; }
  .sh__token--keyword { color: var(--sh-keyword, currentColor); }
  .sh__token--string { color: var(--sh-string, currentColor); }
  .sh__token--class { color: var(--sh-class, currentColor); }
  .sh__token--property { color: var(--sh-property, currentColor); }
  .sh__token--entity { color: var(--sh-entity, currentColor); }
  .sh__token--comment {
    color: var(--sh-comment, currentColor);
    font-style: italic;
  }
  /* системные цвета перекрывают подсветку: слой не нужен, текст рисует поле */
  @media (forced-colors: active) {
    .mirror { display: none; }
    textarea { color: CanvasText; }
  }
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
  const editor = document.createElement('div');
  editor.className = 'editor';
  const mirror = document.createElement('pre');
  mirror.className = 'mirror';
  mirror.setAttribute('aria-hidden', 'true');
  const mirrorCode = document.createElement('code');
  mirror.append(mirrorCode);
  editor.append(textarea, mirror);

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
  editor.toggleAttribute('data-disabled', initial.disabled);

  const syncScroll = () => {
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  };
  // пробел в конце: пустая последняя строка поля занимает место и в слое
  const paint = () => {
    const html = highlightJs(textarea.value);
    if (html === null) mirrorCode.textContent = `${textarea.value} `;
    else mirrorCode.innerHTML = `${html} `;
    syncScroll();
  };
  paint();

  const report = () => {
    paint();
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
  textarea.addEventListener('scroll', syncScroll, { passive: true });
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
  api.root.append(style, editor);

  return {
    update: (props) => {
      if (props.value !== state.value) {
        state.value = props.value;
        state.view = props.view;
        textarea.value = initialText(props.value, props.view);
        paint();
      } else if (props.view !== state.view) {
        state.view = props.view;
        if (!state.isTyped && typeof props.value !== 'string') {
          textarea.value = starterOf(props.view);
          paint();
        }
      }
      textarea.disabled = props.disabled;
      editor.toggleAttribute('data-disabled', props.disabled);
      if (props.verdict?.outcome === 'failed') {
        textarea.setAttribute('aria-invalid', 'true');
      } else {
        textarea.removeAttribute('aria-invalid');
      }
    },
  };
};
