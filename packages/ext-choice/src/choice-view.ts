/** Вид ввода ответа `dolphy.choice`: радиокнопки или чекбоксы в теневом корне элемента. */
import type { AnswerViewApi } from '@dolphy-app/extension-sdk';
import { normalizeValue, selectedIndices } from './choice-model.ts';
import type { ChoiceView } from './grade.ts';

const STYLE = `
  :host { display: block; }
  fieldset {
    border: 0; margin: 0; padding: 0; min-width: 0;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px;
  }
  label {
    display: flex; gap: 8px; align-items: center; padding: 6px 8px;
    border-radius: 4px; color: rgb(var(--v-theme-on-surface)); cursor: pointer;
  }
  label:hover:not(:has(input:disabled)),
  label:has(input:focus-visible) {
    background: rgba(var(--v-theme-on-surface), 0.06);
  }
  label:has(input:disabled) { cursor: default; }
  input { accent-color: rgb(var(--v-theme-primary)); flex: none; }
  span { min-width: 0; overflow-wrap: anywhere; }
  input:disabled + span { opacity: 0.6; }
`;

const isChoiceView = (view: unknown): view is ChoiceView =>
  typeof view === 'object' &&
  view !== null &&
  Array.isArray((view as ChoiceView).options);

const createRow = (text: string, multiple: boolean) => {
  const row = document.createElement('label');
  const input = document.createElement('input');
  input.type = multiple ? 'checkbox' : 'radio';
  input.name = 'choice';
  const caption = document.createElement('span');
  caption.textContent = text;
  row.append(input, caption);
  return { row, input };
};

export const mountChoice = (
  api: AnswerViewApi,
  initial: { view: unknown; value: unknown; disabled: boolean },
) => {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const fieldset = document.createElement('fieldset');
  if (api.label !== null) fieldset.setAttribute('aria-label', api.label);
  api.root.append(style, fieldset);

  const state = {
    view: undefined as unknown,
    // последнее значение свойства `value`, а не введённое пользователем:
    // приложение может не возвращать ответ, и он не должен стираться
    value: undefined as unknown,
    disabled: false,
    inputs: [] as HTMLInputElement[],
  };

  const applyValue = (value: unknown) => {
    const selected = new Set(normalizeValue(value, state.inputs.length));
    state.inputs.forEach((input, index) => {
      input.checked = selected.has(index);
    });
  };

  const applyDisabled = (disabled: boolean) => {
    for (const input of state.inputs) input.disabled = disabled;
  };

  const emit = () => {
    const value = selectedIndices(state.inputs.map((input) => input.checked));
    api.setAnswer(value, value.length > 0);
  };

  const renderOptions = (view: unknown) => {
    const rows = isChoiceView(view)
      ? view.options.map((text) => createRow(text, view.multiple))
      : [];
    for (const { input } of rows) input.addEventListener('change', emit);
    state.inputs = rows.map(({ input }) => input);
    fieldset.replaceChildren(...rows.map(({ row }) => row));
  };

  const update = (props: {
    view: unknown;
    value: unknown;
    disabled: boolean;
  }) => {
    const isViewChanged = props.view !== state.view;
    if (isViewChanged) {
      state.view = props.view;
      renderOptions(props.view);
    }
    if (isViewChanged || props.value !== state.value) {
      state.value = props.value;
      applyValue(props.value);
    }
    if (isViewChanged || props.disabled !== state.disabled) {
      state.disabled = props.disabled;
      applyDisabled(props.disabled);
    }
  };

  update(initial);
  return { update };
};
