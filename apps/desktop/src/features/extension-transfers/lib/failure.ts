import type {
  Diagnostic,
  DiagnosticSummary,
  ExtensionTransferFailureReason,
} from '@dolphy-app/engine-contract';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';

/** Что показать вместо сырой ошибки импорта или экспорта. */
export type TransferFailureKind =
  | 'changed'
  | 'timeout'
  | 'hostDown'
  | 'invalidResult'
  | 'failed'
  | 'tooLarge'
  | 'reloadRejected'
  | 'importExpired'
  | 'courseGone';

export interface TransferFailure {
  kind: TransferFailureKind;
  /** Текст расширения или движка как есть (данные, не переводится). */
  message: string;
  /** Диагностики отвергнутого импорта (`reload-rejected`); иначе пусто. */
  diagnostics: Diagnostic[];
  summary: DiagnosticSummary | null;
}

const KIND_BY_REASON: Record<
  ExtensionTransferFailureReason,
  TransferFailureKind
> = {
  'unknown-importer': 'changed',
  'unknown-exporter': 'changed',
  disabled: 'changed',
  replaced: 'changed',
  timeout: 'timeout',
  'host-down': 'hostDown',
  'invalid-result': 'invalidResult',
  'handler-failed': 'failed',
  'too-large': 'tooLarge',
  'reload-rejected': 'reloadRejected',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSummary = (value: unknown): value is DiagnosticSummary =>
  isRecord(value) &&
  typeof value['errors'] === 'number' &&
  typeof value['warnings'] === 'number';

/** Сбой повтором не лечится: перезагрузка отвергла импорт или ожидающего импорта больше нет. */
export const isFinalFailure = (failure: TransferFailure): boolean =>
  failure.kind === 'reloadRejected' ||
  failure.kind === 'importExpired' ||
  failure.kind === 'changed';

/**
 * Ошибка `runImporter`/`commitImport`/`runExporter` → вид сообщения.
 * `NOT_FOUND`: у `commitImport` ожидающего импорта больше нет, у `runExporter`
 * курс исчез; чужие ошибки — `failed`.
 */
export const describeTransferFailure = (
  error: unknown,
  context: 'import' | 'export',
): TransferFailure => {
  const message = error instanceof Error ? error.message : String(error);
  const plain = {
    message,
    diagnostics: [],
    summary: null,
  } satisfies Omit<TransferFailure, 'kind'>;
  if (!(error instanceof EngineCallError)) return { kind: 'failed', ...plain };
  if (error.code === 'NOT_FOUND') {
    return {
      kind: context === 'import' ? 'importExpired' : 'courseGone',
      ...plain,
    };
  }
  if (error.code !== 'EXTENSION_TRANSFER_FAILED') {
    return { kind: 'failed', ...plain };
  }
  const reason = error.details?.['reason'];
  const kind =
    typeof reason === 'string' && Object.hasOwn(KIND_BY_REASON, reason)
      ? KIND_BY_REASON[reason as ExtensionTransferFailureReason]
      : 'failed';
  const diagnostics = error.details?.['diagnostics'];
  const summary = error.details?.['summary'];
  return {
    kind,
    message,
    diagnostics: Array.isArray(diagnostics) ? (diagnostics as Diagnostic[]) : [],
    summary: isSummary(summary) ? summary : null,
  };
};
