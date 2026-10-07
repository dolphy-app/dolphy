import { ExtensionRpcError } from '@dolphy-app/engine/ports';
import type { ExtensionRpc } from '@dolphy-app/engine/ports';

export interface FakeRpcCall {
  extensionId: string;
  name: string;
  input: unknown;
}

export interface FakeExtensionRpc extends ExtensionRpc {
  /** Вызовы `invoke` по порядку. */
  calls: FakeRpcCall[];
}

/**
 * Порт RPC с заданными обработчиками по ключу `<extensionId>/<name>` (по
 * умолчанию пуст). Исключение обработчика уходит вызывающему как есть;
 * неизвестное имя — `ExtensionRpcError('unknown-rpc')`.
 */
export const createFakeExtensionRpc = (
  handlers: Readonly<
    Record<string, (input: unknown) => unknown | Promise<unknown>>
  > = {},
): FakeExtensionRpc => {
  const calls: FakeRpcCall[] = [];
  return {
    calls,
    invoke: async (extensionId, name, input) => {
      calls.push({ extensionId, name, input });
      const handler = handlers[`${extensionId}/${name}`];
      if (handler === undefined) {
        throw new ExtensionRpcError(
          'unknown-rpc',
          extensionId,
          name,
          `unknown rpc '${name}' of '${extensionId}'`,
        );
      }
      return handler(input);
    },
  };
};
