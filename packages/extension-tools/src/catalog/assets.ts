import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ASSET_EXTENSIONS,
  assetExtensionOf,
  assetSizeLimit,
  extensionOf,
  inspectBinaryAsset,
  isBinaryAsset,
} from '@dolphy-app/extension-catalog';

/**
 * Content checks of the files an extension ships next to its code (style sheets, images,
 * fonts) and of its icon. One module for `catalog check`, `catalog build` and `dolphy-ext
 * build`: a file that passes here is one the protocol may serve and the installer may accept.
 * Every function returns the first problem as a message, `null` when the file is fine.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const MAX_SVG_DEPTH = 32;

/** Where a CSS text lives: a style sheet may reference files of the extension, an SVG only itself. */
export type CssScope = { kind: 'css'; path: string } | { kind: 'svg' };

class AssetProblem extends Error {}

const refuse = (message: string): never => {
  throw new AssetProblem(message);
};

const first = (check: () => void): string | null => {
  try {
    check();
    return null;
  } catch (error) {
    if (error instanceof AssetProblem) return error.message;
    throw error;
  }
};

const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_PART = /[A-Za-z0-9_\u0080-\uffff-]/;
const HEX = /[0-9A-Fa-f]/;
const WHITESPACE = /[ \t\r\n\f]/;

/** Decodes the CSS escape starting after a backslash at `at`; returns the text and the next index. */
const readEscape = (text: string, at: number): [string, number] => {
  let end = at;
  while (end < text.length && end - at < 6 && HEX.test(text[end] ?? '')) end++;
  if (end === at) return [text[at] ?? '', at + 1];
  const code = Number.parseInt(text.slice(at, end), 16);
  const decoded =
    code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
      ? '\ufffd'
      : String.fromCodePoint(code);
  return [decoded, WHITESPACE.test(text[end] ?? '') ? end + 1 : end];
};

const readIdent = (text: string, from: number): [string, number] => {
  let value = '';
  let i = from;
  while (i < text.length) {
    const char = text[i] ?? '';
    if (char === '\\') {
      const [decoded, next] = readEscape(text, i + 1);
      value += decoded;
      i = next;
    } else if (IDENT_PART.test(char)) {
      value += char;
      i++;
    } else break;
  }
  return [value, i];
};

const readString = (
  text: string,
  from: number,
  quote: string,
): [string, number] => {
  let value = '';
  let i = from + 1;
  while (i < text.length) {
    const char = text[i] ?? '';
    if (char === quote) return [value, i + 1];
    if (char === '\n') return [value, i];
    if (char === '\\') {
      if (text[i + 1] === '\n') {
        i += 2;
        continue;
      }
      const [decoded, next] = readEscape(text, i + 1);
      value += decoded;
      i = next;
    } else {
      value += char;
      i++;
    }
  }
  return [value, i];
};

