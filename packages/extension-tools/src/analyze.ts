import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseAst } from 'vite';

export interface IndexAnalysis {
  /** Files the analysis read: editing any of them changes the result. */
  files: string[];
  hasServer: boolean;
  hasClient: boolean;
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface ParsedFile {
  file: string;
  source: string;
  body: AstNode[];
}

type Resolved =
  | { kind: 'value'; parsed: ParsedFile; node: AstNode }
  | { kind: 'opaque'; reason: string };

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs'];
const MAX_HOPS = 16;

const child = (node: AstNode, key: string): AstNode =>
  node[key] as unknown as AstNode;

const children = (node: AstNode, key: string): AstNode[] =>
  node[key] as unknown as AstNode[];

const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ParenthesizedExpression',
]);

const unwrap = (node: AstNode): AstNode => {
  let current = node;
  while (WRAPPERS.has(current.type)) current = child(current, 'expression');
  return current;
};

/** Name from an identifier or string literal (`{ a: 1 }`, `{ 'a-b': 1 }`, `export { x as 'y' }`). */
const nameOf = (node: AstNode): string =>
  String(node.type === 'Identifier' ? node.name : node.value);

const isFile = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null))?.isFile() === true;

/** Relative import → source file; packages and `node:*` are not analyzed. */
const resolveRelative = async (
  from: string,
  specifier: string,
): Promise<string | null> => {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const withoutJs = base.replace(/\.(m?js)$/, '');
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${withoutJs}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
};

/**
 * Static analysis of `src/index.ts` without executing author code: whether it
 * exports `server` and `client`. Exports are found through local constants
 * and relative re-exports.
 */
