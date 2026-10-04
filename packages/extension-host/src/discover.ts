import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';
import { DEFAULT_MAIN } from '@dolphy-app/extension-api';
import type {
  ExtensionLogger,
  ExtensionManifest,
  ExtensionPermission,
  ExtensionPlatform,
  ExtensionTag,
} from '@dolphy-app/extension-api';
import {
  INSTALL_META_FILE,
  checkCompatibility,
  iconDataUri,
  iconProblem,
  parseInstallMeta,
} from '@dolphy-app/extension-catalog';
import type { InstallMeta } from '@dolphy-app/extension-catalog';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { formatDiagnostic } from './diagnostics.ts';
import { fingerprintDir } from './fingerprint.ts';
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
  name: string | null;
  description: string | null;
  author: string | null;
  /** Пусто — любая платформа. */
  platforms: readonly ExtensionPlatform[];
  minAppVersion: string | null;
  /** Значок как `data:`-URI (`data:image/png|webp;base64,…`); `null` — значка нет. Проверен: формат, размер, геометрия. */
  icon: string | null;
  /** Явные теги каталога из манифеста; пусто — теги не заданы. */
  tags: ExtensionTag[];
  /** Метаданные установки из каталога (`.dolphy-install.json`); `null` — нет или не читаются; читаются только у origin `user`. */
  install: InstallMeta | null;
  /** Отпечаток файлов каталога (`fingerprintDir`); `''` у расширений из поставки: они не меняются, пока работает приложение. */
  revision: string;
}

export interface DiscoveryDiagnostic {
  extensionId: string;
  origin: ExtensionOrigin;
  diagnostic: ExtensionDiagnosticDto;
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
  /** Версия приложения; не задана — `minAppVersion` не проверяется. */
  appVersion?: string;
  /** Текущая платформа; по умолчанию `process.platform`. */
  platform?: string;
}

const compatibilityIssue = (
  manifest: ExtensionManifest,
  appVersion: string | undefined,
  platform: string,
): ExtensionDiagnosticDto | null => {
  const failure = checkCompatibility(manifest, { appVersion, platform });
  if (failure === null) return null;
  return failure.reason === 'app'
    ? {
        code: 'requires-app',
        data: { minAppVersion: manifest.minAppVersion ?? '' },
      }
    : { code: 'unavailable-platform', data: { platform } };
};

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

/**
 * Значок манифеста как `data:`-URI. Читается при обнаружении (≤16 КиБ), снимок
 * обнаружения хранит результат до следующего обнаружения; `verifyFiles: false` файл не читает.
 * Ссылка вместо файла не допускается.
 */
const resolveIcon = async (
  dir: string,
  icon: string | null,
  verifyFiles: boolean,
): Promise<string | null> => {
  if (icon === null || !verifyFiles) return null;
  const target = inside(dir, icon);
  if (!(await lstat(target).catch(() => null))?.isFile()) {
    throw new Error(`icon '${icon}' is not a file`);
  }
  const bytes = await readFile(target);
  const problem = iconProblem(icon, bytes);
  if (problem !== null) throw new Error(problem);
  return iconDataUri(icon, bytes);
};

const claimsOf = (extension: ResolvedContributions): string[] =>
  CONTRIBUTION_POINTS.flatMap((point) =>
    point.claims(extension[point.key] as never),
  );

const clashDiagnostic = (
  claim: string,
  claimed: ReadonlyMap<string, string>,
): ExtensionDiagnosticDto => {
  const separator = claim.indexOf(':');
  return {
    code: 'claim-clash',
    data: {
      kind: claim.slice(0, separator),
      name: claim.slice(separator + 1),
      by: claimed.get(claim) ?? '',
    },
  };
};

const isDirectory = async (dir: string): Promise<boolean> =>
  (await stat(dir).catch(() => null))?.isDirectory() === true;

export interface InspectOptions {
  /** false — не проверять существование `main` и `renderer`; по умолчанию true. */
  verifyFiles?: boolean;
  /** Ожидаемый `id` (имя каталога при обнаружении); `null`/не задан — не проверять. */
  expectedId?: string | null;
  /** Версия приложения; не задана — `minAppVersion` не проверяется. */
  appVersion?: string;
  /** Текущая платформа; по умолчанию `process.platform`. */
  platform?: string;
}

