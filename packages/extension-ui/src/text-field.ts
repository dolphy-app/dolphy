import { create, nextId, text } from './dom.ts';

export interface TextFieldOptions {
  /** Visible label; it is the accessible name of the input. */
  label: string;
  value?: string;
  placeholder?: string;
  /** Help text linked to the input with `aria-describedby`. */
  description?: string;
  /** Error text: marks the input `aria-invalid` and is linked to it. */
  error?: string;
  type?: 'text' | 'email' | 'number' | 'password' | 'search' | 'tel' | 'url';
  required?: boolean;
  disabled?: boolean;
  onInput?: (value: string) => void;
}

/** A label above a text input; the returned element is the wrapper, the input is `querySelector('input')`. */
export const textField = (options: TextFieldOptions): HTMLDivElement => {
  const wrapper = create('div', 'dui-field');
  const id = nextId();
  const label = text('label', 'dui-label', options.label);
  label.htmlFor = id;
  const input = create('input', 'dui-input');
  input.id = id;
  input.type = options.type ?? 'text';
  input.value = options.value ?? '';
  if (options.placeholder !== undefined) {
    input.placeholder = options.placeholder;
  }
  input.required = options.required === true;
  input.disabled = options.disabled === true;
  wrapper.append(label);
  const described: string[] = [];
  if (options.description !== undefined) {
    const hint = text('div', 'dui-hint', options.description);
    hint.id = `${id}-hint`;
    described.push(hint.id);
    wrapper.append(hint);
  }
  if (options.error !== undefined) {
    const error = text('div', 'dui-error', options.error);
    error.id = `${id}-error`;
    described.push(error.id);
    input.setAttribute('aria-invalid', 'true');
    wrapper.append(error);
  }
  if (described.length > 0) {
    input.setAttribute('aria-describedby', described.join(' '));
  }
  const { onInput } = options;
  if (onInput !== undefined) {
    input.addEventListener('input', () => onInput(input.value));
  }
  wrapper.append(input);
  return wrapper;
};
