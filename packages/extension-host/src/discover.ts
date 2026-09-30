import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_MAIN } from '@lms/extension-api';
import type { ExtensionLogger, ExtensionPermission } from '@lms/extension-api';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseManifest } from './manifest.ts';
import { CONTRIBUTION_POINTS } from './points/index.ts';
import { defaultNote, inside, isFile } from './points/support.ts';
import type { ResolvedContributions } from './points/types.ts';

export type ExtensionOrigin = 'bundled' | 'user' | 'dev';

export interface ExtensionRoot {
  dir: string;
  origin: ExtensionOrigin;
}

export interface ResolvedExtension extends ResolvedContributions {
  id: string;
  version: string;
  origin: ExtensionOrigin;
  dir: string;
  /** `null` — расширению код не нужен. */
  mainPath: string | null;
  /** Объявленные в манифесте возможности кода; по умолчанию пусто. */
  permissions: ExtensionPermission[];
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

const resolveMain = async (
  dir: string,
  main: string | null,
  verifyFiles: boolean,
): Promise<string | null> => {
  if (main === null) return null;
  const mainPath = inside(dir, main);
  if (verifyFiles && !(await isFile(mainPath))) {
    throw new Error(
      `main '${main}'${defaultNote(main, DEFAULT_MAIN)} is not a file`,
    );
  }
  return mainPath;
};

const claimsOf = (extension: ResolvedContributions): string[] =>
  CONTRIBUTION_POINTS.flatMap((point) =>
    point.claims(extension[point.key] as never),
  );

const clashMessage = (
  claim: string,
  claimed: ReadonlyMap<string, string>,
): string => {
  const separator = claim.indexOf(':');
  return `${claim.slice(0, separator)} '${claim.slice(separator + 1)}' is already provided by '${claimed.get(claim)}'`;
};

const isDirectory = async (dir: string): Promise<boolean> =>
  (await stat(dir).catch(() => null))?.isDirectory() === true;

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
    const mainPath = await resolveMain(dir, manifest.main, verifyFiles);
    const context = { dir, extensionId: manifest.id, verifyFiles, ajv };
    const resolved: Record<string, unknown> = {};
    for (const point of CONTRIBUTION_POINTS) {
      resolved[point.key] = await point.resolve(
        manifest.contributes[point.key] as never,
        context,
      );
    }
    return {
      ok: true,
      extension: {
        id: manifest.id,
        version: manifest.version,
        dir,
        mainPath,
        permissions: manifest.permissions,
        ...(resolved as unknown as ResolvedContributions),
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
  const claimed = new Map<string, string>();
  for (const extension of byId.values()) {
    const claims = claimsOf(extension);
    const clash = claims.find((claim) => claimed.has(claim));
    if (clash !== undefined) {
      skip(extension.id, extension.origin, clashMessage(clash, claimed));
      continue;
    }
    for (const claim of claims) claimed.set(claim, extension.id);
    extensions.push(extension);
  }
  return { extensions, diagnostics, overridden };
};
