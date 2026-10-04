import { spawn as nodeSpawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionLogger, LibraryReader } from '@dolphy-app/extension-api';
import type { ResolvedExtension } from './discover.ts';
import { EngineRequestError, hostFailureOf } from './engine-link.ts';
import type { EngineLink } from './engine-link.ts';
import { hostRequestSchema } from './protocol.ts';
import type {
  ExtRequest,
  ExtResponse,
  HostRequest,
  HostResponse,
  SettingChangedNotice,
} from './protocol.ts';
import { RESTRICTED_ENV, restrictedArgs } from './permissions.ts';
import { isChildMessage } from './restricted-protocol.ts';
import type {
  ChildMessage,
  LibraryFailure,
  ParentMessage,
} from './restricted-protocol.ts';

/** Дочерний процесс с точки зрения раннера: шов для подмены в тестах. */
export interface RestrictedChild {
  send(message: ParentMessage): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  onOutput(listener: (stream: 'stdout' | 'stderr', text: string) => void): void;
  kill(): void;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type SpawnRestricted = (spec: SpawnSpec) => RestrictedChild;

export const defaultSpawn: SpawnRestricted = ({ command, args, env }) => {
  const child = nodeSpawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const exitListeners: ((
    code: number | null,
    signal: string | null,
  ) => void)[] = [];
  child.on('exit', (code, signal) => {
    for (const listener of exitListeners) listener(code, signal);
  });
  // spawn не удался (нет бинарника): `exit` не придёт
  child.on('error', () => {
    if (child.pid !== undefined) return;
    for (const listener of exitListeners) listener(null, 'spawn-failed');
  });
  return {
    send: (message) => {
      if (child.connected) child.send(message);
    },
    onMessage: (listener) => void child.on('message', listener),
    onExit: (listener) => void exitListeners.push(listener),
    onOutput: (listener) => {
      child.stdout?.on('data', (chunk: Buffer) =>
        listener('stdout', chunk.toString()),
      );
      child.stderr?.on('data', (chunk: Buffer) =>
        listener('stderr', chunk.toString()),
      );
    },
    kill: () => void child.kill('SIGKILL'),
  };
};

export interface RestrictedRunner {
  handle(request: ExtRequest): Promise<ExtResponse>;
  /** Сообщение без ответа работающему процессу; процесс не запущен — теряется (при запуске он читает состояние сам). */
  notify(notice: SettingChangedNotice): void;
  dispose(): Promise<void>;
}

/** DI-шов рантайма: как получить раннер для расширения; `engine` — запросы процесса к данным расширения. */
export interface RunnerFactory {
  create(extension: ResolvedExtension, engine: EngineLink): RestrictedRunner;
}

export interface RestrictedRunnerOptions {
  extension: ResolvedExtension;
  /** Собранный файл дочернего процесса (`restricted-child`). */
  entryPath: string;
  library: LibraryReader;
  /** Хранилище и настройки расширения: процесс просит их у родителя, как `ctx.library`. */
  engine: EngineLink;
  logger: ExtensionLogger;
  spawn?: SpawnRestricted;
  /** Запас сверх `timeoutMs` для `grade`. */
  graceMs?: number;
  /** Сколько ждать `ready` от нового процесса (срок `activate()`); по умолчанию 10 с. */
  readyTimeoutMs?: number;
  /**
   * Срок вызова команды, включая запуск процесса. Больше срока обработчика
   * (10 с) и меньше срока клиента движка (14 с).
   */
  commandDeadlineMs?: number;
}

const DEFAULT_GRACE_MS = 1500;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const OTHER_DEADLINE_MS = 10_000;
const COMMAND_DEADLINE_MS = 12_000;
const DISPOSE_KILL_MS = 1000;
const CRASH_WINDOW_MS = 60_000;
const MAX_EXITS = 5;
/** Вывод процесса в журнал: не больше `OUTPUT_LIMIT_BYTES` за окно `OUTPUT_WINDOW_MS` на расширение. */
export const OUTPUT_LIMIT_BYTES = 64 * 1024;
export const OUTPUT_WINDOW_MS = 60_000;
/** Сообщение процесса больше этого размера (в знаках после сериализации) или поток быстрее `IPC_MAX_PER_SECOND` завершает процесс. */
export const IPC_MAX_MESSAGE_CHARS = 1024 * 1024;
export const IPC_MAX_PER_SECOND = 200;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Процесс не сообщил о готовности за `readyTimeoutMs`: `activate()` не завершился. */
class ActivationTimeoutError extends Error {}

/** Процесс убит за превышение предела IPC до готовности: вызову достаётся причина предела. */
class IpcLimitError extends Error {
  readonly reason: 'ipc-size' | 'ipc-rate';

