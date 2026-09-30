import { PermissionError } from '@lms/extension-api';
import type {
  ExtensionLogger,
  ExtensionPermission,
  LibraryReader,
  LibraryStat,
} from '@lms/extension-api';
import type { MessageEndpoint } from '@lms/engine-contract';
import { extRequestSchema } from './protocol.ts';
import type { ExtRequest } from './protocol.ts';
import { createExtensionRuntime } from './runtime.ts';
import type { ExtensionRuntime } from './runtime.ts';
import { isParentMessage } from './restricted-protocol.ts';
import type {
  ChildMessage,
  LibraryCall,
  LibraryFailure,
  LogLevel,
} from './restricted-protocol.ts';

const EXIT_FLUSH_MS = 200;
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

// Error и циклические структуры не проходят через IPC как есть
const plain = (fields: object): object => {
  try {
    return JSON.parse(
      JSON.stringify(fields, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      ),
    ) as object;
  } catch {
    return { unserializable: true };
  }
};

interface Waiter {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

const errorOf = (failure: LibraryFailure): Error => {
  if (failure.permission !== undefined) {
    return new PermissionError(failure.permission, failure.message);
  }
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
};

/**
 * Сторона ограниченного процесса: runtime одного расширения поверх IPC родителя.
 * Запускается с флагами режима разрешений; файлы библиотеки читает не сам, а
 * через родителя (прокси `ctx.library`).
 */
export const startRestrictedChild = (proc: NodeJS.Process = process): void => {
  const send = (message: ChildMessage, done?: () => void): void => {
    if (proc.send === undefined) return;
    proc.send(message, undefined, undefined, done);
  };
  const logger = Object.fromEntries(
    LEVELS.map((level) => [
      level,
      (fields: object, message?: string) =>
        send({
          t: 'log',
          level,
          fields: plain(fields),
          ...(message === undefined ? {} : { message }),
        }),
    ]),
  ) as unknown as ExtensionLogger;

  const fatal = (error: unknown, what: string): void => {
    send(
      { t: 'log', level: 'error', fields: plain({ error }), message: what },
      () => proc.exit(1),
    );
    setTimeout(() => proc.exit(1), EXIT_FLUSH_MS).unref();
  };
  proc.on('uncaughtException', (error) => fatal(error, 'uncaught'));
  proc.on('unhandledRejection', (reason) =>
    fatal(reason, 'unhandled rejection'),
  );
  // родитель пропал — процесс никому не нужен
  proc.on('disconnect', () => proc.exit(0));

  const waiters = new Map<string, Waiter>();
  let nextId = 0;
  const callLibrary = (call: LibraryCall): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = String(nextId++);
      waiters.set(id, { resolve, reject });
      send({ t: 'library', id, ...call });
    });

  // проверка здесь — только ради понятной ошибки; настоящее решение принимает родитель
  const createLibrary = (
    permissions: readonly ExtensionPermission[],
  ): LibraryReader => {
    const guard = (): void => {
      if (!permissions.includes('library.read')) {
        throw new PermissionError('library.read');
      }
    };
    return {
      readText: async (path) => {
        guard();
        return (await callLibrary({ op: 'readText', path })) as string;
      },
      stat: async (path) => {
        guard();
        return (await callLibrary({ op: 'stat', path })) as LibraryStat | null;
      },
    };
  };

  const listeners: ((message: unknown) => void)[] = [];
  const endpoint: MessageEndpoint = {
    post: (message) => send({ t: 'rpc', message: message as never }),
    onMessage: (listener) => void listeners.push(listener),
    onClose: () => {},
    close: () => {},
  };
  let runtime: ExtensionRuntime | null = null;

  proc.on('message', (raw: unknown) => {
    if (!isParentMessage(raw)) return;
    if (raw.t === 'init') {
      if (runtime !== null) return;
      runtime = createExtensionRuntime({
        extensions: [raw.extension],
        library: createLibrary(raw.extension.permissions),
        logger,
        enforceIsolation: false,
      });
      runtime.attach(endpoint);
      send({ t: 'ready' });
    } else if (raw.t === 'rpc') {
      const parsed = extRequestSchema.safeParse(raw.message);
      if (!parsed.success) return;
      for (const listener of listeners) listener(parsed.data as ExtRequest);
    } else if (raw.t === 'library-result') {
      const waiter = waiters.get(raw.id);
      if (waiter === undefined) return;
      waiters.delete(raw.id);
      if (raw.ok) waiter.resolve(raw.value);
      else waiter.reject(errorOf(raw.error));
    } else {
      const closing = runtime?.dispose() ?? Promise.resolve();
      void closing.finally(() => proc.exit(0));
    }
  });
};
