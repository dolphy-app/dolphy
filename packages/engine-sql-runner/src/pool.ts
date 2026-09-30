/**
 * Пул дочерних процессов раннера. Процесс, а не `worker_threads`:
 * `worker.terminate()` не прерывает `sqlite3_step`, а у обоих драйверов нет
 * `interrupt` (report-sql-runner.md §4.1). Жёсткий таймаут и лимит памяти —
 * `SIGKILL` процесса (1–8 мс), замена порождается в фоне.
 *
 * Один процесс — один запрос за раз. Порождение — внедряемая `spawnWorker`
 * (по умолчанию `child_process.fork`).
 */
import { fork } from 'node:child_process';
import type { ChildProcess, ForkOptions } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@spirula-app/engine/ports';
import { readRssKbWithPs } from './rss.ts';
import type { ReadRssKb } from './rss.ts';
import { DEFAULT_LIMITS } from './types.ts';
import type {
  CheckRequest,
  DriverPreference,
  FromWorker,
  ReadyInfo,
  ToWorker,
  Verdict,
  VerdictCode,
} from './types.ts';

/** `child_process.fork` или совместимая обёртка (например, над `utilityProcess`). */
export type SpawnWorker = (
  modulePath: string,
  args: string[],
  options: ForkOptions,
) => ChildProcess;

export interface PoolOptions {
  logger: Logger;
  /** Число процессов; по умолчанию `min(4, cores − 1)`, не меньше 1. */
  size?: number;
  /** Заменить процесс после стольких проверок (0 — никогда). */
  recycleAfter?: number;
  /** Добавка к `timeoutMs` до kill. */
  killGraceMs?: number;
  /** Порог RSS процесса, КиБ; обязателен (> 0) во всех профилях. */
  maxRssKb?: number;
  rssPollMs?: number;
  spawnWorker?: SpawnWorker;
  /** Путь к `worker.ts` или к собранному `worker.js`. */
  workerPath?: string;
  readRssKb?: ReadRssKb;
  driver?: DriverPreference;
  /** Ждать `ready` не дольше. */
  startTimeoutMs?: number;
}

export interface PoolOutcome {
  verdict: Verdict;
  /** RSS процесса в конце проверки, КиБ; `null` — процесс убит или не ответил. */
  rssKb: number | null;
  killed: boolean;
}

export interface PoolStats {
  checks: number;
  spawned: number;
  kills: number;
  crashes: number;
  recycled: number;
  live: number;
  idle: number;
}

export interface RunnerPool {
  /** Поднять все процессы заранее (40–50 мс на старт). */
  warm(): Promise<void>;
  run(request: CheckRequest): Promise<PoolOutcome>;
  /** Драйвер и профиль раннера (порождает процесс, если нужно). */
  info(): Promise<ReadyInfo>;
  stats(): PoolStats;
  close(): Promise<void>;
  /** PID живых процессов (тесты, диагностика). */
  pids(): number[];
}

export const DEFAULT_RECYCLE_AFTER = 500;
export const DEFAULT_KILL_GRACE_MS = 100;
export const DEFAULT_MAX_RSS_KB = 400 * 1024;
export const DEFAULT_RSS_POLL_MS = 20;
const DEFAULT_START_TIMEOUT_MS = 10_000;
const STDERR_TAIL_CHARS = 2048;
const MAX_POOL_SIZE = 4;
const KIB = 1024;

export const defaultPoolSize = (cores: number): number =>
  Math.max(1, Math.min(MAX_POOL_SIZE, cores - 1));

interface Job {
  id: number;
  /** Завершить проверку исходом раннера или хоста. */
  settle(outcome: PoolOutcome): void;
}

interface Runner {
  readonly child: ChildProcess;
  readonly pid: number | undefined;
  readonly info: ReadyInfo;
  uses: number;
  dead: boolean;
  current: Job | null;
  stderrTail: string;
}

const hostVerdict = (
  code: VerdictCode,
  reason: string,
  startedAt: number,
): Verdict => ({
  status: 'error',
  code,
  reason,
  durationMs: performance.now() - startedAt,
  rowCount: 0,
});