  constructor(reason: 'ipc-size' | 'ipc-rate', message: string) {
    super(message);
    this.reason = reason;
  }
}

interface Live {
  child: RestrictedChild;
  pending: Map<string, (response: ExtResponse) => void>;
  ready: Promise<void>;
  isReady: boolean;
  exited: Promise<void>;
  isExited: boolean;
  disposing: boolean;
  /** Процесс нарушил предел IPC и убит: его сообщения больше не читаются. */
  limit: IpcLimitError | null;
  /** Начало текущей секунды и число сообщений в ней. */
  rateStart: number;
  rateCount: number;
}

const failure = (
  id: string,
  cause:
    | 'handler-failed'
    | 'handler-timeout'
    | 'activation-failed'
    | 'activation-timeout'
    | 'ipc-size'
    | 'ipc-rate',
  message: string,
): ExtResponse => ({ id, ok: false, error: { cause, message } });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failureOf = (error: unknown): LibraryFailure => ({
  name: error instanceof Error ? error.name : 'Error',
  message: messageOf(error),
});

/**
 * Исполняет код одного расширения в ограниченном процессе Node (режим
 * разрешений). Процесс поднимается лениво, падение и зависание одного вызова
 * не задевают хост: вызов получает `handler-failed`, следующий — новый процесс.
 */
export const createRestrictedRunner = (
  options: RestrictedRunnerOptions,
): RestrictedRunner => {
  const { extension, entryPath, library, engine, logger } = options;
  const spawn = options.spawn ?? defaultSpawn;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const commandDeadlineMs = options.commandDeadlineMs ?? COMMAND_DEADLINE_MS;
  const canReadLibrary = extension.permissions.includes('library.read');
  let live: Live | null = null;
  let starting: Promise<Live> | null = null;
  let disposed = false;
  let exits: number[] = [];
  let suppressedUntil = 0;
  // сбой по сроку запоминается до замены сборки (раннер заменяется вместе с ней)
  let activationTimeout: string | null = null;
  // окно вывода процесса общее для всех его запусков: предел — на расширение
  let outputStart: number | null = null;
  let outputBytes = 0;
  let outputDropped = 0;
  let outputTimer: ReturnType<typeof setTimeout> | null = null;

  /** Окно вывода закрыто: отброшенное сообщается одной строкой. */
  const closeOutputWindow = (): void => {
    if (outputTimer !== null) clearTimeout(outputTimer);
    outputTimer = null;
    if (outputDropped > 0) {
      logger.warn(
        { extensionId: extension.id, droppedBytes: outputDropped },
        'output truncated',
      );
    }
    outputBytes = 0;
    outputDropped = 0;
    outputStart = null;
  };

  /** Строки вывода процесса попадают в журнал, пока не исчерпан предел окна. */
  const logOutput = (stream: 'stdout' | 'stderr', text: string): void => {
    const now = Date.now();
    if (outputStart !== null && now - outputStart >= OUTPUT_WINDOW_MS) {
      closeOutputWindow();
    }
    outputStart ??= now;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const size = Buffer.byteLength(line) + 1;
      if (outputBytes + size <= OUTPUT_LIMIT_BYTES) {
        outputBytes += size;
        logger.warn({ extensionId: extension.id, stream }, line);
        continue;
      }
      outputDropped += size;
      // итог сообщается и тогда, когда процесс замолчал
      outputTimer ??= setTimeout(
        closeOutputWindow,
        Math.max(0, outputStart + OUTPUT_WINDOW_MS - now),
      );
      outputTimer.unref();
    }
  };

