import { PermissionError } from '@dolphy-app/extension-api';
import type {
  ExtensionLogger,
  ExtensionPermission,
  LibraryReader,
  LibraryStat,
} from '@dolphy-app/extension-api';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import type { ExportResult, ImportResult } from '@dolphy-app/extension-api';
import { childInboundSchema } from './protocol.ts';
import type { ExtResponse } from './protocol.ts';
import { createExtensionRuntime } from './runtime.ts';
import type { ExtensionRuntime } from './runtime.ts';
import { isParentMessage } from './restricted-protocol.ts';
import type {
  ChildMessage,
  LibraryCall,
  LibraryFailure,
  LogLevel,
  StreamedRequest,
} from './restricted-protocol.ts';
import {
  TransferWireError,
  chunksOf,
  createBodyReceiver,
  joinRequest,
  maxRequestBody,
  splitResult,
} from './transfer-wire.ts';
import type { BodyReceiver } from './transfer-wire.ts';

const EXIT_FLUSH_MS = 200;
/**
 * Пауза между частями потока ответа: родитель завершает процесс, который шлёт
 * больше `IPC_MAX_PER_SECOND` сообщений в секунду, а ответ в 20 МиБ — это
 * около 130 частей. 10 мс на часть — не больше 100 в секунду.
 */
export const CHUNK_PACE_MS = 10;
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
  // вызовы импорта и экспорта, ответ на которые уходит потоком
  const transfers = new Map<string, 'runImporter' | 'runExporter'>();
  // тела ответов уходят по одному: так частота частей остаётся под пределом родителя
  let outgoing: Promise<void> = Promise.resolve();

  const streamResult = (
    id: string,
    method: 'runImporter' | 'runExporter',
    result: ImportResult | ExportResult,
  ): void => {
    const { head, body } = splitResult(method, result);
    outgoing = outgoing.then(async () => {
      send({ t: 'result-stream', id, size: body.length, result: head });
      let seq = 0;
      for (const data of chunksOf(body)) {
        if (seq > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, CHUNK_PACE_MS);
          });
        }
        send({ t: 'chunk', id, seq, data });
        seq += 1;
      }
    });
  };

  const endpoint: MessageEndpoint = {
    post: (message) => {
      const response = message as ExtResponse;
      const method = transfers.get(response.id);
      transfers.delete(response.id);
      if (method !== undefined && response.ok) {
        streamResult(
          response.id,
          method,
          response.result as ImportResult | ExportResult,
        );
        return;
      }
      send({ t: 'rpc', message: message as never });
    },
    onMessage: (listener) => void listeners.push(listener),
    onClose: () => {},
    close: () => {},
  };
  let runtime: ExtensionRuntime | null = null;

  // вызовы, чьё тело ещё идёт потоком
  const incoming = new Map<
    string,
    { head: StreamedRequest; receiver: BodyReceiver }
  >();
  const refuse = (id: string, message: string): void =>
    endpoint.post({
      id,
      ok: false,
      error: { cause: 'handler-failed', message },
    });
  const deliver = (message: unknown): void => {
    const { id, method } = message as { id: string; method: string };
    if (method === 'runImporter' || method === 'runExporter') {
      transfers.set(id, method);
    }
    for (const listener of listeners) listener(message);
  };

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
      const parsed = childInboundSchema.safeParse(raw.message);
      if (!parsed.success) return;
      deliver(parsed.data);
    } else if (raw.t === 'stream') {
      const { request, size } = raw;
      if (
        !Number.isInteger(size) ||
        size < 0 ||
        size > maxRequestBody(request)
      ) {
        refuse(request.id, 'transfer body has an invalid size');
        return;
      }
      incoming.set(request.id, {
        head: request,
        receiver: createBodyReceiver(size),
      });
    } else if (raw.t === 'chunk') {
      const stream = incoming.get(raw.id);
      if (stream === undefined) return;
      if (!stream.receiver.accept(raw.seq, raw.data)) {
        incoming.delete(raw.id);
        refuse(raw.id, 'transfer body is corrupted');
        return;
      }
      if (!stream.receiver.complete) return;
      incoming.delete(raw.id);
      try {
        deliver(joinRequest(stream.head, stream.receiver.body()));
      } catch (error) {
        if (!(error instanceof TransferWireError)) throw error;
        refuse(raw.id, error.message);
      }
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
