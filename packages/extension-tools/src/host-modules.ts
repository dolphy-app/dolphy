import MagicString from 'magic-string';
import { parseAst } from 'vite';
import type { Plugin } from 'vite';

/**
 * Modules the app gives to the client code of an extension: the extension
 * imports them as usual, the bundle does not contain them, and the window
 * resolves them to its own instances (one Vue, one Vuetify, one theme).
 */
export const HOST_MODULES: readonly string[] = [
  'vue',
  'vuetify',
  'vuetify/components',
  'vuetify/directives',
];

/** Style sheets of the app: the window already has them, the import is dropped. */
const HOST_STYLES: readonly string[] = ['vuetify/styles'];

/** Name of the host's loader on `globalThis`: `require(name)` returns a promise of the module. */
export const HOST_GLOBAL = '__dolphy';

export const isHostModule = (specifier: string): boolean =>
  HOST_MODULES.includes(specifier);

const isHostStyle = (specifier: string): boolean =>
  HOST_STYLES.includes(specifier);

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const child = (node: AstNode, key: string): AstNode =>
  node[key] as unknown as AstNode;

const children = (node: AstNode, key: string): AstNode[] =>
  node[key] as unknown as AstNode[];

const nameOf = (node: AstNode): string =>
  (node['name'] ?? node['value']) as string;

const newlines = (text: string): string =>
  '\n'.repeat(text.split('\n').length - 1);

/**
 * Replaces the imports of host modules in the generated code of an ES module
 * with reads from the host's loader. A replacement keeps the number of lines
 * of the import it replaces, so source maps stay valid line by line.
 */
export const rewriteHostImports = (code: string): string => {
  const ast = parseAst(code, { lang: 'js' }).body as unknown as AstNode[];
  const result = new MagicString(code);
  let index = 0;
  for (const statement of ast) {
    if (statement.type !== 'ImportDeclaration') continue;
    const specifier = child(statement, 'source')['value'] as string;
    const source = code.slice(statement.start, statement.end);
    if (isHostStyle(specifier)) {
      result.overwrite(statement.start, statement.end, newlines(source));
      continue;
    }
    if (!isHostModule(specifier)) continue;
    const holder = `${HOST_GLOBAL}_${index}`;
    index += 1;
    const lines = [
      `const ${holder} = await globalThis.${HOST_GLOBAL}.require(${JSON.stringify(specifier)});`,
    ];
    const named: string[] = [];
    for (const item of children(statement, 'specifiers')) {
      const local = nameOf(child(item, 'local'));
      if (item.type === 'ImportNamespaceSpecifier') {
        lines.push(`const ${local} = ${holder};`);
      } else if (item.type === 'ImportDefaultSpecifier') {
        lines.push(`const ${local} = ${holder}.default;`);
      } else {
        const imported = nameOf(child(item, 'imported'));
        named.push(imported === local ? local : `${imported}: ${local}`);
      }
    }
    if (named.length > 0)
      lines.push(`const { ${named.join(', ')} } = ${holder};`);
    result.overwrite(
      statement.start,
      statement.end,
      lines.join(' ') + newlines(source),
    );
  }
  return result.toString();
};

/**
 * Build plugin for browser files: marks the host modules external and, in
 * the generated bundle, turns their imports into reads from `globalThis.__dolphy`.
 * The result needs neither an import map nor a CSP change.
 */
export const hostModulesPlugin = (): Plugin => ({
  name: 'dolphy-ext:host-modules',
  enforce: 'pre',
  resolveId(source) {
    if (isHostModule(source) || isHostStyle(source)) {
      return { id: source, external: true };
    }
    return null;
  },
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === 'chunk') file.code = rewriteHostImports(file.code);
    }
  },
});
