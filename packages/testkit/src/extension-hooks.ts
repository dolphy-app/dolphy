import { ExtensionHookError } from '@dolphy-app/engine/ports';
import type {
  ExtensionHookRequests,
  ExtensionHookResponses,
  ExtensionHooks,
} from '@dolphy-app/engine/ports';

type HookName = keyof ExtensionHookRequests;

/** Обработчики одного расширения по имени хука. */
export type FakeHookHandlers = {
  [N in HookName]?: (
    request: ExtensionHookRequests[N],
  ) => ExtensionHookResponses[N] | Promise<ExtensionHookResponses[N]>;
};

export interface FakeHookCall {
  extensionId: string;
  name: HookName;
  request: unknown;
}

export interface FakeExtensionHooks extends ExtensionHooks {
  /** Вызовы обработчиков по порядку. */
  calls: FakeHookCall[];
}

/**
 * Порт хуков с заданными обработчиками по id расширения (по умолчанию пуст):
 * обработчики вызываются по возрастанию id, каждому — запрос с ответом
 * предыдущего. Исключение обработчика — `ExtensionHookError('failed')`,
 * ответ, не прошедший `verify`, — `'invalid-result'`.
 */
export const createFakeExtensionHooks = (
  extensions: Readonly<Record<string, FakeHookHandlers>> = {},
): FakeExtensionHooks => {
  const calls: FakeHookCall[] = [];
  return {
    calls,
    before: async (name, request, verify) => {
      let current = request;
      let response: ExtensionHookResponses[typeof name] | undefined;
      for (const extensionId of Object.keys(extensions).sort()) {
        const handler = extensions[extensionId]?.[name];
        if (handler === undefined) continue;
        calls.push({ extensionId, name, request: current });
        try {
          response = await handler(current);
        } catch (error) {
          throw new ExtensionHookError(
            'failed',
            name,
            extensionId,
            error instanceof Error ? error.message : String(error),
          );
        }
        const problem = verify?.(response) ?? null;
        if (problem !== null) {
          throw new ExtensionHookError(
            'invalid-result',
            name,
            extensionId,
            problem,
          );
        }
        current = { ...current, ...response };
      }
      return response;
    },
  };
};
