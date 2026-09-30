import { ExtensionInstallError } from '@spirula-app/engine/ports';
import type { ExtensionInstaller } from '@spirula-app/engine/ports';
import type { EngineConfig } from '@spirula-app/engine-contract';
import { EXTENSION_API_VERSION } from '@spirula-app/extension-api';
import type { ExtensionLogger } from '@spirula-app/extension-api';
import {
  contributesOf,
  inspectExtensionDir,
} from '@spirula-app/extension-host';
import type { DiscoveryResult } from '@spirula-app/extension-host';
import { createExtensionInstaller } from '@spirula-app/extension-install';
import type { InstallerOptions } from '@spirula-app/extension-install';

/** Официальный каталог расширений: статические файлы GitHub Pages репозитория каталога. */
export const DEFAULT_EXTENSION_CATALOG_URL =
  'https://spirula-app.github.io/spirula-extensions/index.json';

/** Заданный адрес годится, если это `http(s)`-URL; иначе — официальный (с предупреждением). */
export const resolveCatalogUrl = (
  configured: string | undefined,
  logger: ExtensionLogger,
): string => {
  if (configured === undefined) return DEFAULT_EXTENSION_CATALOG_URL;
  try {
    const { protocol } = new URL(configured);
    if (protocol === 'https:' || protocol === 'http:') return configured;
  } catch {
    // сообщение ниже
  }
  logger.warn(
    { extensionCatalogUrl: configured },
    'extension catalog url is invalid, using the official one',
  );
  return DEFAULT_EXTENSION_CATALOG_URL;
};

/** Без пользовательского каталога ставить некуда: каталог и установка недоступны, обновлений нет. */
export const createUnavailableInstaller = (): ExtensionInstaller => {
  const unavailable = (): never => {
    throw new ExtensionInstallError(
      'catalog-unavailable',
      null,
      'extension installation is not configured',
    );
  };
  return {
    ready: async () => {},
    catalog: async () => unavailable(),
    install: async () => unavailable(),
    uninstall: async () => unavailable(),
    updates: async () => [],
    checkForUpdates: async () => 0,
    revocationOf: () => null,
  };
};

/** Расширения, которые каталог заменять не вправе: из поставки и режима разработчика (в том числе перекрытые). */
const fixedIds = (discovery: DiscoveryResult): ReadonlySet<string> =>
  new Set([
    ...discovery.extensions
      .filter(({ origin }) => origin !== 'user')
      .map(({ id }) => id),
    ...discovery.overridden
      .filter(({ origin }) => origin !== 'user')
      .map(({ id }) => id),
  ]);

const inspectForInstall =
  (appVersion: string | undefined): InstallerOptions['inspectDir'] =>
  async (directory) => {
    const result = await inspectExtensionDir(directory, {
      ...(appVersion !== undefined && { appVersion }),
    });
    if (!result.ok) return { ok: false, message: result.message };
    const { id, version, permissions, ...rest } = result.extension;
    return {
      ok: true,
      manifest: { id, version, permissions, contributes: contributesOf(rest) },
    };
  };

export interface DesktopInstallerDeps {
  config: Pick<
    EngineConfig,
    'userExtensionsDir' | 'extensionCatalogUrl' | 'appVersion'
  >;
  discovery: DiscoveryResult;
  logger: ExtensionLogger;
  /** По умолчанию глобальный `fetch` процесса движка. */
  fetch?: typeof fetch;
}

/** Установщик расширений процесса движка: сеть — глобальный `fetch`, файлы — пользовательский каталог расширений. */
export const createDesktopInstaller = ({
  config,
  discovery,
  logger,
  fetch: fetchImpl = fetch,
}: DesktopInstallerDeps): ExtensionInstaller => {
  const { userExtensionsDir, appVersion } = config;
  if (userExtensionsDir === undefined) return createUnavailableInstaller();
  return createExtensionInstaller({
    catalogUrl: resolveCatalogUrl(config.extensionCatalogUrl, logger),
    extensionsDir: userExtensionsDir,
    bundledIds: () => fixedIds(discovery),
    appVersion,
    apiVersion: EXTENSION_API_VERSION,
    platform: process.platform,
    inspectDir: inspectForInstall(appVersion),
    logger,
    fetch: fetchImpl,
  });
};
