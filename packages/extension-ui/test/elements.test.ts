// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  button,
  card,
  emptyState,
  list,
  select,
  textField,
  toggle,
} from '../src/index.ts';

const mount = <T extends HTMLElement>(node: T): T => {
  document.body.append(node);
  return node;
};

const key = (target: Element, name: string) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
    }),
  );

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('button', () => {
  it('is a named button that does not submit forms and reports clicks', () => {
    const onClick = vi.fn();
    const node = mount(button({ label: 'Save', onClick }));
    expect(node.tagName).toBe('BUTTON');
    expect(node.type).toBe('button');
    expect(node.textContent).toBe('Save');
    node.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not report clicks while disabled', () => {
    const onClick = vi.fn();
    const node = mount(button({ label: 'Save', onClick, disabled: true }));
    node.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('treats the label as text, not markup', () => {
    const node = mount(button({ label: '<img src=x onerror=alert(1)>' }));
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('textField', () => {
  it('links the label to the input and reports the typed value', () => {
    const onInput = vi.fn();
    const field = mount(textField({ label: 'Name', value: 'Ada', onInput }));
    const input = field.querySelector('input') as HTMLInputElement;
    const label = field.querySelector('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toBe('Name');
    expect(input.value).toBe('Ada');
    input.value = 'Grace';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onInput).toHaveBeenCalledWith('Grace');
  });

  it('links help and error text and marks the input invalid', () => {
    const field = mount(
      textField({ label: 'Age', description: 'Years', error: 'Too big' }),
    );
    const input = field.querySelector('input') as HTMLInputElement;
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Years',
      'Too big',
    ]);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('has no invalid mark without an error', () => {
    const input = mount(textField({ label: 'Age' })).querySelector('input');
    expect(input?.hasAttribute('aria-invalid')).toBe(false);
    expect(input?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('gives every field its own id', () => {
    const a = textField({ label: 'A' }).querySelector('input');
    const b = textField({ label: 'B' }).querySelector('input');
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('select', () => {
  it('names the select by its label, preselects and reports changes', () => {
    const onChange = vi.fn();
    const field = mount(
      select({
        label: 'Level',
        options: [
          { value: 'a', label: 'Easy' },
          { value: 'b', label: 'Hard' },
        ],
        value: 'b',
        onChange,
      }),
    );
    const control = field.querySelector('select') as HTMLSelectElement;
    expect((field.querySelector('label') as HTMLLabelElement).htmlFor).toBe(
      control.id,
    );
    expect(control.value).toBe('b');
    control.value = 'a';
    control.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('toggle', () => {
  it('is a switch that flips on click and on keyboard activation', () => {
    const onChange = vi.fn();
    const node = mount(toggle({ label: 'Notify', onChange }));
    expect(node.getAttribute('role')).toBe('switch');
    expect(node.getAttribute('aria-checked')).toBe('false');
    expect(node.textContent).toBe('Notify');
    node.click();
    expect(node.getAttribute('aria-checked')).toBe('true');
    node.click();
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('starts checked when asked and hides the decorative track', () => {
    const node = mount(toggle({ label: 'Notify', checked: true }));
    expect(node.getAttribute('aria-checked')).toBe('true');
    expect(node.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('card and emptyState', () => {
  it('names a card by its heading and adds children as text or nodes', () => {
    const inner = document.createElement('em');
    inner.textContent = 'inner';
    const node = mount(
      card({ title: 'Stats', level: 3, children: ['<b>text</b>', inner] }),
    );
    const heading = node.querySelector('h3') as HTMLElement;
    expect(node.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(node.querySelector('b')).toBeNull();
    expect(node.textContent).toBe('Stats<b>text</b>inner');
  });

  it('names an empty state, with an optional description and action', () => {
    const action = button({ label: 'Add' });
    const node = mount(
      emptyState({ title: 'Nothing yet', description: 'Add one', action }),
    );
    expect(node.getAttribute('role')).toBe('group');
    expect(
      document.getElementById(node.getAttribute('aria-labelledby') ?? '')
        ?.textContent,
    ).toBe('Nothing yet');
    expect(node.querySelector('button')).toBe(action);
  });
});

describe('list', () => {
  const items = [
    { id: 'a', label: 'Alpha', description: 'first' },
    { id: 'b', label: 'Beta', disabled: true },
    { id: 'c', label: 'Gamma' },
  ];
  const rows = (node: HTMLElement) => [...node.querySelectorAll('li')];

  it('is a named listbox of options with one stop in the tab order', () => {
    const node = mount(
      list({ label: 'Courses', items, selected: 'c', emptyText: 'none' }),
    );
    expect(node.getAttribute('role')).toBe('listbox');
    expect(node.getAttribute('aria-label')).toBe('Courses');
    expect(rows(node).map((row) => row.getAttribute('role'))).toEqual([
      'option',
      'option',
      'option',
    ]);
    expect(rows(node).map((row) => row.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(rows(node).map((row) => row.tabIndex)).toEqual([-1, -1, 0]);
    expect(rows(node)[1]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('puts the first enabled item in the tab order without a selection', () => {
    const node = mount(list({ label: 'L', items, emptyText: 'none' }));
    expect(rows(node).map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves with arrows, Home and End, skipping disabled items', () => {
    const node = mount(list({ label: 'L', items, emptyText: 'none' }));
    const [alpha, , gamma] = rows(node) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    alpha.focus();
    key(alpha, 'ArrowDown');
    expect(document.activeElement).toBe(gamma);
    expect(gamma.tabIndex).toBe(0);
    expect(alpha.tabIndex).toBe(-1);
    key(gamma, 'ArrowDown');
    expect(document.activeElement).toBe(gamma);
    key(gamma, 'Home');
    expect(document.activeElement).toBe(alpha);
    key(alpha, 'End');
    expect(document.activeElement).toBe(gamma);
    key(gamma, 'ArrowUp');
    expect(document.activeElement).toBe(alpha);
  });

  it('selects with Enter, Space and a click, but never a disabled item', () => {
    const onSelect = vi.fn();
    const node = mount(
      list({ label: 'L', items, onSelect, emptyText: 'none' }),
    );
    const [alpha, beta, gamma] = rows(node) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    key(alpha, 'Enter');
    expect(alpha.getAttribute('aria-selected')).toBe('true');
    key(gamma, ' ');
    expect(gamma.getAttribute('aria-selected')).toBe('true');
    expect(alpha.getAttribute('aria-selected')).toBe('false');
    beta.click();
    expect(beta.getAttribute('aria-selected')).toBe('false');
    alpha.click();
    expect(onSelect.mock.calls).toEqual([['a'], ['c'], ['a']]);
  });

  it('shows the empty text instead of an empty listbox', () => {
    const node = mount(
      list({ label: 'L', items: [], emptyText: 'No courses' }),
    );
    expect(node.getAttribute('role')).toBeNull();
    expect(node.textContent).toBe('No courses');
  });
});

describe('stylesheet', () => {
  it('is inserted once per document, whatever is built', () => {
    button({ label: 'a' });
    card({ title: 'b' });
    list({ label: 'c', items: [{ id: 'x', label: 'x' }], emptyText: '' });
    expect(document.querySelectorAll('style#dolphy-ui-kit')).toHaveLength(1);
  });

  it('takes colours from the frame theme variables only', () => {
    button({ label: 'a' });
    const css = document.getElementById('dolphy-ui-kit')?.textContent ?? '';
    expect(css).toContain('var(--v-theme-surface');
    expect(css).toContain('var(--v-theme-primary');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/(?<![-\w])(?:white|black|red|blue)\b/);
  });
});
