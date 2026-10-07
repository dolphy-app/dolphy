/**
 * Вид ввода ответа `dolphy.js`: многострочное моноширинное поле. Подсветка —
 * слой `pre` поверх прозрачного текста `textarea`: ввод, выделение и каретку
 * ведёт сам браузер, а слой только раскрашивает тот же текст с теми же
 * метриками. Цвета — `--sh-*` с корня приложения (палитра из текущей темы),
 * `--v-theme-*` даёт тема Vuetify окна.
 */
import type { AnswerChange, AnswerVerdict } from '@dolphy-app/extension-api';
import { defineComponent, h, onUpdated, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { highlightJs } from './highlight.ts';

const INDENT = '  ';

const STYLE = `
  .dolphy-js-editor { position: relative; }
  .dolphy-js-editor textarea, .dolphy-js-editor .mirror {
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
  .dolphy-js-editor textarea {
    display: block;
    resize: vertical;
    overflow: auto;
    color: transparent;
    caret-color: rgb(var(--v-theme-on-surface));
    background: rgb(var(--v-theme-surface));
    border-color: rgba(var(--v-border-color), var(--v-border-opacity));
  }
  .dolphy-js-editor textarea::selection {
    color: transparent;
    background: rgba(var(--v-theme-primary), 0.3);
  }
  .dolphy-js-editor textarea[aria-invalid='true'] { border-color: rgb(var(--v-theme-error)); }
  .dolphy-js-editor .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: rgb(var(--v-theme-on-surface));
  }
  /* запас под полосы прокрутки поля: слою нужно доехать до тех же смещений */
  .dolphy-js-editor .mirror code {
    display: inline-block;
    min-width: 100%;
    padding: 0 24px 24px 0;
    font: inherit;
  }
  .dolphy-js-editor[data-disabled] .mirror { opacity: 0.6; }
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
    .dolphy-js-editor .mirror { display: none; }
    .dolphy-js-editor textarea { color: CanvasText; }
  }
`;

const toText = (value: unknown) => (typeof value === 'string' ? value : '');

const starterOf = (view: unknown): string =>
  typeof view === 'object' && view !== null
    ? toText(Reflect.get(view, 'starter'))
    : '';

// ответа ещё нет — поле заполняет заготовка из `spec.starter`
const initialText = (value: unknown, view: unknown) =>
  typeof value === 'string' ? value : starterOf(view);

const unknownProp = { type: null as unknown as PropType<unknown> };

export const JsAnswerView = defineComponent({
  name: 'JsAnswerView',
  props: {
    view: unknownProp,
    value: unknownProp,
    disabled: Boolean,
    verdict: { type: Object as PropType<AnswerVerdict | null>, default: null },
    label: { type: String as PropType<string | null>, default: null },
  },
  emits: ['change', 'submit'],
  setup(props, { emit }) {
    const textarea = ref<HTMLTextAreaElement | null>(null);
    const mirror = ref<HTMLElement | null>(null);
    const text = ref(initialText(props.value, props.view));
    // `isTyped` — ученик уже менял текст, заготовку поверх него не кладём;
    // после Escape следующий Tab покидает поле (иначе фокус не уйти с клавиатуры)
    const state = { isTyped: false, isTabEscape: false };
    const isInvalid = ref(props.verdict?.outcome === 'failed');

    // значение и `view` применяются только со сменой свойств: приложение
    // может не возвращать ответ, и обновление не должно его стирать
    watch(
      () => props.value,
      (value) => {
        text.value = initialText(value, props.view);
      },
    );
    watch(
      () => props.view,
      (view) => {
        if (!state.isTyped && typeof props.value !== 'string') {
          text.value = starterOf(view);
        }
      },
    );
    watch(
      () => props.verdict,
      (verdict) => {
        isInvalid.value = verdict?.outcome === 'failed';
      },
    );

    const syncScroll = () => {
      if (!textarea.value || !mirror.value) return;
      mirror.value.scrollTop = textarea.value.scrollTop;
      mirror.value.scrollLeft = textarea.value.scrollLeft;
    };
    onUpdated(syncScroll);

    const report = (next: string) => {
      text.value = next;
      state.isTyped = true;
      isInvalid.value = false;
      const change: AnswerChange<string> = {
        value: next,
        complete: next.trim().length > 0,
      };
      emit('change', change);
    };

    const insertIndent = (field: HTMLTextAreaElement) => {
      const { selectionStart: start, selectionEnd: end, value } = field;
      field.value = `${value.slice(0, start)}${INDENT}${value.slice(end)}`;
      const caret = start + INDENT.length;
      field.setSelectionRange(caret, caret);
      report(field.value);
    };

    const onKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        emit('submit');
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
        if (textarea.value) insertIndent(textarea.value);
        return;
      }
      state.isTabEscape = false;
    };

    return () => {
      // пробел в конце: пустая последняя строка поля занимает место и в слое
      const html = highlightJs(text.value);
      const code =
        html === null
          ? h('code', `${text.value} `)
          : h('code', { innerHTML: `${html} ` });
      return h(
        'div',
        {
          class: 'dolphy-js-editor',
          'data-disabled': props.disabled ? '' : undefined,
        },
        [
          h('style', STYLE),
          h('textarea', {
            ref: textarea,
            value: text.value,
            rows: 12,
            wrap: 'off',
            spellcheck: false,
            autocapitalize: 'off',
            autocomplete: 'off',
            autocorrect: 'off',
            disabled: props.disabled,
            'aria-label': props.label ?? undefined,
            'aria-invalid': isInvalid.value ? 'true' : undefined,
            onInput: () => {
              if (textarea.value) report(textarea.value.value);
            },
            onScroll: syncScroll,
            onKeydown,
            onBlur: () => {
              state.isTabEscape = false;
            },
          }),
          h('pre', { ref: mirror, class: 'mirror', 'aria-hidden': 'true' }, [
            code,
          ]),
        ],
      );
    };
  },
});
