import MagicString from 'magic-string';
import type { Plugin } from 'vite';

const COMPONENTS = 'vuetify/components';
const DIRECTIVES = 'vuetify/directives';

/** Exports of `vuetify/directives`: a template names them as `v-ripple`, `v-click-outside`. */
const DIRECTIVE_EXPORTS: readonly string[] = [
  'ClickOutside',
  'Intersect',
  'Mutate',
  'Resize',
  'Ripple',
  'Scroll',
  'Tooltip',
  'Touch',
];

const VUE_FILE = /\.vue(?:\?|$)/;

/** `_resolveComponent("v-btn")`: the call of the template compiler for a tag that is not a binding of `<script setup>`. */
const RESOLVE_CALL = /\b_resolve(Component|Directive)\(("(?:[^"\\]|\\.)*")\)/g;

const pascalCase = (name: string): string =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** `v-btn` and `VBtn` → `VBtn`; the other tags are not Vuetify's. */
export const vuetifyComponentOf = (tag: string): string | null => {
  if (/^v-[a-z][a-z0-9-]*$/.test(tag)) return pascalCase(tag);
  return /^V[A-Z][A-Za-z0-9]*$/.test(tag) ? tag : null;
};

/** `ripple` and `click-outside` → `Ripple` and `ClickOutside`. */
export const vuetifyDirectiveOf = (name: string): string | null => {
  const exported = pascalCase(name);
  return DIRECTIVE_EXPORTS.includes(exported) ? exported : null;
};

/** `import { VBtn as _dolphy_VBtn } from "vuetify/components";` (empty for no names). */
const importLine = (names: ReadonlySet<string>, source: string): string =>
  names.size === 0
    ? ''
    : `import { ${[...names].map((name) => `${name} as _dolphy_${name}`).join(', ')} } from ${JSON.stringify(source)};`;

/**
 * Turns the tags of Vuetify in the templates (`<v-btn>`) into imports from
 * `vuetify/components`, and the directives (`v-ripple`) into imports from
 * `vuetify/directives`. Both are host modules: the window gives its own Vuetify
 * and there is no copy in the bundle. A name the module does not export falls
 * back to Vue's own lookup, which reports the unknown component.
 */
export const vuetifyTemplatePlugin = (): Plugin => ({
  name: 'dolphy-ext:vuetify-template',
  enforce: 'post',
  transform(code, id) {
    if (!VUE_FILE.test(id) || !code.includes('_resolve')) return null;
    const result = new MagicString(code);
    const components = new Set<string>();
    const directives = new Set<string>();
    for (const match of code.matchAll(RESOLVE_CALL)) {
      const [call, kind, literal] = match;
      if (kind === undefined || literal === undefined) continue;
      const name = JSON.parse(literal) as string;
      const isComponent = kind === 'Component';
      const exported = isComponent
        ? vuetifyComponentOf(name)
        : vuetifyDirectiveOf(name);
      if (exported === null) continue;
      (isComponent ? components : directives).add(exported);
      result.overwrite(
        match.index,
        match.index + call.length,
        `(_dolphy_${exported} ?? ${call})`,
      );
    }
    const imports = [
      importLine(components, COMPONENTS),
      importLine(directives, DIRECTIVES),
    ].filter((line) => line !== '');
    if (imports.length === 0) return null;
    result.prepend(`${imports.join(' ')} `);
    return { code: result.toString(), map: result.generateMap() };
  },
});