  /** Приостановка видна в здоровье расширения; без ответа движка (он не нужен) ничего не теряется. */
  const reportSuppression = (until: number): void => {
    engine
      .request('health.report', {
        extensionId: extension.id,
        kind: 'suppressed',
        until,
      })
      .catch(() => {});
  };

  /** Сбой вне вызова (предел IPC): причина видна в здоровье расширения. */
  const reportFailure = (reason: string, message: string): void => {
    engine
      .request('health.report', {
        extensionId: extension.id,
        kind: 'failed',
        reason,
        message,
      })
      .catch(() => {});
  };

  /**
   * Процесс превысил предел IPC: он убивается, вызовы в полёте получают
   * причину предела, следующий вызов поднимает новый процесс (и идёт в счёт
   * цикла падений через `onExit`).
   */
  const enforceLimit = (
    current: Live,
    reason: 'ipc-size' | 'ipc-rate',
    message: string,
  ): void => {
    current.limit = new IpcLimitError(reason, message);
    if (live === current) live = null;
    logger.error({ extensionId: extension.id, reason }, message);
    reportFailure(reason, message);
    for (const [id, settle] of current.pending) {
      settle(failure(id, reason, message));
    }
    current.pending.clear();
    current.child.kill();
  };

  /** Предел на каждое сообщение процесса; `false` — процесс убит, сообщение отброшено. */
  const withinLimits = (current: Live, raw: unknown): boolean => {
    if (current.limit !== null) return false;
    const now = Date.now();
    if (now - current.rateStart >= 1000) {
      current.rateStart = now;
      current.rateCount = 0;
    }
    current.rateCount += 1;
    if (current.rateCount > IPC_MAX_PER_SECOND) {
      enforceLimit(
        current,
        'ipc-rate',
        `extension process killed: more than ${IPC_MAX_PER_SECOND} messages per second`,
      );
      return false;
    }
    const size = JSON.stringify(raw)?.length ?? 0;
    if (size > IPC_MAX_MESSAGE_CHARS) {
      enforceLimit(
        current,
        'ipc-size',
        `extension process killed: message of ${size} characters exceeds ${IPC_MAX_MESSAGE_CHARS}`,
      );
      return false;
    }
    return true;
  };

  const serveLibrary = async (
    current: Live,
    message: Extract<ChildMessage, { t: 'library' }>,
  ): Promise<void> => {
    const reply = (result: ParentMessage): void => {
      if (!current.isExited) current.child.send(result);
    };
    // права проверяет родитель; проверка в дочернем процессе — только ради понятной ошибки
    if (!canReadLibrary) {
      reply({
        t: 'library-result',
        id: message.id,
        ok: false,
        error: {
          name: 'PermissionError',
          message: "permission 'library.read' is not declared",
          permission: 'library.read',
        },
      });
      return;
    }
    try {
      const value =
        message.op === 'readText'
          ? await library.readText(message.path)
          : await library.stat(message.path);
      reply({ t: 'library-result', id: message.id, ok: true, value });
    } catch (error) {
      reply({
        t: 'library-result',
        id: message.id,
        ok: false,
        error: failureOf(error),
      });
    }
  };

