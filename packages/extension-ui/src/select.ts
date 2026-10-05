import { create, nextId, text } from './dom.ts';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions {
  /** Visible label; it is the accessible name of the select. */
  label: string;
  options: readonly SelectOption[];
  /** The selected value; the first option when absent or unknown. */
  value?: string;
  description?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

/** A label above a native `<select>` (arrow keys, type-ahead and the platform picker come for free). */
export const select = (options: SelectOptions): HTMLDivElement => {
  const wrapper = create('div', 'dui-field');
  const id = nextId();
  const label = text('label', 'dui-label', options.label);
  label.htmlFor = id;
  const control = create('select', 'dui-input');
  control.id = id;
  control.disabled = options.disabled === true;
  for (const item of options.options) {
    const option = create('option', '');
    option.value = item.value;
    option.textContent = item.label;
    option.disabled = item.disabled === true;
    control.append(option);
  }
  if (options.value !== undefined) control.value = options.value;
  wrapper.append(label);
  if (options.description !== undefined) {
    const hint = text('div', 'dui-hint', options.description);
    hint.id = `${id}-hint`;
    control.setAttribute('aria-describedby', hint.id);
    wrapper.append(hint);
  }
  const { onChange } = options;
  if (onChange !== undefined) {
    control.addEventListener('change', () => onChange(control.value));
  }
  wrapper.append(control);
  return wrapper;
};
