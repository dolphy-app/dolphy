import type { Plugin } from 'vite';

const REGISTRY_SPECIFIER = 'dolphy-ext:vue-styles';
const REGISTRY_ID = `\0${REGISTRY_SPECIFIER}`;

/** `<style>` blocks of components in the request form of `@vitejs/plugin-vue`: `X.vue?vue&type=style&index=0&inline&lang.css` (the file is the `src` of the block for `<style src>`). */
const VUE_REQUEST = /[?&]vue(?:&|$)/;
const STYLE_TYPE = /[?&]type=style(?:&|$)/;
const INLINE = /[?&]inline(?:&|$)/;
const DEFAULT_EXPORT = /^export default (".*");?\s*$/s;

/**
 * Module the style blocks report to: puts all of them into one
 * `<style data-dolphy-ext="<id>">` of the page. The first block of a module
 * instance removes the tag an earlier instance of the same extension left
 * (the window imports `client.mjs` again after a reload), so there is one tag
 * per loaded module.
 */
const registrySource = (extensionId: string): string =>
  [
    `const id = ${JSON.stringify(extensionId)};`,
    'let tag = null;',
    'export const addStyle = (css) => {',
    '  if (tag === null) {',
    "    for (const old of document.head.querySelectorAll('style[data-dolphy-ext]')) {",
    "      if (old.getAttribute('data-dolphy-ext') === id) old.remove();",
    '    }',
    "    tag = document.createElement('style');",
    "    tag.setAttribute('data-dolphy-ext', id);",
    '    document.head.append(tag);',
    '  }',
    '  tag.append(css);',
    '};',
    '',
  ].join('\n');

/**
 * Style blocks of single-file components go to the page as text: a bundle has
 * no style file, so every block, `scoped` or not, is a string the module
 * adds to the tag of the extension when it is evaluated.
 */
export const vueStylesPlugin = (extensionId: string): Plugin => ({
  name: 'dolphy-ext:vue-styles',
  enforce: 'post',
  resolveId(source) {
    return source === REGISTRY_SPECIFIER ? REGISTRY_ID : null;
  },
  load(id) {
    return id === REGISTRY_ID ? registrySource(extensionId) : null;
  },
  transform(code, id) {
    if (!VUE_REQUEST.test(id) || !STYLE_TYPE.test(id) || !INLINE.test(id)) {
      return null;
    }
    const exported = DEFAULT_EXPORT.exec(code)?.[1];
    if (exported === undefined) {
      return this.error(
        `'${id.split('?')[0]}': a style block of a component did not become a string`,
      );
    }
    return {
      code: `import { addStyle } from ${JSON.stringify(REGISTRY_SPECIFIER)};\nconst css = ${exported};\naddStyle(css);\nexport default css;\n`,
      map: null,
    };
  },
});
