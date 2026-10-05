import { createApp, h, shallowReactive } from 'vue';
import type { Component } from 'vue';
import { VDefaultsProvider } from 'vuetify/components/VDefaultsProvider';
import 'vuetify/styles';
import { vuetifyOf } from './instance.ts';
import { acquireStyles } from './root.ts';

/** A mounted component: new properties go into `update`, `destroy` removes the DOM and the styles. */
export interface Mounted<Props> {
  update(patch: Partial<Props>): void;
  destroy(): void;
}

let mounts = 0;

/**
 * Mounts `component` into `container` as a small Vue app on the Vuetify of the frame.
 * Overlays (dialog, menu, tooltip) are attached inside `container` too, not to
 * `<body>`: in a shadow tree of an answer view `<body>` is outside of the styles.
 * `component` must declare the keys of `props` as its props.
 */
export const mountComponent = <Props extends object>(
  container: Element,
  component: Component,
  initial: Props,
): Mounted<Props> => {
  const doc = container.ownerDocument;
  const vuetify = vuetifyOf(doc);
  const release = acquireStyles(container, vuetify);
  const host = doc.createElement('div');
  const overlays = doc.createElement('div');
  container.append(host, overlays);
  const props = shallowReactive<Record<string, unknown>>({
    ...(initial as Record<string, unknown>),
  });
  const attach = { attach: overlays };
  const app = createApp({
    render: () =>
      h(
        VDefaultsProvider,
        {
          defaults: {
            VDialog: attach,
            VMenu: attach,
            VOverlay: attach,
            VTooltip: attach,
          },
        },
        () => h(component, { ...props }),
      ),
  });
  // every app counts its generated ids (`useId`) from zero: without a prefix of its own two fields of
  // one frame share `input-v-0`, and `aria-labelledby` of one points to the label of the other
  app.config.idPrefix = `dolphy-${++mounts}`;
  app.use(vuetify);
  app.mount(host);
  return {
    update: (patch) => {
      Object.assign(props, patch);
    },
    destroy: () => {
      app.unmount();
      host.remove();
      overlays.remove();
      release();
    },
  };
};
