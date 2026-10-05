import { watch } from 'vue';
import type { FrameVuetify } from './instance.ts';

/**
 * The style sheets of Vuetify's dependencies: `dolphy-ext build` collects every
 * `import './VBtn.css'` from `node_modules` into this registry of the global object
 * (`DEPENDENCY_STYLES_KEY` of `@dolphy-app/extension-tools`).
 */
const REGISTRY = Symbol.for('dolphy.styles');

const dependencyStyles = (): string => {
  const registry = (globalThis as Record<symbol, unknown>)[REGISTRY];
  return registry instanceof Set
    ? [...(registry as Set<string>)].join('\n')
    : '';
};

interface RootEntry {
  count: number;
  remove(): void;
}

const roots = new WeakMap<Node, RootEntry>();

/** The tree the styles belong to: a shadow root of an answer view or the frame document. */
const styleRootOf = (container: Element): Document | ShadowRoot => {
  const root = container.getRootNode();
  if (root instanceof ShadowRoot) return root;
  return container.ownerDocument;
};

const createStyle = (doc: Document, name: string): HTMLStyleElement => {
  const style = doc.createElement('style');
  style.dataset.dolphyUi = name;
  return style;
};

const addStyles = (
  root: Document | ShadowRoot,
  container: Element,
  vuetify: FrameVuetify,
): RootEntry => {
  const doc = container.ownerDocument;
  const target = root instanceof ShadowRoot ? root : doc.head;
  const elements = [createStyle(doc, 'dependencies')];
  elements[0]!.textContent = dependencyStyles();
  let stop = () => {};
  if (root instanceof ShadowRoot) {
    // Vuetify writes the theme classes (`.v-theme--*`, `.bg-*`, `.text-*`) into `<head>`, a shadow tree does not see them
    const theme = createStyle(doc, 'theme');
    elements.push(theme);
    stop = watch(
      vuetify.theme.styles,
      (styles) => {
        theme.textContent = styles;
      },
      { immediate: true },
    );
  }
  target.prepend(...elements);
  return {
    count: 0,
    remove: () => {
      stop();
      for (const element of elements) element.remove();
    },
  };
};

/**
 * Puts the kit's styles into the tree of `container` for the first component mounted
 * there; returns the release function (the last one removes them).
 */
export const acquireStyles = (
  container: Element,
  vuetify: FrameVuetify,
): (() => void) => {
  const root = styleRootOf(container);
  let entry = roots.get(root);
  if (entry === undefined) {
    entry = addStyles(root, container, vuetify);
    roots.set(root, entry);
  }
  entry.count += 1;
  const owned = entry;
  return () => {
    owned.count -= 1;
    if (owned.count > 0) return;
    owned.remove();
    roots.delete(root);
  };
};
