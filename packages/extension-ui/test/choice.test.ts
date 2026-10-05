import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountCheckboxGroup, mountRadioGroup } from '../src/vuetify/choice.ts';

const items = [
  { value: 0, label: 'Alpha' },
  { value: 1, label: 'Beta' },
  { value: 2, label: 'Gamma' },
];

const host = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

const inputs = (container: ParentNode): HTMLInputElement[] => [
  ...container.querySelectorAll<HTMLInputElement>('input'),
];

afterEach(() => {
  document.body.replaceChildren();
});

describe('radio group', () => {
  it('shows the value, reports a pick and follows update()', async () => {
    const container = host();
    const onChange = vi.fn();
    const mounted = mountRadioGroup(container, {
      items,
      value: 1,
      label: 'Pick one',
      onChange,
    });
    await nextTick();
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(
      container
        .querySelector('[role="radiogroup"]')
        ?.getAttribute('aria-label'),
    ).toBe('Pick one');
    expect(inputs(container).map((input) => input.checked)).toEqual([
      false,
      true,
      false,
    ]);

    inputs(container)[2]?.click();
    await nextTick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2);

    mounted.update({ value: 0, disabled: true });
    await nextTick();
    expect(inputs(container).map((input) => input.checked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(inputs(container).every((input) => input.disabled)).toBe(true);

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });
});

describe('checkbox group', () => {
  it('toggles items and reports the whole selection', async () => {
    const container = host();
    const onChange = vi.fn();
    mountCheckboxGroup(container, {
      items,
      value: [0],
      label: 'Pick any',
      onChange,
    });
    await nextTick();
    expect(
      container.querySelector('[role="group"]')?.getAttribute('aria-label'),
    ).toBe('Pick any');
    expect(inputs(container).map((input) => input.checked)).toEqual([
      true,
      false,
      false,
    ]);

    inputs(container)[2]?.click();
    await nextTick();
    expect(onChange).toHaveBeenLastCalledWith([0, 2]);

    inputs(container)[0]?.click();
    await nextTick();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('styles', () => {
  it('a shadow root gets its own copy of the dependency and theme styles and drops them with the last component', async () => {
    const shadowHost = host();
    const root = shadowHost.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    root.append(container);
    const first = mountRadioGroup(container, {
      items,
      value: 0,
      onChange() {},
    });
    const second = mountCheckboxGroup(container, {
      items,
      value: [],
      onChange() {},
    });
    await nextTick();
    expect(
      [...root.querySelectorAll('style')].map(
        (style) => style.dataset.dolphyUi,
      ),
    ).toEqual(['dependencies', 'theme']);
    expect(
      root.querySelector('style[data-dolphy-ui="theme"]')?.textContent,
    ).toContain('.v-theme--dolphy');
    first.destroy();
    expect(root.querySelectorAll('style')).toHaveLength(2);
    second.destroy();
    expect(root.querySelectorAll('style')).toHaveLength(0);
  });
});
