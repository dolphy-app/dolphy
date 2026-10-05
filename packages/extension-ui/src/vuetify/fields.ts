/**
 * Form fields: `VTextarea`, `VSlider`, `VSwitch` and `VDateInput` of Vuetify.
 *
 * The date field is `VDateInput` (stable in Vuetify 4, imported from its own
 * entry, not from `vuetify/labs`). Its calendar menu is attached inside the
 * mount like every overlay of the kit, and its strings follow the frame language.
 */
import { h } from 'vue';
import type { Component, FunctionalComponent } from 'vue';
import { VDateInput } from 'vuetify/components/VDateInput';
import { VIcon } from 'vuetify/components/VIcon';
import { VSlider } from 'vuetify/components/VSlider';
import { VSwitch } from 'vuetify/components/VSwitch';
import { VTextarea } from 'vuetify/components/VTextarea';
import { mountComponent } from './mount.ts';
import type { Mounted } from './mount.ts';

export interface TextareaProps {
  value: string;
  /** The accessible name (`aria-label`) of the field. */
  label?: string | null;
  rows?: number;
  /** Grow with the text instead of scrolling. */
  autoGrow?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  /** Use a monospace font (code answers). */
  monospace?: boolean;
  spellcheck?: boolean;
  placeholder?: string;
  /** Shown as an invalid field (a wrong answer of a checked exercise). */
  error?: boolean;
  /** Called on every input with the whole text. */
  onChange(value: string): void;
  /** Called on Ctrl/Cmd+Enter inside the field. */
  onSubmit?(): void;
}

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  /** The accessible name (`aria-label`) of the slider. */
  label?: string | null;
  disabled?: boolean;
  onChange(value: number): void;
}

export interface SwitchProps {
  value: boolean;
  label?: string | null;
  disabled?: boolean;
  onChange(value: boolean): void;
}

export interface DateFieldProps {
  /** An ISO date `YYYY-MM-DD` or `null` for an empty field. */
  value: string | null;
  label?: string | null;
  disabled?: boolean;
  error?: boolean;
  onChange(value: string | null): void;
}

const TextareaView: FunctionalComponent<TextareaProps> = (props) =>
  h(VTextarea, {
    modelValue: props.value,
    'onUpdate:modelValue': (value: string | null) => {
      props.onChange(value ?? '');
    },
    onKeydown: (event: KeyboardEvent) => {
      if (
        event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey) &&
        props.onSubmit !== undefined
      ) {
        event.preventDefault();
        props.onSubmit();
      }
    },
    'aria-label': props.label ?? undefined,
    rows: props.rows ?? 3,
    autoGrow: props.autoGrow === true,
    disabled: props.disabled === true,
    readonly: props.readonly === true,
    spellcheck: props.spellcheck,
    placeholder: props.placeholder,
    error: props.error === true,
    style: props.monospace === true ? { fontFamily: 'monospace' } : undefined,
    variant: 'outlined',
    density: 'compact',
    hideDetails: true,
  });
TextareaView.props = [
  'value',
  'label',
  'rows',
  'autoGrow',
  'disabled',
  'readonly',
  'monospace',
  'spellcheck',
  'placeholder',
  'error',
  'onChange',
  'onSubmit',
];

const SliderView: FunctionalComponent<SliderProps> = (props) =>
  h(VSlider, {
    modelValue: props.value,
    'onUpdate:modelValue': (value: number) => {
      props.onChange(value);
    },
    min: props.min,
    max: props.max,
    step: props.step ?? 1,
    'aria-label': props.label ?? undefined,
    disabled: props.disabled === true,
    hideDetails: true,
  });
SliderView.props = [
  'min',
  'max',
  'step',
  'value',
  'label',
  'disabled',
  'onChange',
];

// `VSwitch` typings clash with `exactOptionalPropertyTypes` of the package
const SwitchView: FunctionalComponent<SwitchProps> = (props) =>
  h(VSwitch as Component, {
    modelValue: props.value,
    'onUpdate:modelValue': (value: boolean | null) => {
      props.onChange(value === true);
    },
    label: props.label ?? undefined,
    role: 'switch',
    disabled: props.disabled === true,
    inset: true,
    density: 'compact',
    hideDetails: true,
  });
SwitchView.props = ['value', 'label', 'disabled', 'onChange'];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An ISO date as a local-midnight `Date`; `null` for an empty or malformed string. */
const parseIsoDate = (value: string | null): Date | null => {
  const match = value === null ? null : ISO_DATE.exec(value);
  if (match === null) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
};

const pad = (value: number, length: number): string =>
  String(value).padStart(length, '0');

const formatIsoDate = (date: Date): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;

// Two defects of `VDateInput` fail the accessibility check, both are worked around here:
// the menu puts `aria-haspopup`, `aria-expanded` and `aria-controls` on a plain `<div>` around the
// field (`aria-allowed-attr`), and the calendar icon becomes an unnamed button (`aria-command-name`).
// The icon is decorative: the calendar opens from the field itself.
const NO_ACTIVATOR_ARIA = {
  'aria-haspopup': undefined,
  'aria-expanded': undefined,
  'aria-controls': undefined,
  'aria-owns': undefined,
};

const DateFieldView: FunctionalComponent<DateFieldProps> = (props) =>
  h(
    VDateInput,
    {
      modelValue: parseIsoDate(props.value),
      'onUpdate:modelValue': (value: unknown) => {
        props.onChange(value instanceof Date ? formatIsoDate(value) : null);
      },
      label: props.label ?? undefined,
      'aria-label': props.label ?? undefined,
      disabled: props.disabled === true,
      error: props.error === true,
      variant: 'outlined',
      density: 'compact',
      hideDetails: true,
      menuProps: { activatorProps: NO_ACTIVATOR_ARIA },
    },
    {
      prepend: () => h(VIcon, { icon: '$calendar', 'aria-hidden': 'true' }),
    },
  );
DateFieldView.props = ['value', 'label', 'disabled', 'error', 'onChange'];

/**
 * Mounts a field whose `value` mirrors what the user typed: the mount feeds the
 * reported value back into its own props, so `update({ value })` with the text
 * already shown changes nothing (the caret stays), and any other value replaces it.
 */
const mountField = <
  Value,
  Props extends { value: Value; onChange(value: Value): void },
>(
  container: Element,
  component: FunctionalComponent<Props>,
  props: Props,
): Mounted<Props> => {
  const mounted: Mounted<Props> = mountComponent(container, component, {
    ...props,
    onChange: (value: Value) => {
      mounted.update({ value } as Partial<Props>);
      props.onChange(value);
    },
  });
  return {
    update: (patch) => {
      const { onChange, ...rest } = patch;
      if (onChange !== undefined) props = { ...props, onChange };
      mounted.update(rest as Partial<Props>);
    },
    destroy: () => {
      mounted.destroy();
    },
  };
};

export const mountTextarea = (
  container: Element,
  props: TextareaProps,
): Mounted<TextareaProps> => mountField(container, TextareaView, props);

export const mountSlider = (
  container: Element,
  props: SliderProps,
): Mounted<SliderProps> => mountField(container, SliderView, props);

export const mountSwitch = (
  container: Element,
  props: SwitchProps,
): Mounted<SwitchProps> => mountField(container, SwitchView, props);

export const mountDateField = (
  container: Element,
  props: DateFieldProps,
): Mounted<DateFieldProps> => mountField(container, DateFieldView, props);
