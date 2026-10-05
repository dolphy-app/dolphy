import { create } from './dom.ts';

export interface ButtonOptions {
  /** Visible text; it is also the accessible name. */
  label: string;
  onClick?: (event: MouseEvent) => void;
  /** `primary` is the main action of a view, `danger` a destructive one (outlined in the error colour). Default `secondary`. */
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

/** A `<button type="button">`: Enter and Space press it, the focus ring is always visible. */
export const button = (options: ButtonOptions): HTMLButtonElement => {
  const node = create(
    'button',
    `dui-button dui-button--${options.variant ?? 'secondary'}`,
  );
  node.type = 'button';
  node.textContent = options.label;
  node.disabled = options.disabled === true;
  const { onClick } = options;
  if (onClick !== undefined) node.addEventListener('click', onClick);
  return node;
};
