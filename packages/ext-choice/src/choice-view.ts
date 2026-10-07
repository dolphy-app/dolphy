/** Вид ввода ответа `dolphy.choice`: группа радиокнопок или чекбоксов Vuetify. */
import type { AnswerChange } from '@dolphy-app/extension-api';
import { defineComponent, h, ref, watch } from 'vue';
import type { Component, PropType } from 'vue';
import { VCheckbox, VRadio, VRadioGroup } from 'vuetify/components';
import { normalizeValue } from './choice-model.ts';
import type { ChoiceView } from './grade.ts';

const isChoiceView = (view: unknown): view is ChoiceView =>
  typeof view === 'object' &&
  view !== null &&
  Array.isArray(Reflect.get(view, 'options'));

const unknownProp = { type: null as unknown as PropType<unknown> };

export const ChoiceAnswerView = defineComponent({
  name: 'ChoiceAnswerView',
  props: {
    view: unknownProp,
    value: unknownProp,
    disabled: Boolean,
    verdict: unknownProp,
    label: { type: String as PropType<string | null>, default: null },
  },
  emits: ['change', 'submit'],
  setup(props, { emit }) {
    const sizeOf = () =>
      isChoiceView(props.view) ? props.view.options.length : 0;
    // выбранное остаётся на экране, даже если приложение не вернёт `value`:
    // список меняется только вместе со свойствами `view` и `value`
    const selected = ref(normalizeValue(props.value, sizeOf()));
    watch(
      () => [props.view, props.value],
      () => {
        selected.value = normalizeValue(props.value, sizeOf());
      },
    );
    const choose = (indices: number[]) => {
      selected.value = indices;
      const change: AnswerChange<number[]> = {
        value: indices,
        complete: indices.length > 0,
      };
      emit('change', change);
    };

    return () => {
      const { view } = props;
      if (!isChoiceView(view)) return null;
      const label = props.label ?? undefined;
      if (view.multiple) {
        return h(
          'div',
          { role: 'group', 'aria-label': label, class: 'd-flex flex-column' },
          view.options.map((text, index) =>
            // типы Vuetify не сочетаются с `exactOptionalPropertyTypes` пакета
            h(VCheckbox as Component, {
              key: index,
              modelValue: selected.value,
              'onUpdate:modelValue': (next: number[] | null) => {
                choose([...(next ?? [])].sort((a, b) => a - b));
              },
              value: index,
              label: text,
              disabled: props.disabled,
              hideDetails: true,
            }),
          ),
        );
      }
      return h(
        VRadioGroup as Component,
        {
          modelValue: selected.value[0] ?? null,
          'onUpdate:modelValue': (next: number | null) => {
            if (next !== null) choose([next]);
          },
          disabled: props.disabled,
          'aria-label': label,
          hideDetails: true,
        },
        () =>
          view.options.map((text, index) =>
            h(VRadio as Component, { key: index, value: index, label: text }),
          ),
      );
    };
  },
});
