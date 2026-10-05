import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  mountDialog,
  mountMenu,
  mountTabs,
  mountTooltip,
  overlayHeight,
} from '../src/vuetify/navigation.ts';
import { OVERLAY_EVENT } from '../src/vuetify/overlay.ts';

// happy-dom has no visual viewport, Vuetify positions menus against it
const viewport = {
  scale: 1,
  width: 1024,
  height: 768,
  offsetLeft: 0,
  offsetTop: 0,
  addEventListener() {},
  removeEventListener() {},
};
vi.stubGlobal('visualViewport', viewport);

const host = (): HTMLElement => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await nextTick();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const heights: (number | null)[] = [];
const listen = (event: Event): void => {
  heights.push((event as CustomEvent<{ height: number | null }>).detail.height);
};
document.addEventListener(OVERLAY_EVENT, listen);

const mocks = new Set<() => void>();
const contentHeight = (height: number): void => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight',
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('v-overlay__content')
        ? height
        : 0;
    },
  });
  mocks.add(() => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
    }
  });
};

afterEach(() => {
  document.body.replaceChildren();
  for (const restore of mocks) restore();
  mocks.clear();
  heights.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('visualViewport', viewport);
});

describe('overlayHeight', () => {
  it('a dialog needs its content plus a margin', () => {
    expect(overlayHeight({ kind: 'dialog', contentHeight: 200 })).toBe(248);
  });

  it('a menu or tooltip needs the activator edge in the document plus its content', () => {
    expect(
      overlayHeight({
        kind: 'anchored',
        anchorBottom: 40,
        scrollY: 100,
        contentHeight: 120,
      }),
    ).toBe(276);
  });
});

describe('tabs', () => {
  const items = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma', disabled: true },
  ];

  it('shows tabs linked to panels, reports a pick and hands panels to the caller', async () => {
    const container = host();
    const onChange = vi.fn();
    const panels = new Map<string | number, HTMLElement | null>();
    const mounted = mountTabs(container, {
      items,
      value: 'a',
      label: 'Sections',
      idPrefix: 't',
      onChange,
      onPanel: (value, element) => panels.set(value, element),
    });
    await flush();
    expect(
      container.querySelector('[role="tablist"]')?.getAttribute('aria-label'),
    ).toBe('Sections');
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(tabs[2]?.hasAttribute('disabled')).toBe(true);
    const panel = container.querySelector<HTMLElement>('#t-panel-a');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('t-panel-a');
    expect(panels.get('a')).toBe(panel);
    expect(panel?.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>('#t-panel-b')?.hidden).toBe(
      true,
    );

    tabs[1]?.click();
    await flush();
    expect(onChange).toHaveBeenCalledExactlyOnceWith('b');

    mounted.update({ value: 'b' });
    await flush();
    expect(container.querySelector<HTMLElement>('#t-panel-b')?.hidden).toBe(
      false,
    );
    expect(container.querySelector<HTMLElement>('#t-panel-a')?.hidden).toBe(
      true,
    );
    // the panel element is kept, the caller's content survives a switch
    expect(container.querySelector('#t-panel-a')).toBe(panel);

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
    expect(panels.get('a')).toBeNull();
  });
});

