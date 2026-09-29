#!/usr/bin/env node
/**
 * Сверка тестов с документом: каждый `T-NN` из §7 и §7.1
 * `engine-ts/design/engine-ts-testing.md` должен встречаться в имени активного
 * `describe`/`it`/`test` (включая `.each`, `.for`, `skipIf`, `runIf`, bench- и
 * type-файлы) в каталогах `test` пакетов (`packages`) и приложений (`apps`).
 *
 * Не считается покрытием: упоминание в комментарии, `skip`/`todo`/`fails`,
 * `describe` без единого активного теста внутри, всё внутри `describe.skip`.
 * `skipIf`/`runIf` считаются активными (пропуск по возможностям среды), но
 * выводятся отдельным списком для ручной проверки.
 *
 * Запуск: `node tools/check-test-coverage.mjs [--root <dir>] [--doc <file>]`.
 * Код выхода 1 — есть непокрытые номера.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_DOC = 'engine-ts/design/engine-ts-testing.md';
const ID_PATTERN = /\bT-\d{2,}\b/g;
const ROW_PATTERN = /^\|\s*(T-\d{2,})\s*\|/;
const SECTION_START = /^##\s+7\.\s/;
const SECTION_END = /^##\s+(?!7\.)/;
const IGNORED_DIRS = new Set(['node_modules', 'fixtures', 'target', 'dist']);
const TEST_FILE = /\.m?ts$/;
const SUITE_ROOTS = new Set(['describe', 'suite']);
const CASE_ROOTS = new Set(['it', 'test']);
const INACTIVE_MODIFIERS = new Set(['skip', 'todo', 'fails']);
const CONDITIONAL_MODIFIERS = new Set(['skipIf', 'runIf']);

/** Номера из таблиц «№ | Что проверяем» раздела §7 (включая §7.1, §7.2). */
export const extractDocIds = (markdown) => {
  const ids = [];
  let inSection = false;
  for (const line of markdown.split('\n')) {
    if (SECTION_START.test(line)) inSection = true;
    else if (inSection && SECTION_END.test(line)) inSection = false;
    const match = inSection ? ROW_PATTERN.exec(line) : null;
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
};

const textOf = (node) => {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text + node.templateSpans.map((s) => s.literal.text).join('')
    );
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = textOf(node.left);
    const right = textOf(node.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression);
  return null;
};

/** `it.skipIf(x).each(t)` → ['it', 'skipIf', 'each']. */
const chainOf = (expression) => {
  const names = [];
  let node = expression;
  for (;;) {
    if (ts.isCallExpression(node)) node = node.expression;
    else if (ts.isPropertyAccessExpression(node)) {
      names.unshift(node.name.text);
      node = node.expression;
    } else if (ts.isIdentifier(node)) {
      names.unshift(node.text);
      return names;
    } else return null;
  }
};

const isFunction = (node) =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/**
 * Идентификаторы `T-NN` из имён активных тестов одного файла.
 * @returns {{ ids: Map<string, { conditional: boolean }> }}
 */
export const collectFromSource = (source, fileName = 'file.ts') => {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const ids = new Map();
  const add = (name, conditional) => {
    for (const id of name.match(ID_PATTERN) ?? []) {
      const prev = ids.get(id);
      ids.set(id, { conditional: conditional && (prev?.conditional ?? true) });
    }
  };

  // возвращает число активных тестов внутри узла
  const visit = (node, skipped) => {
    let active = 0;
    if (ts.isCallExpression(node)) {
      const chain = chainOf(node.expression);
      const [root, ...modifiers] = chain ?? [];
      const isSuite = SUITE_ROOTS.has(root);
      const isCase = CASE_ROOTS.has(root);
      const name = isSuite || isCase ? textOf(node.arguments[0]) : null;
      if (name !== null) {
        const inactive =
          skipped || modifiers.some((m) => INACTIVE_MODIFIERS.has(m));
        const conditional = modifiers.some((m) => CONDITIONAL_MODIFIERS.has(m));
        if (isCase) {
          const hasBody = node.arguments.slice(1).some(isFunction);
          if (!inactive && hasBody) {
            add(name, conditional);
            active = 1;
          }
        } else {
          for (const arg of node.arguments.slice(1)) {
            if (isFunction(arg)) active += visit(arg.body, inactive);
          }
          if (!inactive && active > 0) add(name, conditional);
          // тела уже обойдены; остальные аргументы (опции) тестов не содержат
          return active;
        }
        return active;
      }
    }
    ts.forEachChild(node, (child) => {
      active += visit(child, skipped);
    });
    return active;
  };
  visit(sourceFile, false);
  return { ids };
};

const listTestFiles = (dir, out = []) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listTestFiles(path, out);
    else if (TEST_FILE.test(entry.name)) out.push(path);
  }
  return out;
};

const testRoots = (root) => {
  const roots = [];
  for (const group of ['packages', 'apps']) {
    let entries;
    try {
      entries = readdirSync(join(root, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory())
        roots.push(join(root, group, entry.name, 'test'));
    }
  }
  return roots;
};

/** Проверка: какие номера документа покрыты активными тестами. */
export const checkCoverage = ({ root, docPath = join(root, DEFAULT_DOC) }) => {
  const docIds = extractDocIds(readFileSync(docPath, 'utf8'));
  const covered = new Map();
  for (const testRoot of testRoots(root)) {
    for (const file of listTestFiles(testRoot)) {
      const { ids } = collectFromSource(readFileSync(file, 'utf8'), file);
      for (const [id, { conditional }] of ids) {
        const files = covered.get(id) ?? [];
        files.push({ file: relative(root, file), conditional });
        covered.set(id, files);
      }
    }
  }
  const missing = docIds.filter((id) => !covered.has(id));
  const conditionalOnly = docIds.filter(
    (id) => covered.has(id) && covered.get(id).every((c) => c.conditional),
  );
  const unknown = [...covered.keys()].filter((id) => !docIds.includes(id));
  return { docIds, covered, missing, conditionalOnly, unknown };
};

const main = () => {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1];
  };
  const root = resolve(
    option('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const doc = option('--doc');
  const { docIds, covered, missing, conditionalOnly, unknown } = checkCoverage({
    root,
    docPath: doc ? resolve(doc) : undefined,
  });
  const done = docIds.length - missing.length;
  console.log(`test coverage: ${done}/${docIds.length}`);
  if (conditionalOnly.length > 0) {
    console.log(
      `only under skipIf/runIf (проверьте условие): ${conditionalOnly.join(', ')}`,
    );
  }
  if (unknown.length > 0) {
    console.log(`метки, которых нет в документе: ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    console.error(`без активного теста: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
  if (docIds.length === 0) {
    console.error('в документе не найдено ни одного T-NN');
    process.exitCode = 1;
  }
  return covered;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
