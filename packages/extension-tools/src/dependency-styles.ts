import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * A style sheet of a dependency (`import './VBtn.css'` inside `node_modules`: a UI
 * library such as Vuetify) is collected as a string into a registry on the global
 * object of the page. A bundle cannot carry a side-effect style sheet, so the UI kit
 * (`@dolphy-app/extension-ui/vuetify`) adds the whole registry to the frame as one
 * `<style>` (or into the shadow root of an answer view) at the first mount.
 */
export const DEPENDENCY_STYLES_KEY = 'dolphy.styles';

const PREFIX = '\0dolphy-ext:dependency-style:';
const NODE_MODULES = /[\\/]node_modules[\\/]/;
const STYLE_FILE = /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)$/;

/** The id of the registry module for a resolved plain import of a style sheet from `node_modules`; otherwise `null`. */
export const dependencyStyleId = (resolvedId: string): string | null =>
  // a query (`?inline`, `?url`) is the import of a string, not a side effect
  !resolvedId.includes('?') &&
  STYLE_FILE.test(resolvedId) &&
  NODE_MODULES.test(resolvedId)
    ? // the path is encoded: an id that ends in `.css` would be taken for a style sheet by Vite
      `${PREFIX}${Buffer.from(path.normalize(resolvedId)).toString('base64url')}`
    : null;

/** The source of the registry module `id` (see `dependencyStyleId`); `null` for any other id. */
export const loadDependencyStyle = (id: string): string | null => {
  if (!id.startsWith(PREFIX)) return null;
  const file = Buffer.from(id.slice(PREFIX.length), 'base64url').toString();
  return [
    `import css from ${JSON.stringify(`${file}?inline`)};`,
    `const registry = (globalThis[Symbol.for(${JSON.stringify(DEPENDENCY_STYLES_KEY)})] ??= new Set());`,
    'registry.add(css);',
  ].join('\n');
};

/**
 * For a bundler without `assetsPlugin`: the Storybook of an extension, so that a shadow
 * tree gets the same styles as in the app. `dolphy-ext build` does the same inside
 * `assetsPlugin` (two plugins asking each other to resolve an import do not compose).
 */
export const dependencyStylesPlugin = (): Plugin => ({
  name: 'dolphy-ext:dependency-styles',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (importer === undefined || importer.startsWith('\0')) return null;
    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });
    if (resolved === null || resolved.external === true) return null;
    return dependencyStyleId(resolved.id);
  },
  load: loadDependencyStyle,
});
