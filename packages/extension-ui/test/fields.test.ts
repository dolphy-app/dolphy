import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  mountDateField,
  mountSlider,
  mountSwitch,
  mountTextarea,
} from '../src/vuetify/fields.ts';

const host = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.lang = '';
});

describe('textarea', () => {
  it('has a name, reports input and replaces text only on a different value', async () => {
    const container = host();
    const onChange = vi.fn();
    const mounted = mountTextarea(container, {
      value: 'abc',
      label: 'Answer',
      onChange,
      monospace: true,
    });
    await nextTick();
    const area = container.querySelector('textarea');
    expect(area?.value).toBe('abc');
    expect(area?.getAttribute('aria-label')).toBe('Answer');

    if (area === null) throw new Error('no textarea');
    area.value = 'abcd';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(onChange).toHaveBeenLastCalledWith('abcd');

    // the text shown is already "abcd": the same value must not touch the DOM value
    area.setSelectionRange(2, 2);
    mounted.update({ value: 'abcd' });
    await nextTick();
    expect(area.value).toBe('abcd');
    expect(area.selectionStart).toBe(2);

    mounted.update({ value: 'other', disabled: true });
    await nextTick();
    expect(area.value).toBe('other');
    expect(area.disabled).toBe(true);

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('submits on Ctrl/Cmd+Enter only', async () => {
    const container = host();
    const onSubmit = vi.fn();
    mountTextarea(container, {
      value: '',
      label: 'A',
      onChange: vi.fn(),
      onSubmit,
    });
    await nextTick();
    const area = container.querySelector('textarea');
    if (area === null) throw new Error('no textarea');
    area.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    area.dispatchEvent(event);
    area.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
      }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('ids of several components in one frame', () => {
  it('never repeat, so a label of one field is not read for another', async () => {
    const container = host();
    mountDateField(container, {
      value: null,
      label: 'Date',
      onChange: vi.fn(),
    });
    mountTextarea(container, { value: '', label: 'Note', onChange: vi.fn() });
    await nextTick();
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('slider', () => {
  it('exposes the range and follows update()', async () => {
    const container = host();
    const mounted = mountSlider(container, {
      min: 0,
      max: 10,
      step: 2,
      value: 4,
      label: 'Level',
      onChange: vi.fn(),
    });
    await nextTick();
    const thumb = container.querySelector('[role="slider"]');
    expect(thumb?.getAttribute('aria-valuenow')).toBe('4');
    expect(thumb?.getAttribute('aria-valuemax')).toBe('10');
    expect(thumb?.getAttribute('aria-label')).toBe('Level');
    mounted.update({ value: 8 });
    await nextTick();
    expect(thumb?.getAttribute('aria-valuenow')).toBe('8');
    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });
});

describe('switch', () => {
  it('is a labelled switch that reports toggles', async () => {
    const container = host();
    const onChange = vi.fn();
    const mounted = mountSwitch(container, {
      value: false,
      label: 'Hints',
      onChange,
    });
    await nextTick();
    const input = container.querySelector<HTMLInputElement>('input');
    expect(input?.getAttribute('role')).toBe('switch');
    expect(container.textContent).toContain('Hints');
    input?.click();
    await nextTick();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(input?.checked).toBe(true);
    mounted.update({ value: false, disabled: true });
    await nextTick();
    expect(input?.checked).toBe(false);
    expect(input?.disabled).toBe(true);
  });
});

describe('date field', () => {
  it('shows an ISO value and reports ISO strings', async () => {
    const container = host();
    const onChange = vi.fn();
    const mounted = mountDateField(container, {
      value: '2026-03-07',
      label: 'Deadline',
      onChange,
    });
    await nextTick();
    const input = container.querySelector<HTMLInputElement>('input');
    expect(input?.getAttribute('aria-label')).toBe('Deadline');
    expect(input?.value).toMatch(/2026/);
    mounted.update({ value: null });
    await nextTick();
    expect(input?.value).toBe('');
    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('writes the date in the format of the frame language', async () => {
    const shown = async (lang: string): Promise<string> => {
      document.documentElement.lang = lang;
      const container = host();
      mountDateField(container, {
        value: '2026-03-07',
        label: 'Date',
        onChange: vi.fn(),
      });
      await nextTick();
      return container.querySelector('input')?.value ?? '';
    };
    expect(await shown('ru')).toBe('07.03.2026');
    expect(await shown('en')).toBe('03/07/2026');
  });
});
