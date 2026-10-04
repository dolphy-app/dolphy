/**
 * Порт команд расширений: вызов объявленной команды в хосте расширений.
 * Адаптер живёт в `@dolphy-app/extension-host`; ядро знает только этот
 * интерфейс. Проверки «расширение есть, включено, команда объявлена» делает
 * сервис `extensions`, порт отвечает за исполнение. Сбой — `ExtensionCommandError`.
 */
import type {
  CommandResultDto,
  ExtensionCommandFailureReason,
  JsonValue,
} from '@dolphy-app/engine-contract';

/** Причины, которые знает порт: `disabled` — решение сервиса, до порта не доходит. */
export type ExtensionCommandErrorCause = Exclude<
  ExtensionCommandFailureReason,
  'disabled'
>;

export class ExtensionCommandError extends Error {
  override readonly cause: ExtensionCommandErrorCause;
  readonly extensionId: string;
  readonly commandId: string;

  constructor(
    cause: ExtensionCommandErrorCause,
    extensionId: string,
    commandId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionCommandError';
    this.cause = cause;
    this.extensionId = extensionId;
    this.commandId = commandId;
  }
}

export interface ExtensionCommands {
  /** Бросает `ExtensionCommandError`. `args` — JSON вызывающего, `undefined` — без аргументов. */
  invoke(
    extensionId: string,
    commandId: string,
    args: JsonValue | undefined,
  ): Promise<CommandResultDto>;
}