const exited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export const createPool = (options: PoolOptions): RunnerPool => {
  const { logger } = options;
  const size = options.size ?? defaultPoolSize(availableParallelism());
  const recycleAfter = options.recycleAfter ?? DEFAULT_RECYCLE_AFTER;
  const graceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxRssKb = options.maxRssKb ?? DEFAULT_MAX_RSS_KB;
  const pollMs = options.rssPollMs ?? DEFAULT_RSS_POLL_MS;
  const spawnWorker: SpawnWorker = options.spawnWorker ?? fork;
  const workerPath =
    options.workerPath ??
    fileURLToPath(new URL(/* @vite-ignore */ './worker.ts', import.meta.url));
  const readRssKb = options.readRssKb ?? readRssKbWithPs;
  const startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  if (!(size >= 1)) throw new RangeError('pool size must be at least 1');
  if (!(maxRssKb > 0)) {
    // без db.limits (Node 22, better-sqlite3) запрос съедает 1–4 ГБ за доли секунды
    throw new RangeError('RSS watcher is mandatory: maxRssKb must be > 0');
  }
  if (options.readRssKb === undefined && process.platform === 'win32') {
    logger.warn({ platform: process.platform }, 'RSS watcher has no ps here');
  }

  const args = [`--driver=${options.driver ?? 'auto'}`];
  const execArgv = ['--disable-warning=ExperimentalWarning'];
  // Node 22.12–22.17: type stripping включается флагом
  const { typescript } = process.features as { typescript?: unknown };
  if (typescript === false) execArgv.unshift('--experimental-strip-types');
  const forkOptions: ForkOptions = {
    execArgv,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'json',
  };

  const all = new Set<Runner>();
  const idle: Runner[] = [];
  const waiters = new Set<(result: Runner | Error) => void>();
  const spawning = new Set<Promise<unknown>>();
  const killing = new Set<Promise<unknown>>();
  const stats: PoolStats = {
    checks: 0,
    spawned: 0,
    kills: 0,
    crashes: 0,
    recycled: 0,
    live: 0,
    idle: 0,
  };
  let live = 0;
  let closed = false;
  let keepWarm = false;
  let nextId = 1;

  const track = (set: Set<Promise<unknown>>, promise: Promise<unknown>) => {
    set.add(promise);
    void promise.finally(() => set.delete(promise));
  };

  const kill = (runner: Runner): Promise<void> => {
    if (exited(runner.child)) return Promise.resolve();
    const promise = new Promise<void>((resolve) => {
      runner.child.once('exit', () => resolve());
      runner.child.kill('SIGKILL');
    });
    track(killing, promise);
    return promise;
  };

  /** Отдать процесс ожидающему или положить в простой. */
  const handoff = (runner: Runner) => {
    const [waiter] = waiters;
    if (waiter === undefined) {
      idle.push(runner);
      return;
    }
    waiters.delete(waiter);
    waiter(runner);
  };

  const markDead = (runner: Runner, reason: string) => {
    if (runner.dead) return;
    runner.dead = true;
    all.delete(runner);
    if (runner.current !== null) {
      runner.current.settle({
        verdict: hostVerdict('worker_crash', reason, performance.now()),
        rssKb: null,
        killed: false,
      });
      return; // release() в `run` уберёт процесс и вернёт замену
    }
    const index = idle.indexOf(runner);
    if (index < 0) return;
    idle.splice(index, 1);
    live--;
    logger.warn({ pid: runner.pid, reason }, 'idle sql runner died');
    // замену поднимет следующий acquire: пул не гоняет процессы вхолостую
  };

  const spawn = (): Promise<Runner> =>
    new Promise((resolve, reject) => {
      const child = spawnWorker(workerPath, args, forkOptions);
      let runner: Runner | null = null;
      let stderrTail = '';
      const startup: { timer?: NodeJS.Timeout } = {};
      const fail = (reason: string) => {
        clearTimeout(startup.timer);
        if (runner === null) {
          if (!exited(child)) child.kill('SIGKILL');
          const tail = stderrTail.trim();
          reject(new Error(tail === '' ? reason : `${reason}: ${tail}`));
        } else markDead(runner, reason);
      };
      startup.timer = setTimeout(
        () => fail(`runner did not become ready in ${startTimeoutMs} ms`),
        startTimeoutMs,
      );
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
        if (runner !== null) runner.stderrTail = stderrTail;
      });
      child.on('error', (error) => fail(`runner error: ${error.message}`));
      child.on('exit', (code, signal) =>
        fail(`runner exited (${signal ?? code})`),
      );
      child.on('message', (raw) => {
        const message = raw as FromWorker;
        if (message.type === 'ready' && runner === null) {
          clearTimeout(startup.timer);
          runner = {
            child,
            pid: child.pid,
            info: { driver: message.driver, profile: message.profile },
            uses: 0,
            dead: false,
            current: null,
            stderrTail,
          };
          all.add(runner);
          stats.spawned++;
          resolve(runner);
        } else if (
          message.type === 'verdict' &&
          runner?.current?.id === message.id
        ) {
          runner.current.settle({
            verdict: message.verdict,
            rssKb: message.rssKb,
            killed: false,
          });
        }
      });
    });

  const spawnInBackground = () => {
    live++;
    const pending = spawn().then(
      (runner) => {
        if (closed) {
          void kill(runner);
          return;
        }
        handoff(runner);
      },
      (error: unknown) => {
        live--;
        logger.error({ error }, 'sql runner failed to start');
        const [waiter] = waiters;
        if (waiter === undefined) return;
        waiters.delete(waiter);
        waiter(asError(error));
      },
    );
    track(spawning, pending);
  };

  /** Пул остаётся тёплым: после потери процесса поднимаем замену в фоне. */
  const replenish = () => {
    if (closed || live >= size) return;
    if (keepWarm || waiters.size > 0) spawnInBackground();
  };

  const acquire = (): Promise<Runner> => {
    keepWarm = true;
    const runner = idle.pop();
    if (runner !== undefined) return Promise.resolve(runner);
    return new Promise((resolve, reject) => {
      waiters.add((result) =>
        result instanceof Error ? reject(result) : resolve(result),
      );
      if (live < size) spawnInBackground();
    });
  };

  const release = (runner: Runner, killed: boolean) => {
    if (closed) {
      void kill(runner);
      return;
    }
    const recycle = recycleAfter > 0 && runner.uses >= recycleAfter;
    if (!killed && !runner.dead && !recycle) {
      handoff(runner);
      return;
    }
    live--;
    if (killed) stats.kills++;
    else if (recycle && !runner.dead) stats.recycled++;
    void kill(runner);
    replenish();
  };

  const watchRss = (
    pid: number,
    runner: Runner,
    job: Job,
    startedAt: number,
  ): NodeJS.Timeout => {
    let busy = false;
    let warned = false;
    return setInterval(() => {
      if (busy) return;
      busy = true;
      void readRssKb(pid).then((kb) => {
        busy = false;
        if (kb < 0) {
          if (!warned) logger.debug({ pid }, 'RSS is not observable');
          warned = true;
          return;
        }
        if (kb <= maxRssKb || runner.current !== job) return;
        const mib = Math.round(kb / KIB);
        const limitMib = Math.round(maxRssKb / KIB);
        job.settle({
          verdict: hostVerdict(
            'resource_kill',
            `runner RSS ${mib} MiB exceeded ${limitMib} MiB`,
            startedAt,
          ),
          rssKb: kb,
          killed: true,
        });
      });
    }, pollMs);
  };

  const closedOutcome = (): PoolOutcome => ({
    verdict: hostVerdict('internal', 'verifier is closed', performance.now()),
    rssKb: null,
    killed: false,
  });

  const exchange = (
    runner: Runner,
    request: CheckRequest,
    startedAt: number,
  ): Promise<PoolOutcome> =>
    new Promise((resolve) => {
      const id = nextId++;
      const timeoutMs = request.limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs;
      const timers: { deadline?: NodeJS.Timeout; watcher?: NodeJS.Timeout } =
        {};
      const job: Job = {
        id,
        settle: (outcome) => {
          clearTimeout(timers.deadline);
          clearInterval(timers.watcher);
          runner.current = null;
          resolve(outcome);
        },
      };
      timers.deadline = setTimeout(() => {
        job.settle({
          verdict: hostVerdict(
            'timeout',
            `no answer within ${timeoutMs} ms, runner killed`,
            startedAt,
          ),
          rssKb: null,
          killed: true,
        });
      }, timeoutMs + graceMs);
      runner.current = job;
      if (runner.pid !== undefined) {
        timers.watcher = watchRss(runner.pid, runner, job, startedAt);
      }
      const message: ToWorker = { type: 'check', id, req: request };
      const ipcFailed = (error: unknown) =>
        markDead(runner, `runner IPC failed: ${asError(error).message}`);
      try {
        runner.child.send(message, (error) => {
          if (error !== null) ipcFailed(error);
        });
      } catch (error) {
        ipcFailed(error);
      }
    });

  const run = async (request: CheckRequest): Promise<PoolOutcome> => {
    if (closed) return closedOutcome();
    const startedAt = performance.now();
    let runner: Runner;
    try {
      runner = await acquire();
    } catch (error) {
      if (closed) return closedOutcome();
      stats.crashes++;
      return {
        verdict: hostVerdict('worker_crash', asError(error).message, startedAt),
        rssKb: null,
        killed: false,
      };
    }
    if (closed) {
      release(runner, false);
      return closedOutcome();
    }
    runner.uses++;
    stats.checks++;
    const outcome = await exchange(runner, request, startedAt);
    if (outcome.verdict.code === 'worker_crash') {
      stats.crashes++;
      logger.warn(
        {
          pid: runner.pid,
          reason: outcome.verdict.reason,
          stderr: runner.stderrTail,
        },
        'sql runner crashed',
      );
    }
    // убитый процесс уходит до возврата вердикта: тест и вызывающий видят чистое состояние
    if (outcome.killed) await kill(runner);
    release(runner, outcome.killed);
    return outcome;
  };

  const warm = async () => {
    keepWarm = true;
    const missing = closed ? 0 : Math.max(0, size - live);
    for (let i = 0; i < missing; i++) spawnInBackground();
    await Promise.allSettled([...spawning]);
    if (!closed && live === 0) throw new Error('sql runner failed to start');
  };

  const info = async (): Promise<ReadyInfo> => {
    const runner = await acquire();
    const { info: ready } = runner;
    handoff(runner);
    return ready;
  };

  const close = async () => {
    closed = true;
    for (const waiter of waiters) waiter(new Error('verifier is closed'));
    waiters.clear();
    idle.length = 0;
    for (const runner of [...all]) {
      runner.current?.settle(closedOutcome());
      void kill(runner);
    }
    live = 0;
    await Promise.allSettled([...spawning]);
    await Promise.all([...killing]);
  };

  return {
    warm,
    run,
    info,
    close,
    stats: () => ({ ...stats, live, idle: idle.length }),
    pids: () =>
      [...all].flatMap(({ pid, dead }) =>
        pid === undefined || dead ? [] : [pid],
      ),
  };
};
