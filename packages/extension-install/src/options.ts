import type { ExtensionContributesDto } from '@dolphy-app/engine-contract';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { InstallerFs } from './fs.ts';

/** Разобранный манифест установленного в стейджинг каталога. */
export interface InspectedManifest {
  id: string;
  version: string;
  permissions: readonly string[];
  /** Значок как `data:`-URI (проверенный файл манифеста); `null` — значка нет. */
  icon: string | null;
  /** Теги манифеста; порядок не важен при сверке. */
  tags: readonly string[];
  /** Идентификаторы вкладов в том же виде, что в записи индекса. */
  contributes: ExtensionContributesDto;
}

export type InspectResult =
  { ok: true; manifest: InspectedManifest } | { ok: false; message: string };

export interface InstallerOptions {
  /** Адрес каталога (рядом лежит `index.v2.json`); origin этого адреса — единственный разрешённый для запросов. */
  catalogUrl: string;
  /** Пользовательский корень расширений (`<userData>/extensions`). */
  extensionsDir: string;
  /** Идентификаторы расширений из поставки и режима разработчика: их заменить нельзя. */
  bundledIds: () => ReadonlySet<string>;
  /** Версия приложения; `undefined` — `minAppVersion` не проверяется. */
  appVersion: string | undefined;
  apiVersion: number;
  platform: string;
  /** Проверяет каталог как обычное расширение (обёртка над `inspectExtensionDir`). */
  inspectDir(directory: string): Promise<InspectResult>;
  logger: ExtensionLogger;
  fetch?: typeof fetch;
  fs?: InstallerFs;
  now?: () => number;
  /** По умолчанию `dolphy/<appVersion ?? 'dev'>`. */
  userAgent?: string;
  /** Возраст кэша индекса, младше которого `catalog()` не ходит в сеть; по умолчанию 10 минут. */
  cacheMaxAgeMs?: number;
  /** Таймаут одного запроса вместе с телом ответа; по умолчанию 15 секунд. */
  requestTimeoutMs?: number;
}
