import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExtSupervisor } from '../electron/main/ext-supervisor.ts';
import type { ExtSupervisorOptions } from '../electron/main/ext-supervisor.ts';
import type { HostProcessLike } from '../electron/main/supervisor.ts';
import {
  BACKOFF_BASE_MS,
  MAX_CRASHES,
  STOP_TIMEOUT_MS,
} from '../electron/main/supervisor.ts';

type Listener = (...args: never[]) => void;

const createStream = () => {
  const listeners = new Map<string, ((chunk?: never) => void)[]>();
  return {
    on: (event: string, listener: (chunk?: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit: (event: string, chunk?: unknown) => {
      for (const listener of listeners.get(event) ?? []) {
        (listener as (value?: unknown) => void)(chunk);
      }
    },
  };
};

const createFakeHost = () => {
  const listeners = new Map<string, Listener[]>();
  const posted: unknown[] = [];
  const host = {
    pid: 200,
    stdout: createStream(),
    stderr: createStream(),
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

const setup = (extra: Partial<ExtSupervisorOptions> = {}) => {
  const hosts: FakeHost[] = [];
  const fork = vi.fn((): HostProcessLike => {
    const host = createFakeHost();
    hosts.push(host);
    return host as unknown as HostProcessLike;
  });
  const events: string[] = [];
  const statuses: string[] = [];
  const init = { type: 'init', libraryRoot: '/lib' };
  const supervisor = createExtSupervisor({
    utilityProcess: { fork },
    hostPath: '/host/ext-host.js',
    init,
    logger,
    onHostReady: () => events.push('ready'),
    onHostExit: () => events.push('exit'),
    onStatus: (status) => statuses.push(status),
    ...extra,
  });
  const boot = (host: FakeHost) => {
    host.emit('spawn');
    host.emit('message', { type: 'ready' });
  };
  return { supervisor, hosts, fork, events, statuses, init, boot };
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

  it('stderr хоста расширений уходит приёмнику вывода, у каждого запуска свой', () => {
    const seen: string[][] = [];
    const { supervisor, hosts, boot } = setup({
      createOutput: () => {
        const calls: string[] = [];
        seen.push(calls);
        return {
          stdout: () => undefined,
          stderr: (chunk) => calls.push(String(chunk)),
          flush: () => calls.push('flush'),
        };
      },
    });
    supervisor.start();
    boot(hosts[0] as FakeHost);
    hosts[0]?.stderr.emit('data', 'line');
    hosts[0]?.stderr.emit('end');
    expect(seen).toEqual([['line', 'flush']]);
    hosts[0]?.emit('exit', 1);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(seen).toHaveLength(2);
  });

  it('передаёт init после spawn и сообщает ready', () => {
    const { supervisor, hosts, fork, init, events } = setup();
    supervisor.start();
    expect(fork).toHaveBeenCalledWith('/host/ext-host.js', [], {
      serviceName: 'dolphy-ext-host',
      stdio: 'pipe',
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

  /** Падения подряд до `gave-up`: хост поднимается и падает, пока супервизор не сдастся. */
  const crashUntilGaveUp = (
    supervisor: ReturnType<typeof setup>['supervisor'],
    hosts: FakeHost[],
  ) => {
    supervisor.start();
    for (let crash = 0; crash <= MAX_CRASHES; crash++) {
      hosts[crash]?.emit('exit', 1);
      vi.advanceTimersByTime(10_000);
    }
  };

  it('состояние: упал — restarting, поднялся — running, сдался — gave-up; повтор того же состояния не шлётся', () => {
    const { supervisor, hosts, boot, statuses } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    expect(statuses).toEqual([]);
    hosts[0]?.emit('exit', 1);
    expect(statuses).toEqual(['restarting']);
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    boot(hosts[1] as FakeHost);
    expect(statuses).toEqual(['restarting', 'running']);

    for (let crash = 2; crash <= MAX_CRASHES; crash++) {
      hosts[crash - 1]?.emit('exit', 1);
      vi.advanceTimersByTime(10_000);
    }
    hosts[MAX_CRASHES]?.emit('exit', 1);
    expect(statuses.at(-1)).toBe('gave-up');
    expect(statuses.filter((status) => status === 'gave-up')).toHaveLength(1);
  });

  it('reset после gave-up запускает дочерний процесс сразу и обнуляет окно падений', () => {
    const { supervisor, hosts, fork, boot, statuses, init } = setup();
    crashUntilGaveUp(supervisor, hosts);
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 1);
    vi.advanceTimersByTime(60_000);
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 1);
    expect(statuses.at(-1)).toBe('gave-up');

    supervisor.reset();

    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 2);
    expect(statuses.at(-1)).toBe('restarting');
    const revived = hosts.at(-1) as FakeHost;
    revived.emit('spawn');
    expect(revived.posted).toEqual([init]);
    boot(revived);
    expect(statuses.at(-1)).toBe('running');

    // окно падений пусто: до новой капитуляции снова нужно больше MAX_CRASHES подряд
    for (let crash = 0; crash < MAX_CRASHES; crash++) {
      (hosts.at(-1) as FakeHost).emit('exit', 1);
      vi.advanceTimersByTime(10_000);
    }
    expect(statuses.at(-1)).toBe('restarting');
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 2 + MAX_CRASHES);
  });

  it('reset во время ожидания перезапуска не ждёт паузы и не плодит второй процесс', () => {
    const { supervisor, hosts, fork, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    hosts[0]?.emit('exit', 1);

    supervisor.reset();
    expect(fork).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('reset при живом хосте его не трогает', () => {
    const { supervisor, hosts, fork, boot, statuses } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);

    supervisor.reset();

    expect(fork).toHaveBeenCalledTimes(1);
    expect(hosts[0]?.killed).toBe(0);
    expect(statuses).toEqual([]);
  });

  it('после stop reset хост не поднимает', async () => {
    const { supervisor, hosts, fork, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    const stopped = supervisor.stop();
    hosts[0]?.emit('exit', 0);
    await stopped;

    supervisor.reset();

    expect(fork).toHaveBeenCalledTimes(1);
  });
});
