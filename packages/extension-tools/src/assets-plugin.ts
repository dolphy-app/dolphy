import { statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { dependencyStyleId, loadDependencyStyle } from './dependency-styles.ts';
import type { JobState } from './shim.ts';

/**
 * Assets up to this size are inlined into the bundle as data URIs; bigger ones become
 * files in `assets/` (`assets/<name>-<hash>.<ext>`: the name follows the content, so a
 * rebuild of the same sources writes the same file).
 */
export const ASSETS_INLINE_LIMIT = 4096;

export const ASSET_FILE_NAME = 'assets/[name]-[hash][extname]';

const ASSET_FILE = /\.(?:png|webp|jpe?g|svg|woff2)$/;
const STYLE_FILE = /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)$/;
const TEXT_IMPORT = /[?&](?:inline|url|raw)(?:&|$)/;
const MARKED = /[?&](?:inline|no-inline|raw)(?:&|$)/;

const cleanId = (id: string): string => id.split('?')[0] ?? id;

/** `new URL('./logo.png', import.meta.url)` with a relative literal to an image or a font. */
const URL_EXPRESSION =
  /new\s+URL\(\s*(['"])(\.{1,2}\/[^'"?#\n]+\.(?:png|webp|jpe?g|svg|woff2))\1\s*,\s*import\.meta\.url\s*\)/g;

const isBig = (file: string): boolean => {
  try {
    return statSync(file).size > ASSETS_INLINE_LIMIT;
  } catch {
    return false;
  }
};

/**
 * Vite in library mode inlines every asset and has no place for a style sheet: the
 * plugin brings the documented paths. An image or a font is a data URI up to
 * `ASSETS_INLINE_LIMIT` and a file in `assets/` above it (an import with `?url` or
 * `new URL('./x.png', import.meta.url)`); a style sheet of the author is imported as a
 * string with `?inline`, a plain `import './x.css'` is an error with the way out in the
 * message; a plain import inside `node_modules` (a UI library) is collected into a
 * registry (`dependency-styles.ts`).
 */
export const assetsPlugin = (state: JobState): Plugin => ({
  name: 'dolphy-ext:assets',
  enforce: 'pre',
  load: loadDependencyStyle,
  // Vite resolves `new URL(…, import.meta.url)` itself, bypassing `resolveId`: the mark goes into the literal
  transform(code, id) {
    const file = cleanId(id);
    if (file.includes('\0') || !code.includes('import.meta.url')) return null;
    const marked = code.replace(
      URL_EXPRESSION,
      (expression: string, quote: string, relative: string) =>
        isBig(path.resolve(path.dirname(file), relative))
          ? expression.replace(
              `${quote}${relative}${quote}`,
              `${quote}${relative}?no-inline${quote}`,
            )
          : expression,
    );
    return marked === code ? null : { code: marked, map: null };
  },
  async resolveId(source, importer, options) {
    if (importer === undefined || importer.startsWith('\0')) return null;
    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });
    if (resolved === null || resolved.external === true) return null;
    const file = cleanId(resolved.id);
    const query = resolved.id.slice(file.length);
    if (STYLE_FILE.test(file)) {
      if (TEXT_IMPORT.test(query)) return null;
      const dependency = dependencyStyleId(resolved.id);
      if (dependency !== null) return dependency;
      const message = `'${source}' is imported as a side-effect style sheet, which a bundle cannot carry: import it as text with import css from '${source}?inline' and add it to the page, or ship it as a file in assets/`;
      state.problem = message;
      return this.error(message);
    }
    if (!ASSET_FILE.test(file) || MARKED.test(query)) return null;
    // an image inside an inlined style sheet stays inline: a relative address means nothing in a string
    if (STYLE_FILE.test(cleanId(importer)) || !isBig(file)) return null;
    return {
      ...resolved,
      id: `${resolved.id}${query === '' ? '?' : '&'}no-inline`,
    };
  },
});
