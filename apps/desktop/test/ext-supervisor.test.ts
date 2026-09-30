import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExtSupervisor } from '../electron/main/ext-supervisor.ts';
import type { HostProcessLike } from '../electron/main/supervisor.ts';
import {
  BACKOFF_BASE_MS,
  MAX_CRASHES,
  STOP_TIMEOUT_MS,
} from '../electron/main/supervisor.ts';

type Listener = (...args: never[]) => void;

const createFakeHost = () => {
  const listeners = new Map<string, Listener[]>();
  const posted: unknown[] = [];
  const host = {
    pid: 200,
    killed: 0,
    posted,
    postMessage: (message: unknown) => {
      posted.push(message);
    },
    kill: () => {
      host.killed += 1;
      return true;
    },
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    once: (event: string, listener: Listener) => {
      const wrapper: Listener = (...args) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== wrapper),
        );
        listener(...args);
      };
      host.on(event, wrapper);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) {
        (listener as (...values: unknown[]) => void)(...args);
      }
    },
  };
  return host;
};
type FakeHost = ReturnType<typeof createFakeHost>;

const errors: unknown[] = [];
const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: (fields: object, message?: string) => {
    errors.push({ fields, message });
  },
};

const setup = () => {
  const hosts: FakeHost[] = [];
  const fork = vi.fn((): HostProcessLike => {
    const host = createFakeHost();
    hosts.push(host);
    return host as unknown as HostProcessLike;
  });
  const events: string[] = [];
  const init = { type: 'init', libraryRoot: '/lib' };
  const supervisor = createExtSupervisor({
    utilityProcess: { fork },
    hostPath: '/host/ext-host.js',
    init,
    logger,
    onHostReady: () => events.push('ready'),
    onHostExit: () => events.push('exit'),
  });
  const boot = (host: FakeHost) => {
    host.emit('spawn');
    host.emit('message', { type: 'ready' });
  };
  return { supervisor, hosts, fork, events, init, boot };
};

describe('ext supervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    errors.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('передаёт init после spawn и сообщает ready', () => {
    const { supervisor, hosts, fork, init, events } = setup();
    supervisor.start();
    expect(fork).toHaveBeenCalledWith('/host/ext-host.js', [], {
      serviceName: 'lms-ext-host',
    });
    const [host] = hosts;
    host?.emit('spawn');
    expect(host?.posted).toEqual([init]);
    host?.emit('message', { type: 'other' });
    expect(events).toEqual([]);
    host?.emit('message', { type: 'ready' });
    expect(events).toEqual(['ready']);
  });

  it('после падения перезапускает хост с backoff и повторяет init', () => {
    const { supervisor, hosts, fork, boot, init, events } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    hosts[0]?.emit('exit', 1);
    expect(events).toEqual(['ready', 'exit']);
    expect(fork).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(fork).toHaveBeenCalledTimes(2);
    hosts[1]?.emit('spawn');
    expect(hosts[1]?.posted).toEqual([init]);
  });

  it('сдаётся после слишком частых падений и не завершает приложение', () => {
    const { supervisor, hosts, fork } = setup();
    supervisor.start();
    for (let crash = 0; crash <= MAX_CRASHES; crash++) {
      hosts[crash]?.emit('exit', 1);
      vi.advanceTimersByTime(10_000);
    }
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 1);
    expect(errors.some((e) => JSON.stringify(e).includes('gave up'))).toBe(
      true,
    );
  });

  it('kill убивает текущий хост, повторный запуск делает рестарт', () => {
    const { supervisor, hosts, fork } = setup();
    supervisor.start();
    expect(supervisor.kill()).toBe(true);
    expect(hosts[0]?.killed).toBe(1);
    hosts[0]?.emit('exit', 137);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('restart: убивает хост и поднимает новый сразу, без учёта падения', () => {
    const { supervisor, hosts, fork, events, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    for (let round = 0; round < MAX_CRASHES + 3; round++) {
      supervisor.restart();
      expect(hosts[round]?.killed).toBe(1);
      hosts[round]?.emit('exit', 0);
    }
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 4);
    expect(errors).toEqual([]);
    expect(events.filter((event) => event === 'exit')).toHaveLength(
      MAX_CRASHES + 3,
    );
    // первое настоящее падение — базовая задержка
    hosts[MAX_CRASHES + 3]?.emit('exit', 1);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 5);
  });

  it('restart без хоста запускает его сразу и отменяет отложенный запуск', () => {
    const { supervisor, hosts, fork } = setup();
    supervisor.start();
    hosts[0]?.emit('exit', 1);
    supervisor.restart();
    expect(fork).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('restart после отказа «gave up» поднимает хост снова', () => {
    const { supervisor, hosts, fork } = setup();
    supervisor.start();
    for (let crash = 0; crash <= MAX_CRASHES; crash++) {
      hosts[crash]?.emit('exit', 1);
      vi.advanceTimersByTime(10_000);
    }
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 1);
    supervisor.restart();
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 2);
  });

  it('restart во время остановки игнорируется', async () => {
    const { supervisor, hosts, fork, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    const stopped = supervisor.stop();
    supervisor.restart();
    expect(hosts[0]?.killed).toBe(0);
    hosts[0]?.emit('exit', 0);
    await stopped;
    supervisor.restart();
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('stop шлёт shutdown, а по таймауту убивает хост', async () => {
    const { supervisor, hosts, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    const stopped = supervisor.stop();
    expect(hosts[0]?.posted.at(-1)).toEqual({ type: 'shutdown' });
    vi.advanceTimersByTime(STOP_TIMEOUT_MS);
    expect(hosts[0]?.killed).toBe(1);
    hosts[0]?.emit('exit', 0);
    await stopped;
    vi.advanceTimersByTime(10_000);
    expect(hosts).toHaveLength(1);
  });
});
