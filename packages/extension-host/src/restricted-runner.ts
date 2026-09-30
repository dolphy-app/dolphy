import { spawn as nodeSpawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExtensionLogger,
  LibraryReader,
} from '@spirula-app/extension-api';
import type { ResolvedExtension } from './discover.ts';
import type { ExtRequest, ExtResponse } from './protocol.ts';
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
  dispose(): Promise<void>;
}

/** DI-шов рантайма: как получить раннер для расширения. */
export interface RunnerFactory {
  create(extension: ResolvedExtension): RestrictedRunner;
}

export interface RestrictedRunnerOptions {
  extension: ResolvedExtension;
  /** Собранный файл дочернего процесса (`restricted-child`). */
  entryPath: string;
  library: LibraryReader;
  logger: ExtensionLogger;
  spawn?: SpawnRestricted;
  /** Запас сверх `timeoutMs` для `grade`. */
  graceMs?: number;
  /** Сколько ждать `ready` от нового процесса. */
  readyTimeoutMs?: number;
}

const DEFAULT_GRACE_MS = 1500;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const OTHER_DEADLINE_MS = 10_000;
const DISPOSE_KILL_MS = 1000;
const CRASH_WINDOW_MS = 60_000;
const MAX_EXITS = 5;

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

interface Live {
  child: RestrictedChild;
  pending: Map<string, (response: ExtResponse) => void>;
  ready: Promise<void>;
  exited: Promise<void>;
  isExited: boolean;
  disposing: boolean;
}

const failure = (
  id: string,
  cause: 'handler-failed' | 'activation-failed',
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
  const { extension, entryPath, library, logger } = options;
  const spawn = options.spawn ?? defaultSpawn;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const canReadLibrary = extension.permissions.includes('library.read');
  let live: Live | null = null;
  let starting: Promise<Live> | null = null;
  let disposed = false;
  let exits: number[] = [];
  let suppressedUntil = 0;

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

  const onMessage = (current: Live, markReady: () => void, raw: unknown) => {
    if (!isChildMessage(raw)) {
      logger.warn({ extensionId: extension.id }, 'invalid message from child');
      return;
    }
    if (raw.t === 'ready') markReady();
    else if (raw.t === 'rpc') {
      const { id } = raw.message;
      const settle = current.pending.get(id);
      if (settle === undefined) return;
      current.pending.delete(id);
      settle(raw.message);
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
      if (exits.length > MAX_EXITS) {
        suppressedUntil = now + CRASH_WINDOW_MS;
        exits = [];
        logger.error(
          { extensionId: extension.id },
          'extension process keeps crashing',
        );
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
      disposing: false,
      ready: new Promise<void>((resolve, reject) => {
        markReady = resolve;
        rejectReady = reject;
      }),
      exited: new Promise<void>((resolve) => {
        markExited = resolve;
      }),
    };
    current.ready.catch(() => {});
    child.onMessage((raw) => onMessage(current, markReady, raw));
    child.onOutput((stream, text) => {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        logger.warn({ extensionId: extension.id, stream }, line);
      }
    });
    child.onExit((code, signal) => {
      onExit(current, code, signal);
      rejectReady(
        new Error(`extension process exited (code ${code ?? signal})`),
      );
      markExited();
    });
    live = current;
    child.send({ t: 'init', extension: real });
    const timer = setTimeout(() => {
      rejectReady(new Error('extension process did not become ready'));
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

  const killCurrent = (): void => {
    if (live !== null) live.child.kill();
    else void starting?.then((started) => started.child.kill()).catch(() => {});
  };

  return {
    async handle(request) {
      if (disposed) {
        return failure(request.id, 'activation-failed', 'runner is disposed');
      }
      if (Date.now() < suppressedUntil) {
        return failure(
          request.id,
          'activation-failed',
          'extension process keeps crashing',
        );
      }
      const deadlineMs =
        request.method === 'grade'
          ? request.params.timeoutMs + graceMs
          : OTHER_DEADLINE_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<'deadline'>((resolve) => {
        timer = setTimeout(() => resolve('deadline'), deadlineMs);
      });
      try {
        const outcome = await Promise.race([call(request), deadline]);
        if (outcome !== 'deadline') return outcome;
        killCurrent();
        return failure(
          request.id,
          'handler-failed',
          'extension process was killed: deadline exceeded',
        );
      } catch (error) {
        return failure(request.id, 'activation-failed', messageOf(error));
      } finally {
        clearTimeout(timer);
      }
    },
    async dispose() {
      disposed = true;
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
