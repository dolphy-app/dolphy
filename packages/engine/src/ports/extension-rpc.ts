/**
 * Порт RPC расширений: вызов обработчика `server.handle` в хосте расширений.
 * Адаптер живёт в `@dolphy-app/extension-host`; ядро знает только этот
 * интерфейс. Проверки «расширение есть и включено» делает сервис
 * `extensions`, порт отвечает за исполнение. Сбой — `ExtensionRpcError`.
 */
import type { ExtensionRpcFailureReason } from '@dolphy-app/engine-contract';

/** Причины, которые знает порт: `disabled` — решение сервиса, до порта не доходит. */
export type ExtensionRpcErrorCause = Exclude<
  ExtensionRpcFailureReason,
  'disabled'
>;

export class ExtensionRpcError extends Error {
  override readonly cause: ExtensionRpcErrorCause;
  readonly extensionId: string;
  readonly rpcName: string;

  constructor(
    cause: ExtensionRpcErrorCause,
    extensionId: string,
    rpcName: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionRpcError';
    this.cause = cause;
    this.extensionId = extensionId;
    this.rpcName = rpcName;
  }
}

export interface ExtensionRpc {
  /** Бросает `ExtensionRpcError`. `input` — JSON вызывающего. */
  invoke(extensionId: string, name: string, input: unknown): Promise<unknown>;
}
