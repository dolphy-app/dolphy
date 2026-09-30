/** Элемент ввода ответа `lms-choice-answer`; побочный эффект загрузки — регистрация. */
import { ANSWER_EVENT } from '@lms/extension-api';
import type {
  AnswerChangeDetail,
  AnswerElementProps,
} from '@lms/extension-api';
import { normalizeValue, selectedIndices } from './choice-model.ts';
import type { ChoiceView } from './grade.ts';

const NAME = 'lms-choice-answer';

const STYLE = `
  :host { display: block; }
  fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 4px; }
  label {
    display: flex; gap: 8px; align-items: center; padding: 6px 8px;
    border-radius: 4px; color: rgb(var(--v-theme-on-surface)); cursor: pointer;
  }
  label:hover { background: rgba(var(--v-theme-on-surface), 0.06); }
  input:disabled + span { opacity: 0.6; }
`;

const isChoiceView = (view: unknown): view is ChoiceView =>
  typeof view === 'object' &&
  view !== null &&
  Array.isArray((view as ChoiceView).options);

class ChoiceAnswer extends HTMLElement implements AnswerElementProps {
  #view: unknown = null;
  #value: unknown = undefined;
  #disabled = false;
  #verdict: AnswerElementProps['verdict'] = null;
  readonly #root = this.attachShadow({ mode: 'open' });

  connectedCallback(): void {
    this.setAttribute('role', 'group');
    this.#render();
  }

  static get observedAttributes(): string[] {
    return ['aria-label'];
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  get view(): unknown {
    return this.#view;
  }
  set view(next: unknown) {
    this.#view = next;
    this.#render();
  }

  get value(): unknown {
    return this.#value;
  }
  set value(next: unknown) {
    this.#value = next;
    this.#render();
  }

  get disabled(): boolean {
    return this.#disabled;
  }
  set disabled(next: boolean) {
    this.#disabled = next;
    for (const input of this.#root.querySelectorAll('input')) {
      input.disabled = next;
    }
  }

  get verdict(): AnswerElementProps['verdict'] {
    return this.#verdict;
  }
  set verdict(next: AnswerElementProps['verdict']) {
    this.#verdict = next;
  }

  #render(): void {
    const view = this.#view;
    if (!isChoiceView(view)) {
      this.#root.replaceChildren();
      return;
    }
    const selected = new Set(normalizeValue(this.#value, view.options.length));
    const style = document.createElement('style');
    style.textContent = STYLE;
    const fieldset = document.createElement('fieldset');
    const label = this.getAttribute('aria-label');
    if (label !== null) fieldset.setAttribute('aria-label', label);
    const name = `choice-${Math.random().toString(36).slice(2)}`;
    view.options.forEach((text, index) => {
      const row = document.createElement('label');
      const input = document.createElement('input');
      input.type = view.multiple ? 'checkbox' : 'radio';
      input.name = name;
      input.checked = selected.has(index);
      input.disabled = this.#disabled;
      input.addEventListener('change', () => this.#emit(fieldset));
      const caption = document.createElement('span');
      caption.textContent = text;
      row.append(input, caption);
      fieldset.append(row);
    });
    this.#root.replaceChildren(style, fieldset);
  }

  #emit(fieldset: HTMLFieldSetElement): void {
    const inputs = [...fieldset.querySelectorAll('input')];
    const value = selectedIndices(inputs.map((input) => input.checked));
    this.#value = value;
    const detail: AnswerChangeDetail = { value, complete: value.length > 0 };
    this.dispatchEvent(
      new CustomEvent(ANSWER_EVENT.change, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get(NAME)) customElements.define(NAME, ChoiceAnswer);
