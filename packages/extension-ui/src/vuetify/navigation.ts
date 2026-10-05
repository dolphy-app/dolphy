/** Tabs, dialog, menu and tooltip: `VTabs`, `VDialog`, `VMenu` and `VTooltip` of Vuetify. */
import {
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { Component, VNode } from 'vue';
import { VBtn } from 'vuetify/components/VBtn';
import { VCard, VCardActions, VCardText } from 'vuetify/components/VCard';
import { VDialog } from 'vuetify/components/VDialog';
import { VList, VListItem } from 'vuetify/components/VList';
import { VMenu } from 'vuetify/components/VMenu';
import { VTab, VTabs } from 'vuetify/components/VTabs';
import { VTooltip } from 'vuetify/components/VTooltip';
import { mountComponent } from './mount.ts';
import type { Mounted } from './mount.ts';
import { requestOverlayHeight } from './overlay.ts';

/** Room kept below a dialog, in px. */
export const DIALOG_MARGIN = 48;
/** Room kept below a menu or a tooltip, in px. */
export const ANCHORED_MARGIN = 16;

/** What the frame needs to be tall enough for one open overlay. */
export type OverlayMeasure =
  | { kind: 'dialog'; contentHeight: number }
  | {
      kind: 'anchored';
      /** `getBoundingClientRect().bottom` of the activator. */
      anchorBottom: number;
      /** How far the document is scrolled. */
      scrollY: number;
      contentHeight: number;
    };

/**
 * The frame height an open overlay needs. It depends on the content and on the
 * activator position in the document only, never on the frame height itself, so
 * the request and the layout do not chase each other.
 */
export const overlayHeight = (measure: OverlayMeasure): number =>
  measure.kind === 'dialog'
    ? measure.contentHeight + DIALOG_MARGIN
    : measure.anchorBottom +
      measure.scrollY +
      measure.contentHeight +
      ANCHORED_MARGIN;

/** A component with the declared `props` and a stateful `setup` returning the render function. */
const view = <Props>(
  keys: string[],
  setup: (props: Props) => () => VNode,
): Component =>
  defineComponent({ props: keys, setup: setup as never }) as Component;

interface OverlayRef {
  contentEl?: HTMLElement | null;
  activatorEl?: HTMLElement | null;
}

/**
 * The height the content of an overlay wants. Vuetify limits the content to the room
 * the frame has (`max-height`) and lets the card or the list scroll inside, so
 * `offsetHeight` of a short frame is the squeezed height; `scrollHeight` of the
 * content and of its children is the whole one.
 */
const naturalHeight = (content: HTMLElement): number =>
  Math.max(
    content.offsetHeight,
    content.scrollHeight,
    ...Array.from(content.children, (child) => child.scrollHeight),
  );

/**
 * Reports the height an overlay needs while it is open: on open, on every resize
 * of its content (`ResizeObserver`; without it once, after the open), `null` on
 * close, on unmount.
 */
const useOverlayHeight = (
  kind: OverlayMeasure['kind'],
  overlay: () => OverlayRef | null | undefined,
) => {
  const key = Symbol(kind);
  let doc: Document | null = null;
  let isOpen = false;
  let observer: ResizeObserver | null = null;
  let observed: Element | null = null;

  const measure = (): void => {
    const target = overlay();
    const content = target?.contentEl;
    if (!isOpen || !content) return;
    doc = content.ownerDocument;
    const contentHeight = naturalHeight(content);
    if (kind === 'dialog') {
      requestOverlayHeight(doc, key, overlayHeight({ kind, contentHeight }));
      return;
    }
    const anchor = target?.activatorEl;
    if (!anchor) return;
    requestOverlayHeight(
      doc,
      key,
      overlayHeight({
        kind,
        anchorBottom: anchor.getBoundingClientRect().bottom,
        scrollY: doc.defaultView?.scrollY ?? 0,
        contentHeight,
      }),
    );
  };

  const stopObserving = (): void => {
    observer?.disconnect();
    observer = null;
    observed = null;
  };

  const sync = (): void => {
    const content = overlay()?.contentEl;
    if (!isOpen || !content) return;
    if (typeof ResizeObserver !== 'undefined' && observed !== content) {
      stopObserving();
      observer = new ResizeObserver(measure);
      observer.observe(content);
      observed = content;
    }
    measure();
  };

  const setOpen = (open: boolean): void => {
    if (open === isOpen) return;
    isOpen = open;
    if (open) {
      void nextTick(sync);
      return;
    }
    stopObserving();
    if (doc) requestOverlayHeight(doc, key, null);
  };

  onBeforeUnmount(() => {
    setOpen(false);
  });
  return { setOpen, sync };
};

// Tabs

export interface TabItem<Value extends string | number = string | number> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface TabsProps<Value extends string | number = string | number> {
  items: readonly TabItem<Value>[];
  value: Value;
  /** The accessible name of the tab list. */
  label?: string | null;
  /** Prefix of the element ids; unique among the tabs of one document. */
  idPrefix?: string;
  onChange(value: Value): void;
  /**
   * Gives the caller the element of a tab panel (`role="tabpanel"`) to render
   * into, `null` when the panel goes away. Only the panel of the selected tab is
   * visible; the others stay in the document, hidden, so their content lives on.
   */
  onPanel?(value: Value, element: HTMLElement | null): void;
}

let tabsCount = 0;

const TabsView = view(
  ['items', 'value', 'label', 'idPrefix', 'onChange', 'onPanel'],
  (props: TabsProps) => {
    const prefix = props.idPrefix ?? `dolphy-tabs-${++tabsCount}`;
    const panels = new Map<string | number, HTMLElement>();
    const panelRef =
      (value: string | number) =>
      (element: unknown): void => {
        const next = (element as HTMLElement | null) ?? null;
        if ((panels.get(value) ?? null) === next) return;
        if (next) panels.set(value, next);
        else panels.delete(value);
        props.onPanel?.(value, next);
      };
    const refs = new Map<string | number, ReturnType<typeof panelRef>>();
    const refOf = (value: string | number) => {
      let callback = refs.get(value);
      if (!callback) {
        callback = panelRef(value);
        refs.set(value, callback);
      }
      return callback;
    };
    return (): VNode =>
      h('div', [
        h(
          VTabs,
          {
            modelValue: props.value,
            'onUpdate:modelValue': (value: unknown) => {
              if (value !== undefined && value !== null) {
                props.onChange(value as string | number);
              }
            },
            'aria-label': props.label ?? undefined,
          },
          () =>
            props.items.map((item) =>
              h(VTab, {
                key: item.value,
                value: item.value,
                text: item.label,
                id: `${prefix}-tab-${item.value}`,
                'aria-controls': `${prefix}-panel-${item.value}`,
                ...(item.disabled === true ? { disabled: true } : {}),
              }),
            ),
        ),
        ...props.items.map((item) =>
          h('div', {
            key: item.value,
            ref: refOf(item.value),
            id: `${prefix}-panel-${item.value}`,
            role: 'tabpanel',
            'aria-labelledby': `${prefix}-tab-${item.value}`,
            hidden: item.value !== props.value,
          }),
        ),
      ]);
  },
);

// Dialog

export interface DialogAction<Value extends string | number = string | number> {
  label: string;
  value: Value;
  color?: string;
}

export interface DialogProps<Value extends string | number = string | number> {
  open: boolean;
  title?: string;
  /** A string, or an element the dialog adopts (moves into its body). */
  content?: string | Element | null;
  actions?: readonly DialogAction<Value>[];
  /** An action was chosen (its `value`), or the dialog was dismissed (`null`: Escape, click outside). */
  onClose(value: Value | null): void;
}

const Adopt = view(['element'], (props: { element: Element }) => {
  const host = ref<HTMLElement | null>(null);
  const place = (): void => {
    if (host.value && props.element.parentNode !== host.value) {
      host.value.replaceChildren(props.element);
    }
  };
  onMounted(place);
  watch(() => props.element, place, { flush: 'post' });
  return () => h('div', { ref: host });
});

const DialogView = view(
  ['open', 'title', 'content', 'actions', 'onClose'],
  (props: DialogProps) => {
    const dialog = ref<OverlayRef | null>(null);
    const tracker = useOverlayHeight('dialog', () => dialog.value);
    watch(() => props.open, tracker.setOpen, {
      flush: 'post',
      immediate: true,
    });
    return (): VNode =>
      h(
        VDialog,
        {
          ref: dialog,
          modelValue: props.open,
          'onUpdate:modelValue': (open: boolean) => {
            if (!open) props.onClose(null);
          },
          onAfterEnter: tracker.sync,
          maxWidth: 560,
          // the element with `role="dialog"` needs a name (`aria-dialog-name` of the accessibility check)
          'aria-label': props.title,
        },
        {
          default: () =>
            h(
              VCard,
              props.title === undefined ? {} : { title: props.title },
              () => [
                props.content === undefined || props.content === null
                  ? null
                  : h(VCardText, () =>
                      typeof props.content === 'string'
                        ? props.content
                        : h(Adopt, { element: props.content }),
                    ),
                props.actions && props.actions.length > 0
                  ? h(VCardActions, () =>
                      (props.actions ?? []).map((action) =>
                        h(VBtn, {
                          key: action.value,
                          color: action.color,
                          text: action.label,
                          onClick: () => {
                            props.onClose(action.value);
                          },
                        }),
                      ),
                    )
                  : null,
              ],
            ),
        },
      );
  },
);

// Menu

export interface MenuItem<Value extends string | number = string | number> {
  value: Value;
  label: string;
  disabled?: boolean;
}

export interface MenuProps<Value extends string | number = string | number> {
  items: readonly MenuItem<Value>[];
  /** The text of the button that opens the menu. */
  label: string;
  onSelect(value: Value): void;
}

const MenuView = view(['items', 'label', 'onSelect'], (props: MenuProps) => {
  const menu = ref<OverlayRef | null>(null);
  const tracker = useOverlayHeight('anchored', () => menu.value);
  return (): VNode =>
    h(
      VMenu,
      {
        ref: menu,
        'onUpdate:modelValue': (open: boolean) => {
          tracker.setOpen(open);
        },
        onAfterEnter: tracker.sync,
      },
      {
        activator: ({ props: activator }: { props: object }) =>
          h(VBtn, { ...activator, text: props.label }),
        default: () =>
          // the activator says `aria-haspopup="menu"`; a plain list would not match it, and
          // `aria-disabled` on a `menuitem` is what keeps a disabled entry out of the contrast check
          h(VList, { role: 'menu' }, () =>
            props.items.map((item) =>
              h(VListItem, {
                key: item.value,
                title: item.label,
                role: 'menuitem',
                ...(item.disabled === true
                  ? { disabled: true, 'aria-disabled': 'true' }
                  : {}),
                onClick: () => {
                  props.onSelect(item.value);
                },
              }),
            ),
          ),
      },
    );
});

// Tooltip

export interface TooltipProps {
  /** The text of the button the tooltip belongs to. */
  label: string;
  /** The text of the tooltip. */
  text: string;
}

const TooltipView = view(['label', 'text'], (props: TooltipProps) => {
  const tooltip = ref<OverlayRef | null>(null);
  const tracker = useOverlayHeight('anchored', () => tooltip.value);
  return (): VNode =>
    h(
      VTooltip,
      {
        ref: tooltip,
        text: props.text,
        // the closed tooltip keeps its `role="tooltip"` element without a text (`aria-tooltip-name`)
        'aria-label': props.text,
        'onUpdate:modelValue': (open: boolean) => {
          tracker.setOpen(open);
        },
        onAfterEnter: tracker.sync,
      },
      {
        activator: ({ props: activator }: { props: object }) =>
          h(VBtn, { ...activator, text: props.label }),
      },
    );
});

export const mountTabs = <Value extends string | number>(
  container: Element,
  props: TabsProps<Value>,
): Mounted<TabsProps<Value>> => mountComponent(container, TabsView, props);

export const mountDialog = <Value extends string | number>(
  container: Element,
  props: DialogProps<Value>,
): Mounted<DialogProps<Value>> => mountComponent(container, DialogView, props);

export const mountMenu = <Value extends string | number>(
  container: Element,
  props: MenuProps<Value>,
): Mounted<MenuProps<Value>> => mountComponent(container, MenuView, props);

export const mountTooltip = (
  container: Element,
  props: TooltipProps,
): Mounted<TooltipProps> => mountComponent(container, TooltipView, props);
