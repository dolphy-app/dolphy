import type { ExtensionCommandFailureReason } from '@dolphy-app/engine-contract';
import { EngineCallError } from '@dolphy-app/engine-rpc/client';

/** Что показать вместо сырой ошибки: ключ текста и данные расширения. */
export type CommandFailureKind =
  | 'changed'
  | 'timeout'
  | 'activationTimeout'
  | 'hostDown'
  | 'invalidResult'
  | 'failed';

export interface CommandFailure {
  kind: CommandFailureKind;
  /** Текст расширения или движка как есть (данные, не переводится). */
  message: string;
}

const KIND_BY_REASON: Record<
  ExtensionCommandFailureReason,
  CommandFailureKind
> = {
  'unknown-command': 'changed',
  disabled: 'changed',
  replaced: 'changed',
  timeout: 'timeout',
  'activation-timeout': 'activationTimeout',
  'host-down': 'hostDown',
  'invalid-result': 'invalidResult',
  'handler-failed': 'failed',
};

/** Ошибка `invokeCommand` → вид сообщения; чужие ошибки — `failed`. */
export const describeCommandFailure = (error: unknown): CommandFailure => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof EngineCallError &&
    error.code === 'EXTENSION_COMMAND_FAILED'
  ) {
    const reason = error.details?.['reason'];
    const kind =
      typeof reason === 'string' && Object.hasOwn(KIND_BY_REASON, reason)
        ? KIND_BY_REASON[reason as ExtensionCommandFailureReason]
        : 'failed';
    return { kind, message };
  }
  return { kind: 'failed', message };
};