const readUnquotedUrl = (text: string, from: number): [string, number] => {
  let value = '';
  let i = from;
  while (i < text.length) {
    const char = text[i] ?? '';
    if (char === ')') return [value, i + 1];
    if (char === '\\') {
      const [decoded, next] = readEscape(text, i + 1);
      value += decoded;
      i = next;
    } else {
      value += char;
      i++;
    }
  }
  return [value, i];
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DATA_IMAGE_SVG_SCOPE = /^data:image\/(?:png|jpeg|webp)[;,]/i;
const DATA_CSS_SCOPE = /^data:(?:image|font)\/[a-z0-9.+-]+[;,]/i;

/** ASCII whitespace and controls removed: browsers drop them inside a URL, `java\tscript:` is `javascript:`. */
const withoutBlanks = (value: string): string =>
  Array.from(value)
    .filter((char) => char > ' ')
    .join('');

/** `value` is the text of a `url()`; throws when it leaves what the scope allows. */
const checkUrl = (value: string, scope: CssScope): void => {
  const url = withoutBlanks(value);
  if (url === '' || url.startsWith('#')) return;
  if (scope.kind === 'svg') {
    if (!DATA_IMAGE_SVG_SCOPE.test(url)) {
      refuse(
        `url(${value.slice(0, 40)}) is not allowed in SVG: only #id and data:image/png|jpeg|webp`,
      );
    }
    return;
  }
  if (url.toLowerCase().startsWith('data:')) {
    if (DATA_CSS_SCOPE.test(url)) return;
    refuse('url(data:…) is allowed only for images and fonts');
  }
  if (SCHEME.test(url) || url.startsWith('//')) {
    refuse(`url(${value.slice(0, 60)}) points outside the extension`);
  }
  if (url.startsWith('/') || url.includes('\\')) {
    refuse(`url(${value.slice(0, 60)}) must be a relative path`);
  }
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(scope.path), url.split(/[?#]/)[0] ?? ''),
  );
  if (target === '..' || target.startsWith('../')) {
    refuse(`url(${value.slice(0, 60)}) leaves the extension directory`);
  }
};

const FORBIDDEN_FUNCTIONS = new Set(['expression', 'src']);
const IMAGE_SET = new Set(['image-set', '-webkit-image-set']);
const FORBIDDEN_IDENTS = new Set(['-moz-binding', 'behavior']);

/**
 * Walks CSS tokens, so that nothing hides in strings, comments or escapes (`\40import`,
 * `u\72l(`): `@import`, `expression(`, `src()`, `url()` outside the scope, a string
 * as a URL inside `image-set()`.
 */
const scanCss = (text: string, scope: CssScope): void => {
  const functions: string[] = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i] ?? '';
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (char === '"' || char === "'") {
      const [value, next] = readString(text, i, char);
      if (IMAGE_SET.has(functions.at(-1) ?? '')) {
        refuse(
          `a string URL in image-set() is not allowed (${value.slice(0, 40)}); use url()`,
        );
      }
      i = next;
    } else if (
      char === '@' &&
      (IDENT_START.test(text[i + 1] ?? '') || text[i + 1] === '\\')
    ) {
      const [name, next] = readIdent(text, i + 1);
      if (name.toLowerCase() === 'import') refuse('@import is not allowed');
      i = next;
    } else if (IDENT_START.test(char) || char === '\\' || char === '-') {
      const [name, next] = readIdent(text, i);
      const lower = name.toLowerCase();
      if (FORBIDDEN_IDENTS.has(lower)) refuse(`'${name}' is not allowed`);
      if (text[next] === '(') {
        if (FORBIDDEN_FUNCTIONS.has(lower)) refuse(`${lower}( is not allowed`);
        if (lower === 'url') {
          let at = next + 1;
          while (WHITESPACE.test(text[at] ?? '')) at++;
          const quote = text[at] ?? '';
          if (quote === '"' || quote === "'") {
            const [value, end] = readString(text, at, quote);
            checkUrl(value, scope);
            at = end;
            while (WHITESPACE.test(text[at] ?? '')) at++;
            i = text[at] === ')' ? at + 1 : at;
          } else {
            const [value, end] = readUnquotedUrl(text, at);
            checkUrl(value.trim(), scope);
            i = end;
          }
        } else {
          functions.push(lower);
          i = next + 1;
        }
      } else {
        i = next === i ? i + 1 : next;
      }
    } else {
      if (char === '(') functions.push('');
      if (char === ')') functions.pop();
      i++;
    }
  }
};

/**
 * R2: a style sheet without `@import`, `expression(`, `src()`, with `url()` only to
 * `data:image`, `data:font`, `#id` and relative paths inside the extension.
 */
export const validateCss = (text: string, scope: CssScope): string | null =>
  first(() => {
    if (text.includes('\0')) refuse('contains a NUL character');
    scanCss(text, scope);
  });

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'image',
  'style',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feFuncR',
  'feFuncG',
  'feFuncB',
  'feFuncA',
  'feComposite',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
  'feDropShadow',
]);

