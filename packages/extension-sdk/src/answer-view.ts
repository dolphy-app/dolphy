import type { AnswerElementProps } from '@dolphy-app/extension-api';

export interface AnswerViewApi {
  readonly root: ShadowRoot;
  /** `aria-label` хост-элемента, выставленный приложением; `null`, если нет. */
  readonly label: string | null;
  /** Сообщает приложению текущий ответ: событие `dolphy-answer-change`. */
  setAnswer(value: unknown, complete: boolean): void;
  /** Просит приложение отправить ответ: событие `dolphy-answer-submit`. */
  submit(): void;
}

export interface AnswerViewInstance {
  /** Вызывается при изменении `view`/`value`/`disabled`/`verdict`. */
  update(props: AnswerElementProps): void;
  destroy?(): void;
}

export type MountAnswerView = (
  api: AnswerViewApi,
  props: AnswerElementProps,
) => AnswerViewInstance;

/** Описание вида ввода ответа: данные без побочных эффектов, элемент регистрирует сборка. */
export interface AnswerView {
  readonly mount: MountAnswerView;
}

/**
 * Запись `views[<id вида задания>]` в `src/index.ts`. Ничего не регистрирует:
 * custom element с тегом из манифеста определяет браузерный файл сборки.
 */
/*#__NO_SIDE_EFFECTS__*/
export const defineAnswerView = (mount: MountAnswerView): AnswerView => ({
  mount,
});
