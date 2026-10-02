import {
  ANSWER_EVENT,
  ELEMENT_NAME_PATTERN,
  type AnswerChangeDetail,
  type AnswerElementProps,
} from '@dolphy-app/extension-api';
import type {
  AnswerView,
  AnswerViewApi,
  AnswerViewInstance,
} from './answer-view.ts';

const logFailure = (tag: string, message: string, error: unknown) => {
  console.error({ error, tag }, message);
};

export const createAnswerElementClass = (tag: string, answerView: AnswerView) =>
  class AnswerElement extends HTMLElement {
    #root = this.attachShadow({ mode: 'open' });
    #props: AnswerElementProps = {
      view: undefined,
      value: undefined,
      disabled: false,
      verdict: null,
    };
    #instance: AnswerViewInstance | null = null;
    #isFlushScheduled = false;

    get view(): AnswerElementProps['view'] {
      return this.#props.view;
    }
    set view(view: AnswerElementProps['view']) {
      this.#change({ view });
    }

    get value(): AnswerElementProps['value'] {
      return this.#props.value;
    }
    set value(value: AnswerElementProps['value']) {
      this.#change({ value });
    }

    get disabled(): boolean {
      return this.#props.disabled;
    }
    set disabled(disabled: boolean) {
      this.#change({ disabled });
    }

    get verdict(): AnswerElementProps['verdict'] {
      return this.#props.verdict;
    }
    set verdict(verdict: AnswerElementProps['verdict']) {
      this.#change({ verdict });
    }

    connectedCallback() {
      if (this.#instance !== null) return;
      const readLabel = () => this.getAttribute('aria-label');
      const api: AnswerViewApi = {
        root: this.#root,
        get label() {
          return readLabel();
        },
        setAnswer: (value, complete) => {
          const detail: AnswerChangeDetail = { value, complete };
          this.#emit(ANSWER_EVENT.change, detail);
        },
        submit: () => this.#emit(ANSWER_EVENT.submit, undefined),
      };
      try {
        this.#instance = answerView.mount(
          api,
          Object.freeze({ ...this.#props }),
        );
      } catch (error) {
        logFailure(tag, 'answer element failed to mount', error);
      }
    }

    disconnectedCallback() {
      const instance = this.#instance;
      this.#instance = null;
      if (instance === null) return;
      try {
        instance.destroy?.();
      } catch (error) {
        logFailure(tag, 'answer element failed to destroy', error);
      }
      this.#root.replaceChildren();
    }

    #change(patch: Partial<AnswerElementProps>) {
      this.#props = { ...this.#props, ...patch };
      if (this.#instance === null || this.#isFlushScheduled) return;
      this.#isFlushScheduled = true;
      queueMicrotask(() => this.#flush());
    }

    #flush() {
      this.#isFlushScheduled = false;
      const instance = this.#instance;
      if (instance === null) return;
      try {
        instance.update(Object.freeze({ ...this.#props }));
      } catch (error) {
        logFailure(tag, 'answer element failed to update', error);
      }
    }

    #emit(name: string, detail: unknown) {
      this.dispatchEvent(
        new CustomEvent(name, { detail, bubbles: true, composed: true }),
      );
    }
  };

/** Определяет custom element вида; повторный вызов с тем же тегом ничего не меняет. */
export const registerAnswerView = (tag: string, view: AnswerView): void => {
  if (!ELEMENT_NAME_PATTERN.test(tag)) {
    throw new TypeError(`invalid custom element name '${tag}'`);
  }
  if (typeof view?.mount !== 'function') {
    throw new TypeError(`answer view for '${tag}' has no mount()`);
  }
  if (customElements.get(tag) !== undefined) return;
  customElements.define(tag, createAnswerElementClass(tag, view));
};
