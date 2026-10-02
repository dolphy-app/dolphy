import type { AnswerElementProps } from '@dolphy-app/extension-api';

export interface AnswerViewApi {
  readonly root: ShadowRoot;
  /** `aria-label` of the host element set by the app; `null` if none. */
  readonly label: string | null;
  /** Reports the current answer to the app: the `dolphy-answer-change` event. */
  setAnswer(value: unknown, complete: boolean): void;
  /** Asks the app to submit the answer: the `dolphy-answer-submit` event. */
  submit(): void;
}

export interface AnswerViewInstance {
  /** Called when `view`/`value`/`disabled`/`verdict` change. */
  update(props: AnswerElementProps): void;
  destroy?(): void;
}

export type MountAnswerView = (
  api: AnswerViewApi,
  props: AnswerElementProps,
) => AnswerViewInstance;

/** Description of an answer input view: side-effect-free data; the build registers the element. */
export interface AnswerView {
  readonly mount: MountAnswerView;
}

/**
 * Entry `views[<exercise kind id>]` in `src/index.ts`. Registers nothing:
 * the custom element with the manifest tag is defined by the build's browser file.
 */
/*#__NO_SIDE_EFFECTS__*/
export const defineAnswerView = (mount: MountAnswerView): AnswerView => ({
  mount,
});
