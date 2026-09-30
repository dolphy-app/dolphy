import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_ID_PATTERN } from '@spirula-app/extension-api';
import type { JsonSchema } from '@spirula-app/extension-api';
import type { Ajv2020 } from 'ajv/dist/2020.js';
import { z } from 'zod';

/** Относительный путь внутри каталога расширения: без `..`, `\` и ведущего `/`. */
const isSafeRelativePath = (value: string): boolean =>
  value.length > 0 &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.split('/').includes('..');

export const safePath = (extensions: readonly string[]) =>
  z
    .string()
    .refine(isSafeRelativePath, 'must be a safe relative path')
    .refine(
      (value) => extensions.some((ext) => value.endsWith(ext)),
      `must end with ${extensions.join(' or ')}`,
    );

export const extensionId = z
  .string()
  .max(64)
  .regex(EXTENSION_ID_PATTERN, 'invalid extension id');

/** Пути с нарушением правила «`id` равен id расширения или начинается с ним». */
export const idPrefixIssues = (
  key: string,
  ids: readonly string[],
  owner: string,
): string[] =>
  ids.flatMap((id, index) =>
    id === owner || id.startsWith(`${owner}.`)
      ? []
      : [
          `contributes.${key}.${index}.id: id must be '${owner}' or start with '${owner}.'`,
        ],
  );

export const isFile = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null))?.isFile() === true;

/** Путь внутри каталога расширения; выход за каталог — ошибка. */
export const inside = (dir: string, relative: string): string => {
  const resolved = path.resolve(dir, relative);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error(`path '${relative}' escapes the extension directory`);
  }
  return resolved;
};

export const rendererUrlOf = (id: string, renderer: string): string =>
  `spirula-ext://${id}/${renderer
    .replace(/^\.\//, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

export const defaultNote = (value: string, fallback: string): string =>
  value === fallback ? ' (default)' : '';

/** Проверяет, что файл модуля существует (если проверка включена), и даёт адрес. */
export const resolveModuleUrl = async (
  extensionId: string,
  dir: string,
  file: string,
  fallback: string,
  verifyFiles: boolean,
  label: string,
): Promise<string> => {
  const absolute = inside(dir, file);
  if (verifyFiles && !(await isFile(absolute))) {
    throw new Error(
      `${label} '${file}'${defaultNote(file, fallback)} is not a file`,
    );
  }
  return rendererUrlOf(extensionId, file);
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const compileSchema = (ajv: Ajv2020, schema: JsonSchema, label: string) => {
  try {
    ajv.compile(schema);
  } catch (error) {
    throw new Error(
      `schema ${label} does not compile: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** Схема объектом (копия, заморожена) или файлом внутри каталога расширения. */
export const resolveSchema = async (
  ajv: Ajv2020,
  dir: string,
  source: string | JsonSchema,
  label: string,
): Promise<JsonSchema> => {
  if (typeof source !== 'string') {
    const schema = deepFreeze(structuredClone(source));
    compileSchema(ajv, schema, `${label} (inline)`);
    return schema;
  }
  const file = inside(dir, source);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `schema '${source}' is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`schema '${source}' is not an object`);
  }
  compileSchema(ajv, parsed as JsonSchema, `'${source}'`);
  return parsed as JsonSchema;
};