export const analyzeIndex = async (
  indexFile: string,
): Promise<IndexAnalysis> => {
  const cache = new Map<string, Promise<ParsedFile>>();
  const parse = (file: string): Promise<ParsedFile> => {
    let parsed = cache.get(file);
    if (parsed === undefined) {
      parsed = readFile(file, 'utf8').then((source) => {
        const lang = /\.[mc]?ts$/.test(file) ? 'ts' : 'js';
        const ast = parseAst(source, { lang });
        return { file, source, body: ast.body as unknown as AstNode[] };
      });
      cache.set(file, parsed);
    }
    return parsed;
  };

  // the two functions call each other: link them through an object
  const walk = {
    local: async (
      file: string,
      name: string,
      hops: number,
    ): Promise<Resolved | null> => {
      if (hops > MAX_HOPS)
        return { kind: 'opaque', reason: 'it is re-exported too deeply' };
      const parsed = await parse(file);
      for (const statement of parsed.body) {
        const declaration =
          statement.type === 'ExportNamedDeclaration'
            ? (statement.declaration as AstNode | null)
            : statement;
        if (declaration?.type === 'VariableDeclaration') {
          for (const declarator of children(declaration, 'declarations')) {
            const id = child(declarator, 'id');
            if (id.type !== 'Identifier' || id.name !== name) continue;
            const init = declarator.init as AstNode | null;
            if (init === null)
              return { kind: 'opaque', reason: 'it has no initializer' };
            const value = unwrap(init);
            if (value.type === 'Identifier') {
              return walk.local(file, value.name as string, hops + 1);
            }
            return { kind: 'value', parsed, node: value };
          }
        } else if (
          (declaration?.type === 'FunctionDeclaration' ||
            declaration?.type === 'ClassDeclaration') &&
          (declaration.id as AstNode | null)?.name === name
        ) {
          return { kind: 'opaque', reason: 'it is not an object literal' };
        } else if (statement.type === 'ImportDeclaration') {
          for (const specifier of children(statement, 'specifiers')) {
            if (child(specifier, 'local').name !== name) continue;
            if (specifier.type !== 'ImportSpecifier') {
              return {
                kind: 'opaque',
                reason: 'it is imported as a default or namespace',
              };
            }
            const target = await resolveRelative(
              file,
              child(statement, 'source').value as string,
            );
            if (target === null) {
              return {
                kind: 'opaque',
                reason: 'it is imported from a package',
              };
            }
            return walk.export(
              target,
              nameOf(child(specifier, 'imported')),
              hops + 1,
            );
          }
        }
      }
      return null;
    },

    export: async (
      file: string,
      name: string,
      hops: number,
    ): Promise<Resolved | null> => {
      if (hops > MAX_HOPS)
        return { kind: 'opaque', reason: 'it is re-exported too deeply' };
      const parsed = await parse(file);
      const stars: AstNode[] = [];
      for (const statement of parsed.body) {
        if (statement.type === 'ExportAllDeclaration') {
          const exported = statement.exported as AstNode | null;
          if (exported === null) stars.push(statement);
          else if (nameOf(exported) === name) {
            return { kind: 'opaque', reason: 'it is a namespace re-export' };
          }
          continue;
        }
        if (statement.type !== 'ExportNamedDeclaration') continue;
        const declaration = statement.declaration as AstNode | null;
        if (declaration !== null) {
          const declared =
            declaration.type === 'VariableDeclaration'
              ? children(declaration, 'declarations').map((item) =>
                  child(item, 'id'),
                )
              : [declaration.id as AstNode | null];
          if (
            declared.some((id) => id?.type === 'Identifier' && id.name === name)
          ) {
            return walk.local(file, name, hops + 1);
          }
          continue;
        }
        const source = statement.source as AstNode | null;
        for (const specifier of children(statement, 'specifiers')) {
          if (nameOf(child(specifier, 'exported')) !== name) continue;
          const local = nameOf(child(specifier, 'local'));
          if (source === null) return walk.local(file, local, hops + 1);
          const target = await resolveRelative(file, source.value as string);
          if (target === null) {
            return {
              kind: 'opaque',
              reason: 'it is re-exported from a package',
            };
          }
          return walk.export(target, local, hops + 1);
        }
      }
      for (const star of stars) {
        const target = await resolveRelative(
          file,
          child(star, 'source').value as string,
        );
        if (target === null) continue;
        const found = await walk.export(target, name, hops + 1);
        if (found !== null) return found;
      }
      return null;
    },
  };

  const [hasServer, hasClient] = await Promise.all([
    walk.export(indexFile, 'server', 0).then((found) => found !== null),
    walk.export(indexFile, 'client', 0).then((found) => found !== null),
  ]);
  return { files: [...cache.keys()], hasServer, hasClient };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const collectImports = (node: unknown, found: Set<string>): void => {
  if (Array.isArray(node)) {
    for (const item of node) collectImports(item, found);
    return;
  }
  if (!isRecord(node)) return;
  const { source } = node;
  if (
    (node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ImportExpression') &&
    isRecord(source) &&
    typeof source.value === 'string'
  ) {
    found.add(source.value);
  }
  for (const value of Object.values(node)) collectImports(value, found);
};

/** Specifiers the built file still imports (statically and via `import()`). */
export const importsOf = (code: string): Set<string> => {
  const found = new Set<string>();
  collectImports(parseAst(code, { lang: 'js' }).body, found);
  return found;
};

/**
 * Removes binding-less imports (`import "node:fs"`) from the built code that
 * `isDropped` selects. The bundler leaves such imports from the pruned host
 * code; they have no bindings, so removing them is safe.
 */
export const stripBareImports = (
  code: string,
  isDropped: (specifier: string) => boolean,
): string => {
  const ranges: [number, number][] = [];
  for (const statement of parseAst(code, { lang: 'js' })
    .body as unknown as AstNode[]) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (children(statement, 'specifiers').length > 0) continue;
    if (isDropped(child(statement, 'source').value as string)) {
      ranges.push([statement.start, statement.end]);
    }
  }
  let result = code;
  for (const [start, end] of ranges.reverse()) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
};
