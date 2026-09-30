import type { MainLogger } from './logger.ts';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  MAX_CRASHES,
  STOP_TIMEOUT_MS,
  WINDOW_MS,
} from './supervisor.ts';
import type { HostProcessLike, UtilityProcessLike } from './supervisor.ts';

export interface ExtSupervisorOptions {
  utilityProcess: UtilityProcessLike;
  hostPath: string;
  /** Сообщение `init` хосту расширений; уходит при каждом запуске. */
  init: object;
  logger: MainLogger;
  onHostReady(host: HostProcessLike): void;
  onHostExit(): void;
  stopTimeoutMs?: number;
}

export interface ExtSupervisor {
  start(): void;
  /** `shutdown` хоста; по таймауту — `kill`. */
  stop(): Promise<void>;
  /** Убить хост (перезапуск сработает как при крэше). */
  kill(): boolean;
}

export const isTypedMessage = (message: unknown, type: string): boolean =>
  typeof message === 'object' &&
  message !== null &&
  'type' in message &&
  message.type === type;

/**
 * Поднимает хост расширений и перезапускает его с backoff. В отличие от
 * хоста движка, отказ не завершает приложение: карточки работают без
 * расширений, вызовы видов заданий получают `host-down`.
 */
export const createExtSupervisor = (
  options: ExtSupervisorOptions,
): ExtSupervisor => {
  const { utilityProcess, hostPath, init, logger } = options;
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  let child: HostProcessLike | null = null;
  let spawned = false;
  let stopping = false;
  let gaveUp = false;
  let restartTimer: NodeJS.Timeout | undefined;
  let crashTimes: number[] = [];

  const onExit = (self: HostProcessLike, code: number) => {
    if (child !== self) return;
    spawned = false;
    child = null;
    options.onHostExit();
    if (stopping) return;
    const now = Date.now();
    crashTimes = [...crashTimes.filter((at) => now - at < WINDOW_MS), now];
    logger.error({ code, crashes: crashTimes.length }, 'extension host exited');
    if (crashTimes.length > MAX_CRASHES) {
      gaveUp = true;
      logger.error({ crashes: crashTimes.length }, 'extension host gave up');
      return;
    }
    const delayMs = Math.min(
      BACKOFF_BASE_MS * 2 ** (crashTimes.length - 1),
      BACKOFF_CAP_MS,
    );
    restartTimer = setTimeout(start, delayMs);
  };

  function start() {
    restartTimer = undefined;
    if (stopping || gaveUp || child) return;
    const self = utilityProcess.fork(hostPath, [], {
      serviceName: 'lms-ext-host',
    });
    child = self;
    self.once('spawn', () => {
      spawned = true;
      self.postMessage(init);
    });
    self.on('message', (message) => {
      if (child !== self || !isTypedMessage(message, 'ready')) return;
      logger.info({ pid: self.pid }, 'extension host ready');
      options.onHostReady(self);
    });
    self.on('exit', (code) => onExit(self, code));
  }

  const stop = () =>
    new Promise<void>((resolve) => {
      stopping = true;
      clearTimeout(restartTimer);
      restartTimer = undefined;
      const current = child;
      if (!current) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        logger.warn(
          { pid: current.pid },
          'extension host stop timed out, kill',
        );
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

  return { start, stop, kill };
};
