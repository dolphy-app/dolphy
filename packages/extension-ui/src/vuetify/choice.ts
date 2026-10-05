/** Groups of radio buttons and checkboxes: `VRadioGroup` and `VCheckbox` of Vuetify. */
import { h } from 'vue';
import type { Component, FunctionalComponent } from 'vue';
import { VCheckbox } from 'vuetify/components/VCheckbox';
import { VRadio } from 'vuetify/components/VRadio';
import { VRadioGroup } from 'vuetify/components/VRadioGroup';
import { mountComponent } from './mount.ts';
import type { Mounted } from './mount.ts';

export interface ChoiceItem<Value extends string | number = string | number> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface ChoiceGroupProps<Value extends string | number> {
  items: readonly ChoiceItem<Value>[];
  /** The accessible name of the group. */
  label?: string | null;
  disabled?: boolean;
  /** Shown as an invalid group (a wrong answer of a checked exercise). */
  error?: boolean;
}

export interface RadioGroupProps<
  Value extends string | number = string | number,
> extends ChoiceGroupProps<Value> {
  value: Value | null;
  onChange(value: Value): void;
}

export interface CheckboxGroupProps<
  Value extends string | number = string | number,
> extends ChoiceGroupProps<Value> {
  value: readonly Value[];
  onChange(value: Value[]): void;
}

const GROUP_KEYS = ['items', 'label', 'disabled', 'error', 'value', 'onChange'];

const RadioGroupView: FunctionalComponent<RadioGroupProps> = (props) =>
  h(
    VRadioGroup as Component,
    {
      modelValue: props.value,
      'onUpdate:modelValue': (value: string | number | null) => {
        if (value !== null) props.onChange(value);
      },
      disabled: props.disabled === true,
      error: props.error === true,
      'aria-label': props.label ?? undefined,
      hideDetails: true,
    },
    () =>
      props.items.map((item) =>
        h(VRadio as Component, {
          key: item.value,
          value: item.value,
          label: item.label,
          // an explicit `false` would override the `disabled` of the whole group
          disabled: item.disabled === true ? true : undefined,
        }),
      ),
  );
RadioGroupView.props = GROUP_KEYS;

const CheckboxGroupView: FunctionalComponent<CheckboxGroupProps> = (props) =>
  h(
    'div',
    {
      role: 'group',
      'aria-label': props.label ?? undefined,
      class: 'd-flex flex-column',
    },
    props.items.map((item) =>
      h(VCheckbox as Component, {
        key: item.value,
        modelValue: [...props.value],
        'onUpdate:modelValue': (value: (string | number)[] | null) => {
          props.onChange(value ?? []);
        },
        value: item.value,
        label: item.label,
        disabled: props.disabled === true || item.disabled === true,
        error: props.error === true,
        hideDetails: true,
      }),
    ),
  );
CheckboxGroupView.props = GROUP_KEYS;

export const mountRadioGroup = <Value extends string | number>(
  container: Element,
  props: RadioGroupProps<Value>,
): Mounted<RadioGroupProps<Value>> =>
  mountComponent(container, RadioGroupView, props);

export const mountCheckboxGroup = <Value extends string | number>(
  container: Element,
  props: CheckboxGroupProps<Value>,
): Mounted<CheckboxGroupProps<Value>> =>
  mountComponent(container, CheckboxGroupView, props);
