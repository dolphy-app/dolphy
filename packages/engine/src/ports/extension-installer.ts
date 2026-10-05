import type {
  CatalogDto,
  DeprecationDto,
  ExtensionDocsDto,
  ExtensionUpdateDto,
  InstallResultDto,
} from '@dolphy-app/engine-contract';

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
  /** Пометка «устарело», действующая для версии, по последнему известному индексу; `null` — нет. Синхронно, без сети. */
  deprecationOf(id: string, version: string): DeprecationDto | null;
  /**
   * Файл версии из каталога: скачивается (размер и `sha256` сверяются с индексом, иначе `integrity`) и
   * кладётся в дисковый кэш по `sha256`; повторный запрос идёт из кэша. `source` — `cache`, если до
   * каталога не дозвониться и файл взят из кэша. Бросает `ExtensionInstallError`: `not-found` (нет записи,
   * версии или файла в индексе), `limits` (файл больше 1 МиБ), `network`, `integrity`, `catalog-unavailable`.
   */
  versionFile(
    id: string,
    version: string,
    path: string,
  ): Promise<{ bytes: Uint8Array; source: 'catalog' | 'cache' }>;
  /** README и журнал изменений версии (`ExtensionsService.docs`); установленной версии — с диска, без сети. */
  docs(id: string, version?: string): Promise<ExtensionDocsDto>;
  /** Картинка README версии как `data:`-URI (`ExtensionsService.docImage`). */
  docImage(id: string, version: string, path: string): Promise<string>;
}