describe('dialog', () => {
  it('shows a string, reports an action and the frame height it needs, and releases it', async () => {
    contentHeight(300);
    const container = host();
    const onClose = vi.fn();
    const mounted = mountDialog(container, {
      open: false,
      title: 'Delete?',
      content: 'This cannot be undone.',
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Delete', value: 'delete', color: 'error' },
      ],
      onClose,
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(heights).toEqual([]);

    mounted.update({ open: true });
    await flush();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Delete?');
    expect(dialog?.getAttribute('aria-label')).toBe('Delete?');
    expect(dialog?.textContent).toContain('This cannot be undone.');
    expect(heights).toEqual([348]);

    const buttons = [...(dialog?.querySelectorAll('button') ?? [])];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Cancel',
      'Delete',
    ]);
    buttons[1]?.click();
    expect(onClose).toHaveBeenCalledExactlyOnceWith('delete');

    mounted.update({ open: false });
    await flush();
    expect(heights).toEqual([348, null]);
    mounted.destroy();
  });

  it('adopts an element, and destroy() releases an open dialog', async () => {
    contentHeight(100);
    const container = host();
    const body = document.createElement('p');
    body.textContent = 'Custom body';
    const mounted = mountDialog(container, {
      open: true,
      content: body,
      onClose() {},
    });
    await flush();
    expect(container.querySelector('[role="dialog"]')?.contains(body)).toBe(
      true,
    );
    expect(heights).toEqual([148]);

    mounted.destroy();
    expect(heights).toEqual([148, null]);
    expect(container.childElementCount).toBe(0);
  });

  it('follows the content size through a ResizeObserver', async () => {
    let notify: () => void = () => {};
    // a constructor must be a function expression, not an arrow
    // eslint-disable-next-line prefer-arrow-callback
    vi.stubGlobal('ResizeObserver', function (callback: () => void) {
      notify = callback;
      return { observe() {}, disconnect() {} };
    });
    let height = 100;
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).classList.contains('v-overlay__content')
          ? height
          : 0;
      },
    });
    mocks.add(() => {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
      }
    });
    const mounted = mountDialog(host(), {
      open: true,
      content: 'x',
      onClose() {},
    });
    await flush();
    height = 400;
    notify();
    expect(heights).toEqual([148, 448]);
    mounted.destroy();
  });
});

describe('menu', () => {
  it('opens from its button, reports a selection and the height below the button', async () => {
    contentHeight(90);
    const container = host();
    const onSelect = vi.fn();
    const mounted = mountMenu(container, {
      items: [
        { value: 1, label: 'Rename' },
        { value: 2, label: 'Remove' },
      ],
      label: 'Actions',
      onSelect,
    });
    await flush();
    const button = container.querySelector<HTMLElement>('button');
    expect(button?.textContent?.trim()).toBe('Actions');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 30,
    } as DOMRect);

    button?.click();
    await flush();
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(heights).toEqual([30 + 90 + 16]);

    const options = [
      ...container.querySelectorAll<HTMLElement>('.v-list-item'),
    ];
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Rename',
      'Remove',
    ]);
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(options.map((option) => option.getAttribute('role'))).toEqual([
      'menuitem',
      'menuitem',
    ]);
    options[1]?.click();
    await flush();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    expect(heights.at(-1)).toBeNull();

    mounted.destroy();
    expect(container.childElementCount).toBe(0);
  });

  it('the largest request of several open overlays wins and the last close returns null', async () => {
    contentHeight(500);
    const dialog = mountDialog(host(), {
      open: true,
      content: 'x',
      onClose() {},
    });
    await flush();
    expect(heights).toEqual([548]);

    const menu = host();
    const mounted = mountMenu(menu, {
      items: [{ value: 1, label: 'One' }],
      label: 'Open',
      onSelect() {},
    });
    await flush();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
    } as DOMRect);
    menu.querySelector('button')?.click();
    await flush();
    expect(heights.at(-1)).toBe(616);

    mounted.destroy();
    expect(heights.at(-1)).toBe(548);
    dialog.destroy();
    expect(heights.at(-1)).toBeNull();
  });
});

describe('tooltip', () => {
  it('describes its button on hover and reports the height below it', async () => {
    contentHeight(24);
    const container = host();
    const mounted = mountTooltip(container, {
      label: 'Info',
      text: 'More about this',
    });
    await flush();
    const button = container.querySelector<HTMLElement>('button');
    expect(button?.textContent?.trim()).toBe('Info');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 20,
    } as DOMRect);

    button?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await flush();
    expect(container.textContent).toContain('More about this');
    expect(heights).toEqual([20 + 24 + 16]);

    button?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await flush();
    expect(heights.at(-1)).toBeNull();
    mounted.destroy();
  });
});