const ALLOWED_ATTRIBUTES = new Set(
  [
    'id class style lang role xml:space xmlns xmlns:xlink version',
    'viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry fx fy fr',
    'd points transform transform-origin transform-box pathLength',
    'gradientUnits gradientTransform spreadMethod offset',
    'patternUnits patternContentUnits patternTransform',
    'clipPathUnits maskUnits maskContentUnits filterUnits primitiveUnits',
    'stop-color stop-opacity fill fill-opacity fill-rule clip-rule',
    'stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit',
    'stroke-dasharray stroke-dashoffset stroke-opacity vector-effect',
    'opacity color display visibility overflow clip-path mask filter',
    'mix-blend-mode isolation paint-order shape-rendering text-rendering',
    'image-rendering color-interpolation color-interpolation-filters',
    'font-family font-size font-style font-weight font-variant font-stretch',
    'text-anchor text-decoration dominant-baseline alignment-baseline baseline-shift',
    'letter-spacing word-spacing textLength lengthAdjust dx dy rotate',
    'writing-mode direction unicode-bidi',
    'marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient',
    'href xlink:href',
    'in in2 result stdDeviation mode type values operator k1 k2 k3 k4',
    'flood-color flood-opacity tableValues slope intercept amplitude exponent',
  ]
    .join(' ')
    .split(' '),
);

const PLAIN_ATTRIBUTE_FAMILIES = /^(?:data|aria)-[a-z0-9-]+$/;
const FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const XML_DECLARATION =
  /^<\?xml\s+version\s*=\s*["']1\.\d["'](?:\s+encoding\s*=\s*["'][A-Za-z0-9._-]+["'])?(?:\s+standalone\s*=\s*["'](?:yes|no)["'])?\s*\?>$/;
const ENTITY_REFERENCE = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9A-Fa-f]+));/g;

/** Resolves the five predefined and the numeric references; any other `&` is an error. */
const decodeEntities = (value: string): string => {
  const decoded = value.replace(
    ENTITY_REFERENCE,
    (_match, name: string | undefined, dec?: string, hex?: string) => {
      if (name !== undefined) {
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] ?? '';
      }
      const code = Number.parseInt(
        dec ?? hex ?? '',
        dec === undefined ? 16 : 10,
      );
      if (code === 0 || code > 0x10ffff) refuse('invalid character reference');
      return String.fromCodePoint(code);
    },
  );
  if (value.replace(ENTITY_REFERENCE, '').includes('&')) {
    refuse('entity references other than the predefined ones are not allowed');
  }
  return decoded;
};

const checkHref = (element: string, value: string): void => {
  if (FRAGMENT.test(value)) return;
  if (DATA_IMAGE_SVG_SCOPE.test(withoutBlanks(value))) {
    if (element === 'use') refuse("<use> may reference only '#id'");
    return;
  }
  refuse(
    `href '${value.slice(0, 40)}' is not allowed: only #id and data:image/png|jpeg|webp`,
  );
};

const checkAttribute = (
  element: string,
  name: string,
  rawValue: string,
): void => {
  if (/^on/i.test(name)) refuse(`event handler attribute '${name}'`);
  const value = decodeEntities(rawValue);
  if (name === 'xmlns') {
    if (value !== SVG_NAMESPACE) refuse(`xmlns must be ${SVG_NAMESPACE}`);
    return;
  }
  if (name === 'xmlns:xlink') {
    if (value !== XLINK_NAMESPACE)
      refuse(`xmlns:xlink must be ${XLINK_NAMESPACE}`);
    return;
  }
  if (name.startsWith('xmlns')) refuse(`namespace declaration '${name}'`);
  if (!ALLOWED_ATTRIBUTES.has(name) && !PLAIN_ATTRIBUTE_FAMILIES.test(name)) {
    refuse(`attribute '${name}' of <${element}> is not allowed`);
  }
  if (name === 'href' || name === 'xlink:href') {
    checkHref(element, value);
    return;
  }
  const problem = validateCss(value, { kind: 'svg' });
  if (problem !== null) refuse(`attribute '${name}': ${problem}`);
};

