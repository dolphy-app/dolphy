import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MAIN, DEFAULT_RENDERER } from '@lms/extension-api';
import type { ExtensionLogger, JsonSchema } from '@lms/extension-api';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseManifest } from './manifest.ts';

export type ExtensionOrigin = 'bundled' | 'user' | 'dev';

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
  origin: ExtensionOrigin;
  message: string;
}

export interface OverriddenExtension {
  id: string;
  version: string;
  origin: ExtensionOrigin;
  by: { origin: ExtensionOrigin; version: string };
}

export interface DiscoveryResult {
  extensions: ResolvedExtension[];
  diagnostics: DiscoveryDiagnostic[];
  overridden: OverriddenExtension[];
}

export interface DiscoverOptions {
  /** Порядок значим: более поздний корень побеждает при совпадении id. */
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
const resolveSchema = async (
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

const defaultNote = (value: string, fallback: string): string =>
  value === fallback ? ' (default)' : '';

export interface InspectOptions {
  /** false — не проверять существование `main` и `renderer`; по умолчанию true. */
  verifyFiles?: boolean;
  /** Ожидаемый `id` (имя каталога при обнаружении); `null`/не задан — не проверять. */
  expectedId?: string | null;
}

export type InspectResult =
  | { ok: true; extension: Omit<ResolvedExtension, 'origin'> }
  | { ok: false; id: string; message: string };

/** Полностью разбирает каталог одного расширения; ошибка — сообщение для диагностики. */
export const inspectExtensionDir = async (
  directory: string,
  options: InspectOptions = {},
): Promise<InspectResult> => {
  const { verifyFiles = true, expectedId = null } = options;
  const dir = path.resolve(directory);
  const dirName = expectedId ?? path.basename(dir);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
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
  if (expectedId !== null && manifest.id !== expectedId) {
    return {
      ok: false,
      id: dirName,
      message: `directory name '${expectedId}' does not match manifest id '${manifest.id}'`,
    };
  }
  try {
    const mainPath = inside(dir, manifest.main);
    if (verifyFiles && !(await isFile(mainPath))) {
      throw new Error(
        `main '${manifest.main}'${defaultNote(manifest.main, DEFAULT_MAIN)} is not a file`,
      );
    }
    const exerciseTypes: ResolvedExerciseType[] = [];
    for (const contribution of manifest.contributes.exerciseTypes) {
      const renderer = inside(dir, contribution.renderer);
      if (verifyFiles && !(await isFile(renderer))) {
        throw new Error(
          `renderer '${contribution.renderer}'${defaultNote(contribution.renderer, DEFAULT_RENDERER)} is not a file`,
        );
      }
      exerciseTypes.push({
        id: contribution.id,
        specSchema: await resolveSchema(
          ajv,
          dir,
          contribution.specSchema,
          `specSchema of '${contribution.id}'`,
        ),
        answerSchema: await resolveSchema(
          ajv,
          dir,
          contribution.answerSchema,
          `answerSchema of '${contribution.id}'`,
        ),
        element: contribution.element,
        rendererUrl: rendererUrlOf(manifest.id, contribution.renderer),
      });
    }
    return {
      ok: true,
      extension: {
        id: manifest.id,
        version: manifest.version,
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
): Promise<DiscoveryResult> => {
  const { logger, verifyFiles = true } = options;
  const diagnostics: DiscoveryDiagnostic[] = [];
  const overridden: OverriddenExtension[] = [];
  const skip = (
    extensionId: string,
    origin: ExtensionOrigin,
    message: string,
  ): void => {
    diagnostics.push({ extensionId, origin, message });
    logger.warn({ extensionId }, `extension skipped: ${message}`);
  };

  // id расширения → выигравшее; порядок вставки = порядок первого появления
  const byId = new Map<string, ResolvedExtension>();
  for (const root of options.roots) {
    if (!(await isDirectory(root.dir))) continue;
    const names = (await readdir(root.dir)).sort();
    for (const name of names) {
      const dir = path.resolve(root.dir, name);
      if (!(await isDirectory(dir))) continue;
      if (!(await isFile(path.join(dir, 'extension.json')))) continue;
      const loaded = await inspectExtensionDir(dir, {
        verifyFiles,
        expectedId: name,
      });
      if (!loaded.ok) {
        skip(loaded.id, root.origin, loaded.message);
        continue;
      }
      const extension: ResolvedExtension = {
        ...loaded.extension,
        origin: root.origin,
      };
      const previous = byId.get(extension.id);
      if (previous !== undefined) {
        overridden.push({
          id: previous.id,
          version: previous.version,
          origin: previous.origin,
          by: { origin: extension.origin, version: extension.version },
        });
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
      skip(extension.id, extension.origin, clash);
      continue;
    }
    for (const type of extension.exerciseTypes) {
      typeIds.set(type.id, extension.id);
      elements.set(type.element, extension.id);
    }
    extensions.push(extension);
  }
  return { extensions, diagnostics, overridden };
};
