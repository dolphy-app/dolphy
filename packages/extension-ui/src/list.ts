import { create, text } from './dom.ts';

export interface ListItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ListOptions {
  /** Accessible name of the list (not shown). */
  label: string;
  items: readonly ListItem[];
  /** Id of the selected item. */
  selected?: string;
  /** Shown instead of the list when `items` is empty (a listbox may not be empty). */
  emptyText: string;
  onSelect?: (id: string) => void;
}

const FOCUSABLE = 'dui-item';

/**
 * A single-choice list (`role="listbox"`). One item is in the tab order; arrow
 * keys, Home and End move between items, Enter, Space or a click select.
 * To change the items, build a new list and `replaceWith` it.
 */
export const list = (options: ListOptions): HTMLElement => {
  if (options.items.length === 0) {
    return text('p', 'dui-text', options.emptyText);
  }
  const box = create('ul', 'dui-list');
  box.setAttribute('role', 'listbox');
  box.setAttribute('aria-label', options.label);
  const rows: HTMLElement[] = [];
  const enabled = (): HTMLElement[] =>
    rows.filter((row) => row.getAttribute('aria-disabled') !== 'true');
  const focusRow = (row: HTMLElement | undefined): void => {
    if (row === undefined) return;
    for (const other of rows) other.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  };
  const choose = (row: HTMLElement, id: string): void => {
    if (row.getAttribute('aria-disabled') === 'true') return;
    for (const other of rows) other.setAttribute('aria-selected', 'false');
    row.setAttribute('aria-selected', 'true');
    options.onSelect?.(id);
  };
  for (const item of options.items) {
    const row = create('li', FOCUSABLE);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(item.id === options.selected));
    if (item.disabled === true) row.setAttribute('aria-disabled', 'true');
    row.dataset['id'] = item.id;
    row.tabIndex = -1;
    row.append(text('div', 'dui-name', item.label));
    if (item.description !== undefined) {
      row.append(text('div', 'dui-text', item.description));
    }
    row.addEventListener('click', () => {
      choose(row, item.id);
      focusRow(row);
    });
    rows.push(row);
    box.append(row);
  }
  const first =
    rows.find((row) => row.getAttribute('aria-selected') === 'true') ??
    enabled()[0];
  if (first !== undefined) first.tabIndex = 0;
  box.addEventListener('keydown', (event) => {
    const current = rows.indexOf(event.target as HTMLElement);
    const choices = enabled();
    const at = choices.indexOf(rows[current] as HTMLElement);
    const moves: Record<string, () => HTMLElement | undefined> = {
      ArrowDown: () => choices[Math.min(at + 1, choices.length - 1)],
      ArrowUp: () => choices[Math.max(at - 1, 0)],
      Home: () => choices[0],
      End: () => choices[choices.length - 1],
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      focusRow(move());
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const row = rows[current];
      if (row?.dataset['id'] !== undefined) choose(row, row.dataset['id']);
    }
  });
  return box;
};
