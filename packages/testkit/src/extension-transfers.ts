import { ExtensionTransferError } from '@dolphy-app/engine/ports';
import type {
  ExtensionTransfers,
  TransferExportInput,
  TransferExportResult,
  TransferImportInput,
  TransferImportResult,
} from '@dolphy-app/engine/ports';

export type FakeTransferCall =
  | {
      kind: 'import';
      extensionId: string;
      id: string;
      input: TransferImportInput;
    }
  | {
      kind: 'export';
      extensionId: string;
      id: string;
      input: TransferExportInput;
    };

export interface FakeExtensionTransfers extends ExtensionTransfers {
  /** Вызовы `runImporter` и `runExporter` по порядку. */
  calls: FakeTransferCall[];
}

export interface FakeTransferHandlers {
  /** Ключ — `<extensionId>/<importerId>`. */
  importers?: Readonly<
    Record<
      string,
      (
        input: TransferImportInput,
      ) => TransferImportResult | Promise<TransferImportResult>
    >
  >;
  /** Ключ — `<extensionId>/<exporterId>`. */
  exporters?: Readonly<
    Record<
      string,
      (
        input: TransferExportInput,
      ) => TransferExportResult | Promise<TransferExportResult>
    >
  >;
}

/**
 * Порт импорта и экспорта с заданными обработчиками (по умолчанию пуст).
 * Исключение обработчика уходит вызывающему как есть; неизвестная запись —
 * `ExtensionTransferError('unknown-importer' | 'unknown-exporter')`.
 */
export const createFakeExtensionTransfers = (
  handlers: FakeTransferHandlers = {},
): FakeExtensionTransfers => {
  const calls: FakeTransferCall[] = [];
  return {
    calls,
    runImporter: async (extensionId, id, input) => {
      calls.push({ kind: 'import', extensionId, id, input });
      const handler = handlers.importers?.[`${extensionId}/${id}`];
      if (handler === undefined) {
        throw new ExtensionTransferError(
          'unknown-importer',
          extensionId,
          id,
          'import',
          `unknown importer '${id}' of '${extensionId}'`,
        );
      }
      return handler(input);
    },
    runExporter: async (extensionId, id, input) => {
      calls.push({ kind: 'export', extensionId, id, input });
      const handler = handlers.exporters?.[`${extensionId}/${id}`];
      if (handler === undefined) {
        throw new ExtensionTransferError(
          'unknown-exporter',
          extensionId,
          id,
          'export',
          `unknown exporter '${id}' of '${extensionId}'`,
        );
      }
      return handler(input);
    },
  };
};
