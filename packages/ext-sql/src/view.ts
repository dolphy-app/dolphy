/** Элемент ввода ответа `lms-sql-answer`; побочный эффект загрузки — регистрация. */
import { ANSWER_EVENT } from '@lms/extension-api';
import type {
  AnswerChangeDetail,
  AnswerElementProps,
} from '@lms/extension-api';

const NAME = 'lms-sql-answer';

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

class SqlAnswer extends HTMLElement implements AnswerElementProps {
  #view: unknown = null;
  #verdict: AnswerElementProps['verdict'] = null;
  readonly #textarea = document.createElement('textarea');

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.#textarea.spellcheck = false;
    this.#textarea.rows = 6;
    this.#textarea.addEventListener('input', () => {
      const { value } = this.#textarea;
      const detail: AnswerChangeDetail = {
        value,
        complete: value.trim().length > 0,
      };
      this.dispatchEvent(
        new CustomEvent(ANSWER_EVENT.change, {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    });
    this.#textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.dispatchEvent(
          new CustomEvent(ANSWER_EVENT.submit, {
            bubbles: true,
            composed: true,
          }),
        );
      }
    });
    root.append(style, this.#textarea);
  }

  static get observedAttributes(): string[] {
    return ['aria-label'];
  }

  attributeChangedCallback(
    name: string,
    _old: string | null,
    next: string | null,
  ) {
    if (name !== 'aria-label') return;
    if (next === null) this.#textarea.removeAttribute('aria-label');
    else this.#textarea.setAttribute('aria-label', next);
  }

  get view(): unknown {
    return this.#view;
  }
  set view(next: unknown) {
    this.#view = next;
  }

  get value(): unknown {
    return this.#textarea.value;
  }
  set value(next: unknown) {
    this.#textarea.value = typeof next === 'string' ? next : '';
  }

  get disabled(): boolean {
    return this.#textarea.disabled;
  }
  set disabled(next: boolean) {
    this.#textarea.disabled = next;
  }

  get verdict(): AnswerElementProps['verdict'] {
    return this.#verdict;
  }
  set verdict(next: AnswerElementProps['verdict']) {
    this.#verdict = next;
  }
}

if (!customElements.get(NAME)) customElements.define(NAME, SqlAnswer);
