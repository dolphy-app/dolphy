/** Вид ввода ответа `dolphy.choice`: группа радиокнопок или чекбоксов Vuetify в теневом корне элемента. */
import type { AnswerViewApi, MountAnswerView } from '@dolphy-app/extension-sdk';
import {
  mountCheckboxGroup,
  mountRadioGroup,
} from '@dolphy-app/extension-ui/vuetify/choice';
import type { ChoiceItem } from '@dolphy-app/extension-ui/vuetify/choice';
import { normalizeValue } from './choice-model.ts';
import type { ChoiceView } from './grade.ts';

const isChoiceView = (view: unknown): view is ChoiceView =>
  typeof view === 'object' &&
  view !== null &&
  Array.isArray((view as ChoiceView).options);

/** Смонтированная группа: выбор — список индексов, независимо от радио или чекбоксов. */
interface Group {
  select(indices: readonly number[]): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

const mountGroup = (
  api: AnswerViewApi,
  container: Element,
  view: ChoiceView,
  initial: { selected: readonly number[]; disabled: boolean },
): Group => {
  const items: ChoiceItem<number>[] = view.options.map((label, value) => ({
    value,
    label,
  }));
  const common = { items, label: api.label, disabled: initial.disabled };
  // выбранное остаётся на экране, даже если приложение не вернёт `value`
  if (view.multiple) {
    const group = mountCheckboxGroup<number>(container, {
      ...common,
      value: [...initial.selected],
      onChange: (next) => {
        const value = [...next].sort((a, b) => a - b);
        group.update({ value });
        api.setAnswer(value, value.length > 0);
      },
    });
    return {
      select: (indices) => group.update({ value: [...indices] }),
      setDisabled: (disabled) => group.update({ disabled }),
      destroy: group.destroy,
    };
  }
  const group = mountRadioGroup<number>(container, {
    ...common,
    value: initial.selected[0] ?? null,
    onChange: (value) => {
      group.update({ value });
      api.setAnswer([value], true);
    },
  });
  return {
    select: (indices) => group.update({ value: indices[0] ?? null }),
    setDisabled: (disabled) => group.update({ disabled }),
    destroy: group.destroy,
  };
};

export const mountChoice: MountAnswerView = (api, initial) => {
  const container = document.createElement('div');
  api.root.append(container);

  const state = {
    view: undefined as unknown,
    // последнее значение свойства `value`, а не введённое пользователем:
    // приложение может не возвращать ответ, и он не должен стираться
    value: undefined as unknown,
    disabled: false,
    group: null as Group | null,
  };

  const remount = (view: unknown) => {
    state.group?.destroy();
    state.group = null;
    if (!isChoiceView(view)) return;
    state.group = mountGroup(api, container, view, {
      selected: normalizeValue(state.value, view.options.length),
      disabled: state.disabled,
    });
  };

  const update = (props: {
    view: unknown;
    value: unknown;
    disabled: boolean;
  }) => {
    state.disabled = props.disabled;
    if (props.view !== state.view) {
      state.view = props.view;
      state.value = props.value;
      remount(props.view);
      return;
    }
    if (props.value !== state.value) {
      state.value = props.value;
      if (isChoiceView(state.view)) {
        state.group?.select(
          normalizeValue(props.value, state.view.options.length),
        );
      }
    }
    state.group?.setDisabled(props.disabled);
  };

  update(initial);
  return { update, destroy: () => state.group?.destroy() };
};
