/** Feedback components: `VAlert`, `VChip`, `VProgressLinear`, `VProgressCircular` and `VSkeletonLoader` of Vuetify. */
import { h } from 'vue';
import type { FunctionalComponent } from 'vue';
import { VAlert } from 'vuetify/components/VAlert';
import { VChip } from 'vuetify/components/VChip';
import { VProgressCircular } from 'vuetify/components/VProgressCircular';
import { VProgressLinear } from 'vuetify/components/VProgressLinear';
import { VSkeletonLoader } from 'vuetify/components/VSkeletonLoader';
import { mountComponent } from './mount.ts';
import type { Mounted } from './mount.ts';

export interface AlertProps {
  type: 'info' | 'success' | 'warning' | 'error';
  title?: string | null;
  text?: string | null;
  /** Shows a close button (labelled by Vuetify in the frame locale). */
  closable?: boolean;
  /** Called when the close button is pressed; the alert hides itself. */
  onClose?(): void;
}

export interface ChipProps {
  label: string;
  color?: string | null;
  /** Shows a close button (labelled by Vuetify in the frame locale). */
  closable?: boolean;
  /** Called when the close button is pressed; the chip hides itself. */
  onClose?(): void;
  /** Makes the chip a keyboard-focusable button. */
  onClick?(): void;
}

export interface ProgressProps {
  /** Progress from 0 to 100, `null` for an indeterminate progress. */
  value: number | null;
  /** The accessible name of the progress bar. */
  label?: string | null;
  /** A horizontal bar (default) or a ring. */
  shape?: 'linear' | 'circular';
}

export interface SkeletonProps {
  /** A Vuetify skeleton type, e.g. `'paragraph'`, `'card'`, `'list-item'`. */
  type: string;
  /**
   * Shows the placeholder. The skeleton has no content to reveal, so when it
   * is `false` nothing is rendered at all.
   */
  loading: boolean;
}

const AlertView: FunctionalComponent<AlertProps> = (props) =>
  h(VAlert, {
    type: props.type,
    title: props.title ?? undefined,
    text: props.text ?? undefined,
    closable: props.closable === true,
    'onClick:close': () => props.onClose?.(),
  });
AlertView.props = ['type', 'title', 'text', 'closable', 'onClose'];

const ChipView: FunctionalComponent<ChipProps> = (props) => {
  const { onClick } = props;
  return h(
    VChip,
    {
      color: props.color ?? undefined,
      closable: props.closable === true,
      'onClick:close': () => props.onClose?.(),
      // `link` makes the chip focusable and operable with Enter and Space
      ...(onClick === undefined
        ? {}
        : { link: true, role: 'button', onClick: () => onClick() }),
    },
    () => props.label,
  );
};
ChipView.props = ['label', 'color', 'closable', 'onClose', 'onClick'];

const ProgressView: FunctionalComponent<ProgressProps> = (props) => {
  const indeterminate = props.value === null;
  const shared = {
    'aria-label': props.label ?? undefined,
    indeterminate,
    modelValue: props.value ?? 0,
  };
  return props.shape === 'circular'
    ? h(VProgressCircular, shared)
    : h(VProgressLinear, { ...shared, active: true });
};
ProgressView.props = ['value', 'label', 'shape'];

const SkeletonView: FunctionalComponent<SkeletonProps> = (props) =>
  props.loading ? h(VSkeletonLoader, { type: props.type }) : null;
SkeletonView.props = ['type', 'loading'];

export const mountAlert = (
  container: Element,
  props: AlertProps,
): Mounted<AlertProps> => mountComponent(container, AlertView, props);

export const mountChip = (
  container: Element,
  props: ChipProps,
): Mounted<ChipProps> => mountComponent(container, ChipView, props);

export const mountProgress = (
  container: Element,
  props: ProgressProps,
): Mounted<ProgressProps> => mountComponent(container, ProgressView, props);

export const mountSkeleton = (
  container: Element,
  props: SkeletonProps,
): Mounted<SkeletonProps> => mountComponent(container, SkeletonView, props);
