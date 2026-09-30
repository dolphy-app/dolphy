import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionLogger, JsonSchema } from '@lms/extension-api';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseManifest } from './manifest.ts';

export type ExtensionOrigin = 'bundled' | 'user';

export interface ExtensionRoot {
  dir: string;
  origin: ExtensionOrigin;
}

export interface ResolvedExerciseType {
  id: string;
  specSchema: JsonSchema;
  answerSchema: JsonSchema;
  element: string;
  rendererUrl: string;
}

export interface ResolvedExtension {
  id: string;
  version: string;
  origin: ExtensionOrigin;
  dir: string;
  mainPath: string;
  exerciseTypes: ResolvedExerciseType[];
}

export interface DiscoveryDiagnostic {
  extensionId: string;
  message: string;
}

export interface DiscoverOptions {
  /** Порядок значим: bundled раньше user. */
  roots: readonly ExtensionRoot[];
  logger: ExtensionLogger;
  /** false — не проверять существование `main` и `renderer` (тесты исходных манифестов). */
  verifyFiles?: boolean;
}

const isFile = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null))?.isFile() === true;

const isDirectory = async (dir: string): Promise<boolean> =>
  (await stat(dir).catch(() => null))?.isDirectory() === true;

/** Путь внутри каталога расширения; выход за каталог — ошибка. */
const inside = (dir: string, relative: string): string => {
  const resolved = path.resolve(dir, relative);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error(`path '${relative}' escapes the extension directory`);
  }
  return resolved;
};

const rendererUrlOf = (id: string, renderer: string): string =>
  `lms-ext://${id}/${renderer
    .replace(/^\.\//, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

const readSchema = async (
  ajv: Ajv2020,
  dir: string,
  relative: string,
): Promise<JsonSchema> => {
  const file = inside(dir, relative);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `schema '${relative}' is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`schema '${relative}' is not an object`);
  }
  try {
    ajv.compile(parsed);
  } catch (error) {
    throw new Error(
      `schema '${relative}' does not compile: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed as JsonSchema;
};

/** Полностью разбирает каталог расширения; ошибка — сообщение для диагностики. */
const loadOne = async (
  dir: string,
  dirName: string,
  origin: ExtensionOrigin,
  verifyFiles: boolean,
  ajv: Ajv2020,
): Promise<
  | { ok: true; extension: ResolvedExtension }
  | { ok: false; id: string; message: string }
> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, 'extension.json'), 'utf8'));
  } catch (error) {
    return {
      ok: false,
      id: dirName,
      message: `extension.json is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok) return { ok: false, id: dirName, message: parsed.message };
  const { manifest } = parsed;
  if (manifest.id !== dirName) {
    return {
      ok: false,
      id: manifest.id,
      message: `directory name '${dirName}' does not match manifest id '${manifest.id}'`,
    };
  }
  try {
    const mainPath = inside(dir, manifest.main);
    if (verifyFiles && !(await isFile(mainPath))) {
      throw new Error(`main '${manifest.main}' is not a file`);
    }
    const exerciseTypes: ResolvedExerciseType[] = [];
    for (const contribution of manifest.contributes.exerciseTypes) {
      const renderer = inside(dir, contribution.renderer);
      if (verifyFiles && !(await isFile(renderer))) {
        throw new Error(`renderer '${contribution.renderer}' is not a file`);
      }
      exerciseTypes.push({
        id: contribution.id,
        specSchema: await readSchema(ajv, dir, contribution.specSchema),
        answerSchema: await readSchema(ajv, dir, contribution.answerSchema),
        element: contribution.element,
        rendererUrl: rendererUrlOf(manifest.id, contribution.renderer),
      });
    }
    return {
      ok: true,
      extension: {
        id: manifest.id,
        version: manifest.version,
        origin,
        dir,
        mainPath,
        exerciseTypes,
      },
    };
  } catch (error) {
    return {
      ok: false,
      id: manifest.id,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const discoverExtensions = async (
  options: DiscoverOptions,
): Promise<{
  extensions: ResolvedExtension[];
  diagnostics: DiscoveryDiagnostic[];
}> => {
  const { logger, verifyFiles = true } = options;
  const diagnostics: DiscoveryDiagnostic[] = [];
  const skip = (extensionId: string, message: string): void => {
    diagnostics.push({ extensionId, message });
    logger.warn({ extensionId }, `extension skipped: ${message}`);
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  // id расширения → выигравшее; порядок вставки = порядок первого появления
  const byId = new Map<string, ResolvedExtension>();
  for (const root of options.roots) {
    if (!(await isDirectory(root.dir))) continue;
    const names = (await readdir(root.dir)).sort();
    for (const name of names) {
      const dir = path.resolve(root.dir, name);
      if (!(await isDirectory(dir))) continue;
      if (!(await isFile(path.join(dir, 'extension.json')))) continue;
      const loaded = await loadOne(dir, name, root.origin, verifyFiles, ajv);
      if (!loaded.ok) {
        skip(loaded.id, loaded.message);
        continue;
      }
      const { extension } = loaded;
      const previous = byId.get(extension.id);
      if (previous !== undefined) {
        logger.info(
          { extensionId: extension.id },
          `extension '${extension.id}' from ${extension.origin} root overrides ${previous.origin} ${previous.version} → ${extension.version}`,
        );
      }
      byId.set(extension.id, extension);
    }
  }

  const extensions: ResolvedExtension[] = [];
  const typeIds = new Map<string, string>();
  const elements = new Map<string, string>();
  for (const extension of byId.values()) {
    const clash = extension.exerciseTypes
      .map((type) => {
        const byType = typeIds.get(type.id);
        if (byType !== undefined) {
          return `exercise type '${type.id}' is already provided by '${byType}'`;
        }
        const byElement = elements.get(type.element);
        if (byElement !== undefined) {
          return `element '${type.element}' is already provided by '${byElement}'`;
        }
        return null;
      })
      .find((message) => message !== null);
    if (clash !== undefined && clash !== null) {
      skip(extension.id, clash);
      continue;
    }
    for (const type of extension.exerciseTypes) {
      typeIds.set(type.id, extension.id);
      elements.set(type.element, extension.id);
    }
    extensions.push(extension);
  }
  return { extensions, diagnostics };
};