interface Frame {
  name: string;
  text: string;
}

const readStartTag = (
  text: string,
  from: number,
): {
  name: string;
  attributes: [string, string][];
  selfClosing: boolean;
  next: number;
} => {
  let i = from + 1;
  const nameStart = i;
  while (i < text.length && /[^\s/>]/.test(text[i] ?? '')) i++;
  const name = text.slice(nameStart, i);
  if (name.includes(':')) refuse(`namespaced element <${name}> is not allowed`);
  if (!NAME.test(name)) refuse(`malformed element name '${name.slice(0, 20)}'`);
  const attributes: [string, string][] = [];
  const seen = new Set<string>();
  for (;;) {
    while (WHITESPACE.test(text[i] ?? '')) i++;
    const char = text[i];
    if (char === undefined) return refuse(`<${name}> is not closed`);
    if (char === '>')
      return { name, attributes, selfClosing: false, next: i + 1 };
    if (char === '/') {
      if (text[i + 1] !== '>') refuse(`malformed <${name}> tag`);
      return { name, attributes, selfClosing: true, next: i + 2 };
    }
    const attributeStart = i;
    while (i < text.length && /[^\s=/>]/.test(text[i] ?? '')) i++;
    const attribute = text.slice(attributeStart, i);
    if (!ATTRIBUTE_NAME.test(attribute)) {
      refuse(`malformed attribute '${attribute.slice(0, 20)}' in <${name}>`);
    }
    while (WHITESPACE.test(text[i] ?? '')) i++;
    if (text[i] !== '=') refuse(`attribute '${attribute}' has no value`);
    i++;
    while (WHITESPACE.test(text[i] ?? '')) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'")
      refuse(`attribute '${attribute}' is not quoted`);
    const end = text.indexOf(quote ?? '"', i + 1);
    if (end === -1) refuse(`attribute '${attribute}' is not closed`);
    const value = text.slice(i + 1, end);
    if (value.includes('<')) refuse(`attribute '${attribute}' contains '<'`);
    if (seen.has(attribute)) refuse(`duplicate attribute '${attribute}'`);
    seen.add(attribute);
    attributes.push([attribute, value]);
    i = end + 1;
  }
};

const closeFrame = (stack: Frame[]): void => {
  const frame = stack.pop();
  if (frame?.name !== 'style') return;
  const problem = validateCss(frame.text, { kind: 'svg' });
  if (problem !== null) refuse(`<style>: ${problem}`);
};

