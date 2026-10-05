import { create, text } from './dom.ts';

export interface ToggleOptions {
  /** Visible text; it is the accessible name of the switch. */
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

/** A switch (`role="switch"`, `aria-checked`) on a `<button>`: Enter and Space flip it. */
export const toggle = (options: ToggleOptions): HTMLButtonElement => {
  const node = create('button', 'dui-toggle');
  node.type = 'button';
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-checked', String(options.checked === true));
  node.disabled = options.disabled === true;
  const track = create('span', 'dui-track');
  track.setAttribute('aria-hidden', 'true');
  node.append(track, text('span', 'dui-label', options.label));
  const { onChange } = options;
  node.addEventListener('click', () => {
    const checked = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', String(checked));
    onChange?.(checked);
  });
  return node;
};
