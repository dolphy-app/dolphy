import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseAst } from 'vite';

/** Именованные записи `src/index.ts`, из которых собираются браузерные файлы. */
export const RECORDS = ['views', 'panels', 'markdown'] as const;
export type RecordName = (typeof RECORDS)[number];

/** Один ключ записи: имя и диапазон свойства в исходнике. */
export interface RecordKey {
  name: string;
  start: number;
  end: number;
}

/** Объектный литерал записи (`export const views = { … }`) там, где он написан. */
export interface RecordSite {
  file: string;
  source: string;
  /** Диапазон самого литерала `{ … }`. */
  start: number;
  end: number;
  keys: RecordKey[];
}

export type RecordResult =
  | { status: 'found'; site: RecordSite }
  /** Экспорт есть, но ключей по исходнику не определить. */
  | { status: 'opaque'; reason: string }
  | { status: 'missing' };

export interface IndexAnalysis {
  /** Файлы, которые разбор прочитал: их правка меняет результат. */
  files: string[];
  hasHost: boolean;
  records: Record<RecordName, RecordResult>;
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

const nameOf = (node: AstNode): string =>
  node.type === 'Identifier'
    ? (node.name as string)
    : String((node as { value?: unknown }).value);

const isFile = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null))?.isFile() === true;

/** Относительный импорт → файл исходника; пакеты и `node:*` не разбираются. */
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

const propertyKeys = (
  literal: AstNode,
): { keys: RecordKey[] } | { reason: string } => {
  const keys: RecordKey[] = [];
  for (const property of children(literal, 'properties')) {
    if (property.type !== 'Property') {
      return { reason: 'it uses a spread or a computed entry' };
    }
    const key = child(property, 'key');
    const isStatic = property.computed !== true || key.type === 'Literal';
    if (!isStatic) return { reason: 'it uses a computed key' };
    keys.push({
      name: nameOf(key),
      start: property.start,
      end: property.end,
    });
  }
  return { keys };
};

/**
 * Статический разбор `src/index.ts` без исполнения кода автора: есть ли экспорт
 * `host` и какие ключи у записей `views`, `panels`, `markdown`. Записи ищутся
 * через локальные константы и относительные реэкспорты; ключи должны быть
 * заданы объектным литералом.
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

  // две функции вызывают друг друга: связываем их через объект
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

  const recordOf = async (name: RecordName): Promise<RecordResult> => {
    const resolved = await walk.export(indexFile, name, 0);
    if (resolved === null) return { status: 'missing' };
    if (resolved.kind === 'opaque') {
      return { status: 'opaque', reason: resolved.reason };
    }
    if (resolved.node.type !== 'ObjectExpression') {
      return { status: 'opaque', reason: 'it is not an object literal' };
    }
    const found = propertyKeys(resolved.node);
    if ('reason' in found) return { status: 'opaque', reason: found.reason };
    return {
      status: 'found',
      site: {
        file: resolved.parsed.file,
        source: resolved.parsed.source,
        start: resolved.node.start,
        end: resolved.node.end,
        keys: found.keys,
      },
    };
  };

  const [views, panels, markdown] = await Promise.all(RECORDS.map(recordOf));
  const hasHost = (await walk.export(indexFile, 'host', 0)) !== null;
  return {
    files: [...cache.keys()],
    hasHost,
    records: {
      views: views as RecordResult,
      panels: panels as RecordResult,
      markdown: markdown as RecordResult,
    },
  };
};

/**
 * Исходник `site.file` с литералом записи, урезанным до `keep`: код отброшенных
 * ключей не попадает в бандл, а значит и их зависимости.
 */
export const pruneRecords = (
  source: string,
  sites: readonly { site: RecordSite; keep: ReadonlySet<string> }[],
): string => {
  let result = source;
  const ordered = [...sites].sort((a, b) => b.site.start - a.site.start);
  for (const { site, keep } of ordered) {
    const kept = site.keys
      .filter((key) => keep.has(key.name))
      .map((key) => source.slice(key.start, key.end));
    result = `${result.slice(
      0,
      site.start,
    )}{ ${kept.join(', ')} }${result.slice(site.end)}`;
  }
  return result;
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

/** Спецификаторы, которые собранный файл ещё импортирует (статически и через `import()`). */
export const importsOf = (code: string): Set<string> => {
  const found = new Set<string>();
  collectImports(parseAst(code, { lang: 'js' }).body, found);
  return found;
};
