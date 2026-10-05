/**
 * Запуск проверок в дочерних процессах: один запрос — один свежий процесс,
 * не более `MAX_CONCURRENT` одновременно (остальные ждут в очереди FIFO).
 * Дедлайн держит родитель: `SIGKILL` по `timeoutMs`, поэтому бесконечный
 * цикл и зависшие промисы ученика не требуют перезапуска хоста.
 */
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FromWorker, ToWorker } from './protocol.ts';
import type { RunRequest, RunResult } from './run-checks.ts';

export const MAX_CONCURRENT = 4;
/** Добавка к `timeoutMs` до `SIGKILL`: свой вердикт процесса информативнее. */
const KILL_GRACE_MS = 150;
const START_TIMEOUT_MS = 10_000;
const EXIT_WAIT_MS = 2_000;
const MAX_OLD_SPACE_MB = 256;

export type RunOutcome =
  | { kind: 'result'; result: RunResult }
  | { kind: 'timeout' }
  | { kind: 'crash'; reason: string };

export interface ChildRunner {
  run(request: RunRequest): Promise<RunOutcome>;
  /** Убивает живые процессы, очередь отвечает `crash`. */
  close(): Promise<void>;
}

// в собранном каталоге рядом лежит `worker.mjs`; при запуске из исходников
// (тесты) — `worker.ts`, который Node исполняет через type stripping
export const resolveWorkerPath = (): string => {
  const bundled = fileURLToPath(
    new URL(/* @vite-ignore */ './worker.mjs', import.meta.url),
  );
  return existsSync(bundled)
    ? bundled
    : fileURLToPath(new URL(/* @vite-ignore */ './worker.ts', import.meta.url));
};

/** `--permission` с Node 22.13, до этого — `--experimental-permission`. */
const permissionFlag = (nodeVersion: string): string => {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13)
    ? '--permission'
    : '--experimental-permission';
};

/** Режим разрешений сверяет настоящий путь, а не символическую ссылку (/var → /private/var). */
const toRealPath = (workerPath: string): string => realpathSync(workerPath);

/** Аргументы Node дочернего процесса: режим разрешений без грантов, кроме чтения своего каталога. */
export const workerExecArgv = (workerPath: string): string[] => {
  const realDir = path.dirname(workerPath);
  const execArgv = [
    permissionFlag(process.versions.node),
    `--allow-fs-read=${realDir}`,
    `--max-old-space-size=${MAX_OLD_SPACE_MB}`,
    '--disable-warning=ExperimentalWarning',
  ];
  // Node 22.12–22.17: type stripping включается флагом
  const { typescript } = process.features as { typescript?: unknown };
  if (typescript === false && workerPath.endsWith('.ts')) {
    execArgv.unshift('--experimental-strip-types');
  }
  return execArgv;
};

const isRunResult = (value: unknown): value is RunResult =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'status') === 'string' &&
  Array.isArray(Reflect.get(value, 'failures'));

const isExited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

export const createChildRunner = (
  workerFile: string = resolveWorkerPath(),
): ChildRunner => {
  const workerPath = toRealPath(workerFile);
  const execArgv = workerExecArgv(workerPath);
  const live = new Set<ChildProcess>();
  const waiters: ((granted: boolean) => void)[] = [];
  const state = { running: 0, closed: false };

  const acquire = (): Promise<boolean> => {
    if (state.closed) return Promise.resolve(false);
    if (state.running < MAX_CONCURRENT) {
      state.running += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  };

  const release = () => {
    const next = waiters.shift();
    // слот переходит следующему в очереди без промежуточного освобождения
    if (next === undefined) state.running -= 1;
    else next(true);
  };

  const terminate = async (child: ChildProcess) => {
    if (isExited(child)) return;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill('SIGKILL');
    let timer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, EXIT_WAIT_MS);
    });
    await Promise.race([exited, gaveUp]);
    clearTimeout(timer);
  };

  const spawnChild = (): ChildProcess =>
    fork(workerPath, [], {
      execArgv,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    });

  const converse = (
    child: ChildProcess,
    request: RunRequest,
  ): Promise<RunOutcome> =>
    new Promise((resolve) => {
      const timers: { start?: NodeJS.Timeout; deadline?: NodeJS.Timeout } = {};
      const settle = (outcome: RunOutcome) => {
        clearTimeout(timers.start);
        clearTimeout(timers.deadline);
        resolve(outcome);
      };
      const crash = (reason: string) => settle({ kind: 'crash', reason });
      timers.start = setTimeout(
        () => crash('worker_start_timeout'),
        START_TIMEOUT_MS,
      );
      child.on('error', () => crash('worker_crash'));
      // Не `exit`: он может прийти раньше, чем родитель дочитает IPC-канал, и
      // ответ уже вышедшего воркера потерялся бы как `worker_crash`.
      // `disconnect` приходит после доставки всех сообщений канала.
      child.on('disconnect', () => crash('worker_crash'));
      child.on('message', (raw: FromWorker) => {
        if (raw.type === 'ready') {
          clearTimeout(timers.start);
          timers.deadline = setTimeout(
            () => settle({ kind: 'timeout' }),
            request.timeoutMs + KILL_GRACE_MS,
          );
          const message: ToWorker = { type: 'run', request };
          child.send(message, (error) => {
            if (error !== null) crash('worker_crash');
          });
        } else if (raw.type === 'result') {
          if (isRunResult(raw.result)) {
            settle({ kind: 'result', result: raw.result });
          } else crash('worker_bad_result');
        }
      });
    });

  const execute = async (request: RunRequest): Promise<RunOutcome> => {
    let child: ChildProcess;
    try {
      child = spawnChild();
    } catch {
      return { kind: 'crash', reason: 'spawn_failed' };
    }
    live.add(child);
    try {
      return await converse(child, request);
    } finally {
      live.delete(child);
      await terminate(child);
    }
  };

  const run = async (request: RunRequest): Promise<RunOutcome> => {
    if (!(await acquire())) return { kind: 'crash', reason: 'stopped' };
    try {
      const outcome = await execute(request);
      return state.closed && outcome.kind !== 'result'
        ? { kind: 'crash', reason: 'stopped' }
        : outcome;
    } finally {
      release();
    }
  };

  const close = async () => {
    state.closed = true;
    for (const grant of waiters.splice(0)) grant(false);
    await Promise.all([...live].map(terminate));
  };

  return { run, close };
};
