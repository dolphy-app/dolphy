/**
 * Порт импорта и экспорта расширений: запуск объявленного импортёра или
 * экспортёра в хосте расширений. Адаптер живёт в `@dolphy-app/extension-host`;
 * ядро знает только этот интерфейс. Проверки «расширение есть, включено,
 * запись объявлена» делает сервис `extensions`, порт отвечает за исполнение,
 * проверку результата и передачу файлов. Сбой — `ExtensionTransferError`.
 * Формы совпадают с `ImportInput`/`ImportResult`/`ExportInput`/`ExportResult`
 * из `@dolphy-app/extension-api` (ядро от него не зависит).
 */
import type { ExtensionTransferFailureReason } from '@dolphy-app/engine-contract';

/**
 * Причины, которые знает порт: `disabled`, `too-large` и `reload-rejected` —
 * решения сервиса `extensions`, до порта (или после него) они не доходят.
 */
export type ExtensionTransferErrorCause = Exclude<
  ExtensionTransferFailureReason,
  'disabled' | 'too-large' | 'reload-rejected'
>;

export class ExtensionTransferError extends Error {
  override readonly cause: ExtensionTransferErrorCause;
  readonly extensionId: string;
  /** Id импортёра или экспортёра. */
  readonly id: string;
  readonly kind: 'import' | 'export';

  constructor(
    cause: ExtensionTransferErrorCause,
    extensionId: string,
    id: string,
    kind: 'import' | 'export',
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionTransferError';
    this.cause = cause;
    this.extensionId = extensionId;
    this.id = id;
    this.kind = kind;
  }
}

/** Файл пользователя: текст UTF-8 либо байты — по `input` импортёра. */
export type TransferImportInput =
  { name: string; text: string } | { name: string; bytes: Uint8Array };

/** Каталог нового курса: путь → текст; пределы и правила путей проверил порт. */
export interface TransferImportResult {
  files: Record<string, string>;
}

/** Что получает экспортёр: снимок курса либо запрос прогресса — по `scope` экспортёра. */
export type TransferExportInput =
  | {
      scope: 'course';
      courseId: string;
      title: string;
      files: Record<string, string>;
    }
  | { scope: 'progress' };

/** Файл для сохранения; имя и размер проверил порт. */
export type TransferExportResult =
  { filename: string; text: string } | { filename: string; bytes: Uint8Array };

export interface ExtensionTransfers {
  /** Бросает `ExtensionTransferError`. */
  runImporter(
    extensionId: string,
    importerId: string,
    input: TransferImportInput,
  ): Promise<TransferImportResult>;
  /** Бросает `ExtensionTransferError`. */
  runExporter(
    extensionId: string,
    exporterId: string,
    input: TransferExportInput,
  ): Promise<TransferExportResult>;
}
