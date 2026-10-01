import { CHANNELS } from '../../shared/bridge.ts';
import type { MainLogger } from './logger.ts';

export const WINDOW_MS = 60_000;
export const MAX_CRASHES = 5;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 5_000;
export const STOP_TIMEOUT_MS = 5_000;

/** То, что супервизор берёт у `UtilityProcess` (структурно совместимо с Electron). */
export interface HostProcessLike {
  readonly pid: number | undefined;
  postMessage(message: unknown, transfer?: unknown[]): void;
  kill(): boolean;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  once(event: 'spawn', listener: () => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
}

export interface UtilityProcessLike {
  fork(
    modulePath: string,
    args: string[],
    options: { serviceName: string },
  ): HostProcessLike;
}

export interface MessageChannelLike {
  readonly port1: unknown;
  readonly port2: unknown;
}

export interface WebContentsLike {
  readonly id: number;
  isDestroyed(): boolean;
  postMessage(channel: string, message: unknown, transfer?: unknown[]): void;
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface SupervisorOptions {
  utilityProcess: UtilityProcessLike;
  MessageChannelMain: new () => MessageChannelLike;
  hostPath: string;
  /** Конфиг движка; уходит хосту сообщением `init` при каждом запуске. */
  config: object;
  logger: MainLogger;
  /** Слишком частые падения хоста: показать ошибку и завершить приложение. */
  onFatal(): void;
  /** Хост сообщил `ready` (вызывается до выдачи портов окнам). */
  onHostReady?(host: HostProcessLike): void;
  /** Процесс хоста завершился (в том числе при остановке). */
  onHostExit?(): void;
  /** Любое сообщение хоста, кроме `ready`. */
  onMessage?(message: unknown): void;
  stopTimeoutMs?: number;
}

export interface Supervisor {
  start(): void;
  /** Запомнить окно и выдать ему порт (сразу или по `ready` хоста). */
  connect(webContents: WebContentsLike): void;
  /** `shutdown` хоста; по таймауту — `kill`. */
  stop(): Promise<void>;
  /** Убить хост без остановки супервизора (перезапуск сработает как при крэше). */
  kill(): boolean;
}

const isReadyMessage = (message: unknown): boolean =>
  typeof message === 'object' &&
  message !== null &&
  (message as { type?: unknown }).type === 'ready';

/** Поднимает хост движка, перезапускает с backoff, выдаёт каждому окну свежий порт. */
export const createSupervisor = (options: SupervisorOptions): Supervisor => {
  const { utilityProcess, MessageChannelMain, hostPath, config, logger } =
    options;
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  let child: HostProcessLike | null = null;
  let spawned = false;
  let ready = false;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let crashTimes: number[] = [];
  const windows = new Set<WebContentsLike>();

  const link = (webContents: WebContentsLike) => {
    if (!child || webContents.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: 'connect', clientId: String(webContents.id) }, [
      port1,
    ]);
    webContents.postMessage(CHANNELS.enginePort, null, [port2]);
  };

  const onExit = (self: HostProcessLike, code: number) => {
    if (child !== self) return;
    ready = false;
    spawned = false;
    child = null;
    options.onHostExit?.();
    if (stopping) return;
    const now = Date.now();
    crashTimes = [...crashTimes.filter((at) => now - at < WINDOW_MS), now];
    logger.error({ code, crashes: crashTimes.length }, 'engine host exited');
    if (crashTimes.length > MAX_CRASHES) {
      options.onFatal();
      return;
    }
    const delayMs = Math.min(
      BACKOFF_BASE_MS * 2 ** (crashTimes.length - 1),
      BACKOFF_CAP_MS,
    );
    restartTimer = setTimeout(start, delayMs);
  };

  function start() {
    restartTimer = null;
    if (stopping || child) return;
    const self = utilityProcess.fork(hostPath, [], {
      serviceName: 'dolphy-engine',
    });
    child = self;
    self.once('spawn', () => {
      spawned = true;
      self.postMessage({ type: 'init', config });
    });
    self.on('message', (message) => {
      if (child !== self) return;
      if (!isReadyMessage(message)) {
        options.onMessage?.(message);
        return;
      }
      ready = true;
      logger.info({ pid: self.pid, message }, 'engine host ready');
      options.onHostReady?.(self);
      for (const webContents of windows) link(webContents);
    });
    self.on('exit', (code) => onExit(self, code));
  }

  const connect = (webContents: WebContentsLike) => {
    if (!windows.has(webContents)) {
      windows.add(webContents);
      webContents.once('destroyed', () => windows.delete(webContents));
    }
    if (ready) link(webContents); // иначе будет связано по 'ready'
  };

  const stop = () =>
    new Promise<void>((resolve) => {
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const current = child;
      if (!current) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        logger.warn({ pid: current.pid }, 'engine host stop timed out, kill');
        current.kill();
      }, stopTimeoutMs);
      current.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      if (spawned) current.postMessage({ type: 'shutdown' });
      else current.kill();
    });

  const kill = () => child?.kill() ?? false;

  return { start, connect, stop, kill };
};
