import ts from 'typescript';

/**
 * Спецификаторы статических и динамических импортов в JS или `.d.ts`. Разбор идёт
 * сканером TypeScript, поэтому `from '...'` внутри строк и шаблонов не учитывается.
 */
export const collectImports = (code) => {
  const { importedFiles } = ts.preProcessFile(code, true, true);
  return [...new Set(importedFiles.map((item) => item.fileName))].sort();
};
