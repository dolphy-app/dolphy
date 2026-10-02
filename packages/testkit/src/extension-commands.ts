import { ExtensionCommandError } from '@dolphy-app/engine/ports';
import type { ExtensionCommands } from '@dolphy-app/engine/ports';
import type { CommandResultDto, JsonValue } from '@dolphy-app/engine-contract';

export interface FakeCommandCall {
  extensionId: string;
  commandId: string;
  args: JsonValue | undefined;
}

export interface FakeExtensionCommands extends ExtensionCommands {
  /** Вызовы `invoke` по порядку. */
  calls: FakeCommandCall[];
}

/**
 * Порт команд с заданными обработчиками по ключу `<extensionId>/<commandId>`
 * (по умолчанию пуст). Исключение обработчика уходит вызывающему как есть;
 * неизвестная команда — `ExtensionCommandError('unknown-command')`.
 */
export const createFakeExtensionCommands = (
  handlers: Readonly<
    Record<
      string,
      (
        args: JsonValue | undefined,
      ) => CommandResultDto | Promise<CommandResultDto>
    >
  > = {},
): FakeExtensionCommands => {
  const calls: FakeCommandCall[] = [];
  return {
    calls,
    invoke: async (extensionId, commandId, args) => {
      calls.push({ extensionId, commandId, args });
      const handler = handlers[`${extensionId}/${commandId}`];
      if (handler === undefined) {
        throw new ExtensionCommandError(
          'unknown-command',
          extensionId,
          commandId,
          `unknown command '${commandId}' of '${extensionId}'`,
        );
      }
      return handler(args);
    },
  };
};