const walkSvg = (text: string): void => {
  const stack: Frame[] = [];
  let roots = 0;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) refuse('unterminated comment');
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) refuse('unterminated CDATA section');
      const top = stack.at(-1);
      if (top === undefined) refuse('CDATA outside the root element');
      else top.text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      const declaration = end === -1 ? '' : text.slice(i, end + 2);
      if (i !== 0 || !XML_DECLARATION.test(declaration)) {
        refuse(
          'processing instructions other than the XML declaration are not allowed',
        );
      }
      i = end + 2;
    } else if (text.startsWith('<!', i)) {
      refuse('DOCTYPE, ENTITY and other declarations are not allowed');
    } else if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      if (end === -1) refuse('unterminated closing tag');
      const name = text.slice(i + 2, end).trim();
      if (stack.at(-1)?.name !== name) refuse(`unexpected </${name}>`);
      closeFrame(stack);
      i = end + 1;
    } else if (text[i] === '<') {
      const tag = readStartTag(text, i);
      const isRoot = stack.length === 0;
      if (isRoot) {
        roots++;
        if (roots > 1) refuse('more than one root element');
        if (tag.name !== 'svg')
          refuse(`root element must be <svg>, it is <${tag.name}>`);
        if (!tag.attributes.some(([name]) => name === 'xmlns')) {
          refuse(`<svg> must declare xmlns="${SVG_NAMESPACE}"`);
        }
      }
      if (!ALLOWED_ELEMENTS.has(tag.name)) {
        refuse(`element <${tag.name}> is not allowed`);
      }
      if (stack.length >= MAX_SVG_DEPTH) refuse('elements are nested too deep');
      if (tag.name === 'style') {
        const type = tag.attributes.find(([name]) => name === 'type')?.[1];
        if (type !== undefined && type !== 'text/css') {
          refuse('<style> must be text/css');
        }
      }
      for (const [name, value] of tag.attributes) {
        checkAttribute(tag.name, name, value);
      }
      stack.push({ name: tag.name, text: '' });
      if (tag.selfClosing) closeFrame(stack);
      i = tag.next;
    } else {
      const end = text.indexOf('<', i);
      const chunk = text.slice(i, end === -1 ? text.length : end);
      const top = stack.at(-1);
      if (top === undefined) {
        if (chunk.trim() !== '') refuse('text outside the root element');
      } else top.text += decodeEntities(chunk);
      i = end === -1 ? text.length : end;
    }
  }
  if (stack.length > 0) refuse(`<${stack.at(-1)?.name}> is not closed`);
  if (roots === 0) refuse('no root element');
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
      .decode(bytes)
      .replace(/^\ufeff/, '');
  } catch {
    return refuse('is not valid UTF-8');
  }
};

/**
 * R1/R2: an SVG is accepted as an image and only from an allow-list: a well-formed XML
 * document with the `svg` root, known elements and attributes, no scripts, `foreignObject`,
 * event handlers, DOCTYPE or entities, links other than `#id` and `data:image/png|jpeg|webp`.
 */
export const validateSvg = (text: string): string | null =>
  first(() => {
    if (text.includes('\0')) refuse('contains a NUL character');
    walkSvg(text.replace(/^\ufeff/, ''));
  });

/**
 * The type, signature, size and content of one asset file by its extension.
 * `null` for a file that is not an asset or is fine.
 */
export const assetProblem = (
  file: string,
  bytes: Uint8Array,
): string | null => {
  const extension = assetExtensionOf(file);
  if (extension === null) return null;
  const limit = assetSizeLimit(extension);
  if (bytes.length > limit) {
    return `${bytes.length} bytes exceed the limit of ${limit} for .${extension}`;
  }
  if (isBinaryAsset(extension)) {
    const inspected = inspectBinaryAsset(extension, bytes);
    return inspected.ok ? null : inspected.reason;
  }
  return first(() => {
    const text = decodeUtf8(bytes);
    const problem =
      extension === 'svg'
        ? validateSvg(text)
        : validateCss(text, { kind: 'css', path: file });
    if (problem !== null) refuse(problem);
  });
};

export interface AssetFinding {
  path: string;
  message: string;
}

/** An asset written with capital letters in the extension (`Logo.PNG`): the catalog takes lowercase only. */
const hasUppercaseAssetExtension = (file: string): boolean => {
  const extension = extensionOf(file);
  return (
    extension !== null &&
    extension !== extension.toLowerCase() &&
    (ASSET_EXTENSIONS as readonly string[]).includes(extension.toLowerCase())
  );
};

/** Checks every asset among `files` (paths relative to `root`); other files are not read. */
export const assetFindings = async (
  root: string,
  files: readonly string[],
): Promise<AssetFinding[]> => {
  const findings: AssetFinding[] = [];
  for (const file of files) {
    if (hasUppercaseAssetExtension(file)) {
      findings.push({
        path: file,
        message: 'the file extension must be lowercase',
      });
      continue;
    }
    if (assetExtensionOf(file) === null) continue;
    const message = assetProblem(file, await readFile(path.join(root, file)));
    if (message !== null) findings.push({ path: file, message });
  }
  return findings;
};
