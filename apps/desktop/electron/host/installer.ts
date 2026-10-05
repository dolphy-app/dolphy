import { ExtensionInstallError } from '@dolphy-app/engine/ports';
import type { ExtensionInstaller } from '@dolphy-app/engine/ports';
import type { EngineConfig } from '@dolphy-app/engine-contract';
import { EXTENSION_API_VERSION } from '@dolphy-app/extension-api';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import {
  contributesOf,
  formatDiagnostic,
  inspectExtensionDir,
} from '@dolphy-app/extension-host';
import type {
  DiscoveryResult,
  DiscoverySource,
} from '@dolphy-app/extension-host';
import {
  createExtensionInstaller,
  createSwitchableInstaller,
} from '@dolphy-app/extension-install';
import type { InstallerOptions } from '@dolphy-app/extension-install';

/** Официальный каталог расширений: статические файлы GitHub Pages репозитория каталога. */
export const DEFAULT_EXTENSION_CATALOG_URL =
  'https://dolphy-app.github.io/dolphy-extensions/index.json';

/** Адрес из окружения годится, если это `http(s)`-URL; иначе он игнорируется (с предупреждением). */
export const envCatalogUrl = (
  configured: string | undefined,
  logger: ExtensionLogger,
): string | undefined => {
  const valid =
    configured !== undefined &&
    URL.canParse(configured) &&
    /^https?:$/.test(new URL(configured).protocol);
  if (configured !== undefined && !valid) {
    logger.warn(
      { extensionCatalogUrl: configured },
      'extension catalog url is invalid, ignoring it',
    );
  }
  return valid ? configured : undefined;
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
    deprecationOf: () => null,
    catalogSource: () => ({
      url: DEFAULT_EXTENSION_CATALOG_URL,
      default: DEFAULT_EXTENSION_CATALOG_URL,
      origin: 'default',
    }),
    useCatalog: async () => {},
    versionFile: async () => unavailable(),
    docs: async () => unavailable(),
    docImage: async () => unavailable(),
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
    if (!result.ok)
      return { ok: false, message: formatDiagnostic(result.diagnostic) };
    const { id, version, permissions, icon, tags, ...rest } = result.extension;
    return {
      ok: true,
      manifest: {
        id,
        version,
        permissions,
        icon,
        tags,
        contributes: contributesOf(rest),
      },
    };
  };

export interface DesktopInstallerDeps {
  config: Pick<
    EngineConfig,
    'userExtensionsDir' | 'extensionCatalogUrl' | 'appVersion'
  >;
  /** Сохранённый адрес каталога (`ExtensionSettingsDto.catalogUrl`); `null` — не задан. Важнее него только адрес окружения. */
  settingUrl: string | null;
  /** Снимок читается при каждом обращении: применённые изменения видны установщику сразу. */
  discovery: DiscoverySource;
  logger: ExtensionLogger;
  /** По умолчанию глобальный `fetch` процесса движка. */
  fetch?: typeof fetch;
}

/**
 * Установщик расширений процесса движка: сеть — глобальный `fetch`, файлы —
 * пользовательский каталог расширений, адрес каталога переключаемый
 * (`DOLPHY_EXTENSION_CATALOG_URL` → настройка → официальный).
 */
export const createDesktopInstaller = ({
  config,
  settingUrl,
  discovery,
  logger,
  fetch: fetchImpl = fetch,
}: DesktopInstallerDeps): ExtensionInstaller => {
  const { userExtensionsDir, appVersion } = config;
  if (userExtensionsDir === undefined) return createUnavailableInstaller();
  const envUrl = envCatalogUrl(config.extensionCatalogUrl, logger);
  return createSwitchableInstaller({
    defaultUrl: DEFAULT_EXTENSION_CATALOG_URL,
    ...(envUrl !== undefined && { envUrl }),
    settingUrl,
    create: (catalogUrl) =>
      createExtensionInstaller({
        catalogUrl,
        extensionsDir: userExtensionsDir,
        bundledIds: () => fixedIds(discovery.get()),
        appVersion,
        apiVersion: EXTENSION_API_VERSION,
        platform: process.platform,
        inspectDir: inspectForInstall(appVersion),
        logger,
        fetch: fetchImpl,
      }),
  });
};