export type InspectResult =
  | {
      ok: true;
      extension: Omit<ResolvedExtension, 'origin' | 'install' | 'revision'>;
    }
  | { ok: false; id: string; diagnostic: ExtensionDiagnosticDto };

/** Полностью разбирает каталог одного расширения; ошибка — диагностика (английский текст — `formatDiagnostic`). */
/** Нет файла — `null` (расширение скопировано вручную); битый файл — `null` и предупреждение: сведения об установке не ломают обнаружение. */
const readInstallMeta = async (
  dir: string,
  extensionId: string,
  logger: ExtensionLogger,
): Promise<InstallMeta | null> => {
  let text: string;
  try {
    text = await readFile(path.join(dir, INSTALL_META_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ extensionId, error }, `${INSTALL_META_FILE} is unreadable`);
    }
    return null;
  }
  try {
    return parseInstallMeta(JSON.parse(text));
  } catch (error) {
    logger.warn({ extensionId, error }, `${INSTALL_META_FILE} is invalid`);
    return null;
  }
};

export const inspectExtensionDir = async (
  directory: string,
  options: InspectOptions = {},
): Promise<InspectResult> => {
  const {
    verifyFiles = true,
    expectedId = null,
    appVersion,
    platform = process.platform,
  } = options;
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
      diagnostic: {
        code: 'manifest-unreadable',
        data: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok)
    return { ok: false, id: dirName, diagnostic: parsed.diagnostic };
  const { manifest } = parsed;
  if (expectedId !== null && manifest.id !== expectedId) {
    return {
      ok: false,
      id: dirName,
      diagnostic: {
        code: 'id-mismatch',
        data: { expected: expectedId, actual: manifest.id },
      },
    };
  }
  const incompatible = compatibilityIssue(manifest, appVersion, platform);
  if (incompatible !== null) {
    return { ok: false, id: manifest.id, diagnostic: incompatible };
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
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        platforms: manifest.platforms,
        minAppVersion: manifest.minAppVersion,
        icon: await resolveIcon(dir, manifest.icon, verifyFiles),
        tags: manifest.tags,
        ...(resolved as unknown as ResolvedContributions),
      },
    };
  } catch (error) {
    return {
      ok: false,
      id: manifest.id,
      diagnostic: {
        code: 'load-failed',
        data: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
};

export const discoverExtensions = async (
  options: DiscoverOptions,
): Promise<DiscoveryResult> => {
  const { logger, verifyFiles = true, appVersion, platform } = options;
  const diagnostics: DiscoveryDiagnostic[] = [];
  const overridden: OverriddenExtension[] = [];
  const skip = (
    extensionId: string,
    origin: ExtensionOrigin,
    diagnostic: ExtensionDiagnosticDto,
  ): void => {
    diagnostics.push({ extensionId, origin, diagnostic });
    logger.warn(
      { extensionId },
      `extension skipped: ${formatDiagnostic(diagnostic)}`,
    );
  };

  // id расширения → выигравшее; порядок вставки = порядок первого появления
  const byId = new Map<string, ResolvedExtension>();
  for (const root of options.roots) {
    if (!(await isDirectory(root.dir))) continue;
    // `.staging`, `.trash`, `.catalog` — служебные каталоги установщика
    const names = (await readdir(root.dir))
      .filter((name) => !name.startsWith('.'))
      .sort();
    for (const name of names) {
      const dir = path.resolve(root.dir, name);
      if (!(await isDirectory(dir))) continue;
      if (!(await isFile(path.join(dir, 'extension.json')))) continue;
      const loaded = await inspectExtensionDir(dir, {
        verifyFiles,
        expectedId: name,
        ...(appVersion !== undefined && { appVersion }),
        ...(platform !== undefined && { platform }),
      });
      if (!loaded.ok) {
        skip(loaded.id, root.origin, loaded.diagnostic);
        continue;
      }
      const extension: ResolvedExtension = {
        ...loaded.extension,
        origin: root.origin,
        revision: root.origin === 'bundled' ? '' : await fingerprintDir(dir),
        install:
          root.origin === 'user'
            ? await readInstallMeta(dir, loaded.extension.id, logger)
            : null,
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
      skip(extension.id, extension.origin, clashDiagnostic(clash, claimed));
      continue;
    }
    for (const claim of claims) claimed.set(claim, extension.id);
    extensions.push(extension);
  }
  return { extensions, diagnostics, overridden };
};