  /**
   * Запрос процесса к данным расширения. Процесс не доверен: форма
   * проверяется, а `extensionId` подменяется своим — чужие данные недоступны.
   */
  const serveEngine = async (
    current: Live,
    message: { id: string },
  ): Promise<void> => {
    const reply = (response: HostResponse): void => {
      if (!current.isExited)
        current.child.send({ t: 'rpc', message: response });
    };
    const parsed = hostRequestSchema.safeParse(message);
    if (!parsed.success) {
      reply({
        id: message.id,
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: 'invalid extension host request',
        },
      });
      return;
    }
    const request = parsed.data as HostRequest;
    try {
      const result = await engine.request(request.method, {
        ...request.params,
        extensionId: extension.id,
      } as never);
      reply({ id: request.id, ok: true, result });
    } catch (error) {
      reply({
        id: request.id,
        ok: false,
        error:
          error instanceof EngineRequestError
            ? {
                code: error.code,
                message: error.message,
                ...(error.details !== undefined && { details: error.details }),
              }
            : hostFailureOf(error),
      });
    }
  };

  const onMessage = (current: Live, markReady: () => void, raw: unknown) => {
    if (!withinLimits(current, raw)) return;
    if (!isChildMessage(raw)) {
      logger.warn({ extensionId: extension.id }, 'invalid message from child');
      return;
    }
    if (raw.t === 'ready') markReady();
    else if (raw.t === 'rpc') {
      const { id } = raw.message;
      if ('method' in raw.message) {
        void serveEngine(current, raw.message as { id: string });
        return;
      }
      const settle = current.pending.get(id);
      if (settle === undefined) return;
      current.pending.delete(id);
      settle(raw.message as ExtResponse);
    } else if (raw.t === 'library') void serveLibrary(current, raw);
    else {
      const level = LOG_LEVELS.includes(raw.level) ? raw.level : 'info';
      logger[level]({ ...raw.fields, extensionId: extension.id }, raw.message);
    }
  };

  const onExit = (
    current: Live,
    code: number | null,
    signal: string | null,
  ): void => {
    current.isExited = true;
    if (live === current) live = null;
    if (!current.disposing) {
      const now = Date.now();
      exits = [...exits.filter((at) => at > now - CRASH_WINDOW_MS), now];
      if (exits.length >= MAX_EXITS) {
        suppressedUntil = now + CRASH_WINDOW_MS;
        exits = [];
        logger.error(
          { extensionId: extension.id },
          'extension process keeps crashing',
        );
        reportSuppression(suppressedUntil);
      }
    }
    const reason = `extension process exited (code ${code ?? signal})`;
    for (const [id, settle] of current.pending) {
      settle(failure(id, 'handler-failed', reason));
    }
    current.pending.clear();
  };

  const launch = async (): Promise<Live> => {
    const [extensionDir, entryDir] = await Promise.all([
      realpath(extension.dir),
      realpath(path.dirname(entryPath)),
    ]);
    // import() идёт по настоящему пути: режим разрешений сверяет его, а не символическую ссылку (/var → /private/var)
    const real: ResolvedExtension = {
      ...extension,
      dir: extensionDir,
      mainPath:
        extension.mainPath === null
          ? null
          : path.join(
              extensionDir,
              path.relative(extension.dir, extension.mainPath),
            ),
    };
    const args = restrictedArgs({
      readDirs: [...new Set([extensionDir, entryDir])],
      entry: path.join(entryDir, path.basename(entryPath)),
      permissions: extension.permissions,
      nodeVersion: process.versions.node,
    });
    const child = spawn({
      command: process.execPath,
      args,
      env: { ...RESTRICTED_ENV },
    });
    let markReady: () => void = () => {};
    let markExited: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const current: Live = {
      child,
      pending: new Map(),
      isExited: false,
      isReady: false,
      disposing: false,
      limit: null,
      rateStart: 0,
      rateCount: 0,
      ready: new Promise<void>((resolve, reject) => {
        markReady = resolve;
        rejectReady = reject;
      }),
      exited: new Promise<void>((resolve) => {
        markExited = resolve;
      }),
    };
    current.ready.catch(() => {});
    child.onMessage((raw) =>
      onMessage(
        current,
        () => {
          current.isReady = true;
          markReady();
        },
        raw,
      ),
    );
    child.onOutput(logOutput);
    child.onExit((code, signal) => {
      onExit(current, code, signal);
      rejectReady(
        current.limit ??
          new Error(`extension process exited (code ${code ?? signal})`),
      );
      markExited();
    });
    live = current;
    child.send({ t: 'init', extension: real });
    const timer = setTimeout(() => {
      rejectReady(
        new ActivationTimeoutError(
          `activate() did not finish in ${readyTimeoutMs} ms`,
        ),
      );
      child.kill();
    }, readyTimeoutMs);
    try {
      await current.ready;
    } finally {
      clearTimeout(timer);
    }
    return current;
  };

  const ensureLive = async (): Promise<Live> => {
    if (live !== null && !live.isExited) {
      await live.ready;
      return live;
    }
    starting ??= launch().finally(() => {
      starting = null;
    });
    return starting;
  };

  const call = async (request: ExtRequest): Promise<ExtResponse> => {
    const current = await ensureLive();
    return new Promise<ExtResponse>((resolve) => {
      if (current.isExited) {
        resolve(
          failure(request.id, 'handler-failed', 'extension process exited'),
        );
        return;
      }
      current.pending.set(request.id, resolve);
      current.child.send({ t: 'rpc', message: request });
    });
  };

  const timedOutActivation = (
    id: string,
    message = `activate() did not finish in ${readyTimeoutMs} ms`,
  ): ExtResponse => {
    activationTimeout = message;
    logger.warn(
      { extensionId: extension.id },
      'extension activation timed out; the process was killed',
    );
    return failure(id, 'activation-timeout', message);
  };

  const killCurrent = (): void => {
    if (live === null) {
      void starting?.then((started) => started.child.kill()).catch(() => {});
      return;
    }
    // убитый процесс умирает не мгновенно: новые вызовы ему не достаются, следующий поднимет свежий
    const doomed = live;
    live = null;
    doomed.child.kill();
  };

  return {
    async handle(request) {
      if (disposed) {
        return failure(request.id, 'activation-failed', 'runner is disposed');
      }
      if (activationTimeout !== null) {
        return failure(request.id, 'activation-timeout', activationTimeout);
      }
      if (Date.now() < suppressedUntil) {
        return failure(
          request.id,
          'activation-failed',
          'extension process keeps crashing',
        );
      }
      let deadlineMs = OTHER_DEADLINE_MS;
      if (request.method === 'grade') {
        deadlineMs = request.params.timeoutMs + graceMs;
      } else if (request.method === 'invokeCommand') {
        deadlineMs = commandDeadlineMs;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<'deadline'>((resolve) => {
        timer = setTimeout(() => resolve('deadline'), deadlineMs);
      });
      try {
        const outcome = await Promise.race([call(request), deadline]);
        if (outcome !== 'deadline') return outcome;
        // срок вызова вышел, пока процесс ещё активировался: причина — активация, а не вызов
        const activating = live === null ? starting !== null : !live.isReady;
        killCurrent();
        if (activating) return timedOutActivation(request.id);
        return failure(
          request.id,
          request.method === 'invokeCommand'
            ? 'handler-timeout'
            : 'handler-failed',
          'extension process was killed: deadline exceeded',
        );
      } catch (error) {
        if (error instanceof ActivationTimeoutError) {
          return timedOutActivation(request.id, error.message);
        }
        if (error instanceof IpcLimitError) {
          return failure(request.id, error.reason, error.message);
        }
        return failure(request.id, 'activation-failed', messageOf(error));
      } finally {
        clearTimeout(timer);
      }
    },
    notify(notice) {
      if (live !== null && !live.isExited) {
        live.child.send({ t: 'rpc', message: notice });
      }
    },
    async dispose() {
      disposed = true;
      closeOutputWindow();
      const current = live;
      if (current === null || current.isExited) return;
      current.disposing = true;
      current.child.send({ t: 'shutdown' });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const forced = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          current.child.kill();
          resolve();
        }, DISPOSE_KILL_MS);
      });
      await Promise.race([current.exited, forced]);
      clearTimeout(timer);
    },
  };
};
