import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionDiagnosticDto } from '@dolphy-app/engine-contract';
import type {
  ExtensionDependency,
  ExtensionLogger,
  ExtensionManifest,
  ExtensionPlatform,
  ExtensionTag,
  ServerRegistration,
} from '@dolphy-app/extension-api';
import {
  INSTALL_META_FILE,
  checkCompatibility,
  iconDataUri,
  iconProblem,
  parseInstallMeta,
} from '@dolphy-app/extension-catalog';
import type { InstallMeta } from '@dolphy-app/extension-catalog';
import { orderByDependencies } from './dependencies.ts';
import { formatDiagnostic } from './diagnostics.ts';
import { fingerprintDir } from './fingerprint.ts';
import { parseManifest } from './manifest.ts';

export type ExtensionOrigin = 'bundled' | 'user' | 'dev';

export interface ExtensionRoot {
  dir: string;
  origin: ExtensionOrigin;
}

/**
 * Расширение, найденное на диске: то, что известно без запуска кода. Хост
 * расширений получает кандидатов (`replaceExtensions`), запускает `server`
 * каждого и отвечает его `ServerRegistration`.
 */
export interface ExtensionCandidate {
  id: string;
  version: string;
  origin: ExtensionOrigin;
  dir: string;
  /** Собранная серверная часть (`main.mjs`); `null` — серверной части нет. */
  mainPath: string | null;
  /** Собранная клиентская часть (`client.mjs`); `null` — клиентской части нет. */
  clientPath: string | null;
  name: string | null;
  description: string | null;
  author: string | null;
  /** Пусто — любая платформа. */
  platforms: readonly ExtensionPlatform[];
  minAppVersion: string | null;
  /** Значок как `data:`-URI (`data:image/png|webp;base64,…`); `null` — значка нет. Проверен: формат, размер, геометрия. */
  icon: string | null;
  /** Предупреждения обнаружения: расширение работает. */
  warnings: ExtensionDiagnosticDto[];
  /** Явные теги каталога из манифеста; пусто — теги не заданы. */
  tags: ExtensionTag[];
  /** Расширения, которые нужны этому (`dependencies` манифеста); пусто — нет. Выполнены ли они, решает политика по текущему снимку. */
  dependencies: ExtensionDependency[];
  /** Метаданные установки из каталога (`.dolphy-install.json`); `null` — нет или не читаются; читаются только у origin `user`. */
  install: InstallMeta | null;
  /** Отпечаток файлов каталога (`fingerprintDir`); `''` у расширений из поставки: они не меняются, пока работает приложение. */
  revision: string;
}

/** Кандидат с тем, что его `server` зарегистрировал: набор, по которому работают каталог, диспетчеры и реестр вкладов. */
export type ResolvedExtension = ExtensionCandidate & ServerRegistration;

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
  extensions: ExtensionCandidate[];
  diagnostics: DiscoveryDiagnostic[];
  overridden: OverriddenExtension[];
}

export interface DiscoverOptions {
  /** Порядок значим: более поздний корень побеждает при совпадении id. */
  roots: readonly ExtensionRoot[];
  logger: ExtensionLogger;
  /** false — не проверять существование `main` и `client` (тесты исходных манифестов). */
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

const isDirectory = async (dir: string): Promise<boolean> =>
  (await stat(dir).catch(() => null))?.isDirectory() === true;

const isFile = async (file: string): Promise<boolean> =>
  (await stat(file).catch(() => null))?.isFile() === true;

/** Путь внутри каталога расширения; выход за каталог — ошибка. */
const inside = (dir: string, relative: string): string => {
  const resolved = path.resolve(dir, relative);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error(`path '${relative}' escapes the extension directory`);
  }
  return resolved;
};
/** Путь собранной части расширения (`main`, `client`) внутри каталога; `null` — части нет. */
const resolvePart = async (
  dir: string,
  part: 'main' | 'client',
  file: string | null,
  verifyFiles: boolean,
): Promise<string | null> => {
  if (file === null) return null;
  const target = inside(dir, file);
  if (verifyFiles && !(await isFile(target))) {
    throw new Error(`${part} '${file}' is not a file`);
  }
  return target;
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

export interface InspectOptions {
  /** false — не проверять существование `main` и `client`; по умолчанию true. */
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
      extension: Omit<ExtensionCandidate, 'origin' | 'install' | 'revision'>;
    }
  | { ok: false; id: string; diagnostic: ExtensionDiagnosticDto };

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

/** Полностью разбирает каталог одного расширения; ошибка — диагностика (английский текст — `formatDiagnostic`). */
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
    return {
      ok: true,
      extension: {
        id: manifest.id,
        version: manifest.version,
        dir,
        mainPath: await resolvePart(dir, 'main', manifest.main, verifyFiles),
        clientPath: await resolvePart(
          dir,
          'client',
          manifest.client,
          verifyFiles,
        ),
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        platforms: manifest.platforms,
        minAppVersion: manifest.minAppVersion,
        icon: await resolveIcon(dir, manifest.icon, verifyFiles),
        warnings: [],
        tags: manifest.tags,
        dependencies: manifest.dependencies,
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
  const byId = new Map<string, ExtensionCandidate>();
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
      const extension: ExtensionCandidate = {
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

  // зависимость раньше зависимого: вклады регистрируются в этом порядке
  const extensions = orderByDependencies([...byId.values()]);
  return { extensions, diagnostics, overridden };
};
