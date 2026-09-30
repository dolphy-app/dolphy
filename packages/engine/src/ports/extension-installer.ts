import type {
  CatalogDto,
  ExtensionUpdateDto,
  InstallResultDto,
} from '@spirula-app/engine-contract';

export type ExtensionInstallErrorCause =
  | 'not-found'
  | 'incompatible'
  | 'network'
  | 'integrity'
  | 'limits'
  | 'invalid'
  | 'conflict'
  | 'catalog-unavailable';

export class ExtensionInstallError extends Error {
  override readonly cause: ExtensionInstallErrorCause;
  readonly extensionId: string | null;
  constructor(
    cause: ExtensionInstallErrorCause,
    extensionId: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionInstallError';
    this.cause = cause;
    this.extensionId = extensionId;
  }
}

/** Установка расширений из каталога: сеть и файловая система за портом. */
export interface ExtensionInstaller {
  /** Загружает кэш индекса с диска; после `ready` работают `revocationOf` и `updates` без сети. */
  ready(): Promise<void>;
  catalog(options?: { refresh?: boolean }): Promise<CatalogDto>;
  /** Бросает `ExtensionInstallError`; при любой ошибке прежняя установка не затронута. */
  install(id: string, version?: string): Promise<InstallResultDto>;
  /** Удаляет каталог расширения из пользовательского корня. Бросает `ExtensionInstallError` `not-found`. */
  uninstall(id: string): Promise<void>;
  /** Обновления по последнему известному индексу (кэш); сеть не используется. */
  updates(): Promise<ExtensionUpdateDto[]>;
  /** Запрашивает свежий индекс, не бросает: ошибка сети только логируется. Возвращает число доступных обновлений. */
  checkForUpdates(): Promise<number>;
  /** Причина отзыва версии по последнему известному индексу; `null` — не отозвана. Синхронно. */
  revocationOf(id: string, version: string): string | null;
}
