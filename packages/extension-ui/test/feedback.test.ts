import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  mountAlert,
  mountChip,
  mountProgress,
  mountSkeleton,
} from '../src/vuetify/feedback.ts';

const host = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('alert', () => {
  it('is an alert with title and text, closes and reports it', async () => {
    const container = host();
    const onClose = vi.fn();
    const mounted = mountAlert(container, {
      type: 'error',
      title: 'Failed',
      text: 'Try again',
      closable: true,
      onClose,
    });
    await nextTick();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Failed');
    expect(alert?.textContent).toContain('Try again');

    mounted.update({ text: 'Changed' });
    await nextTick();
    expect(alert?.textContent).toContain('Changed');

    container.querySelector<HTMLElement>('button[aria-label]')?.click();
    await nextTick();
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('has no close button unless closable', async () => {
    const container = host();
    mountAlert(container, { type: 'info', text: 'Note' });
    await nextTick();
    expect(container.querySelector('button')).toBeNull();
  });

  it('labels the close button in the frame language', async () => {
    document.documentElement.lang = 'ru';
    const container = host();
    mountAlert(container, { type: 'info', text: 'Note', closable: true });
    await nextTick();
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Закрыть',
    );
    document.documentElement.lang = 'en';
  });
});

describe('chip', () => {
  it('shows the label and reports close', async () => {
    const container = host();
    const onClose = vi.fn();
    const mounted = mountChip(container, {
      label: 'Algebra',
      closable: true,
      onClose,
    });
    await nextTick();
    expect(container.textContent).toContain('Algebra');
    expect(container.querySelector('[role="button"]')).toBeNull();

    container.querySelector<HTMLElement>('button')?.click();
    await nextTick();
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Algebra');

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('is a focusable button when clickable', async () => {
    const container = host();
    const onClick = vi.fn();
    mountChip(container, { label: 'Open', onClick });
    await nextTick();
    const chip = container.querySelector<HTMLElement>('[role="button"]');
    expect(chip?.tabIndex).toBe(0);
    chip?.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('progress', () => {
  it('exposes a named progressbar with its value', async () => {
    const container = host();
    const mounted = mountProgress(container, { value: 40, label: 'Upload' });
    await nextTick();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('Upload');
    expect(bar?.getAttribute('aria-valuenow')).toBe('40');

    mounted.update({ value: null });
    await nextTick();
    const indeterminate = container.querySelector('[role="progressbar"]');
    expect(indeterminate?.hasAttribute('aria-valuenow')).toBe(false);

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('renders a circular progress with the same semantics', async () => {
    const container = host();
    mountProgress(container, { value: 75, label: 'Done', shape: 'circular' });
    await nextTick();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.classList.contains('v-progress-circular')).toBe(true);
    expect(bar?.getAttribute('aria-label')).toBe('Done');
    expect(bar?.getAttribute('aria-valuenow')).toBe('75');
  });
});

describe('skeleton', () => {
  it('shows a placeholder only while loading', async () => {
    const container = host();
    const mounted = mountSkeleton(container, {
      type: 'paragraph',
      loading: true,
    });
    await nextTick();
    expect(container.querySelector('.v-skeleton-loader')).not.toBeNull();

    mounted.update({ loading: false });
    await nextTick();
    expect(container.querySelector('.v-skeleton-loader')).toBeNull();

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });
});
