import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HostProcessLike,
  MessageChannelLike,
  WebContentsLike,
} from '../electron/main/supervisor.ts';
import {
  BACKOFF_CAP_MS,
  MAX_CRASHES,
  STOP_TIMEOUT_MS,
  createSupervisor,
} from '../electron/main/supervisor.ts';

type Listener = (...args: never[]) => void;

interface Posted {
  message: unknown;
  transfer?: unknown[] | undefined;
}

const createFakeHost = () => {
  const listeners = new Map<string, Listener[]>();
  const posted: Posted[] = [];
  const host = {
    pid: 100,
    killed: 0,
    posted,
    postMessage: (message: unknown, transfer?: unknown[]) => {
      posted.push({ message, transfer });
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

const createFakeWindow = (id: number) => {
  const sent: { channel: string; message: unknown; transfer?: unknown[] }[] =
    [];
  let onDestroyed: (() => void) | null = null;
  const webContents: WebContentsLike & { sent: typeof sent } = {
    id,
    sent,
    isDestroyed: () => false,
    postMessage: (channel, message, transfer) => {
      sent.push({ channel, message, ...(transfer ? { transfer } : {}) });
    },
    once: (_event, listener) => {
      onDestroyed = listener;
    },
  };
  return { webContents, destroy: () => onDestroyed?.() };
};

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const setup = () => {
  const hosts: FakeHost[] = [];
  let channels = 0;
  const onFatal = vi.fn();
  const fork = vi.fn((): HostProcessLike => {
    const host = createFakeHost();
    hosts.push(host);
    return host as unknown as HostProcessLike;
  });
  class FakeChannel implements MessageChannelLike {
    readonly port1 = { side: 1, channel: ++channels };
    readonly port2 = { side: 2, channel: channels };
  }
  const config = { libraryRoot: '/lib', dataDir: '/data' };
  const supervisor = createSupervisor({
    utilityProcess: { fork },
    MessageChannelMain: FakeChannel,
    hostPath: '/host/index.js',
    config,
    logger: silentLogger,
    onFatal,
  });
  const boot = (host: FakeHost) => {
    host.emit('spawn');
    host.emit('message', { type: 'ready' });
  };
  return { supervisor, hosts, fork, onFatal, boot, config };
};

describe('supervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('передаёт хосту конфиг после spawn и порт окну только после ready', () => {
    const { supervisor, hosts, fork, config } = setup();
    const win = createFakeWindow(7);
    supervisor.start();
    expect(fork).toHaveBeenCalledWith('/host/index.js', [], {
      serviceName: 'lms-engine',
    });
    const [host] = hosts;
    supervisor.connect(win.webContents);
    expect(win.webContents.sent).toEqual([]); // до ready окно только запомнено

    host?.emit('spawn');
    expect(host?.posted[0]?.message).toEqual({ type: 'init', config });
    host?.emit('message', { type: 'ready' });

    expect(host?.posted[1]).toMatchObject({
      message: { type: 'connect', clientId: '7' },
      transfer: [{ side: 1, channel: 1 }],
    });
    expect(win.webContents.sent).toEqual([
      {
        channel: 'engine:port',
        message: null,
        transfer: [{ side: 2, channel: 1 }],
      },
    ]);
  });

  it('окно, подключившееся после ready, получает порт сразу', () => {
    const { supervisor, hosts, boot } = setup();
    const win = createFakeWindow(1);
    supervisor.start();
    boot(hosts[0] as FakeHost);
    supervisor.connect(win.webContents);
    expect(win.webContents.sent).toHaveLength(1);
    // перезагрузка страницы: повторный connect выдаёт новый порт
    supervisor.connect(win.webContents);
    expect(win.webContents.sent).toHaveLength(2);
  });

  it('игнорирует чужие сообщения и не выдаёт порт уничтоженному окну', () => {
    const { supervisor, hosts } = setup();
    const win = createFakeWindow(2);
    supervisor.start();
    supervisor.connect(win.webContents);
    hosts[0]?.emit('spawn');
    hosts[0]?.emit('message', { type: 'log' });
    hosts[0]?.emit('message', 'ready');
    expect(win.webContents.sent).toEqual([]);
    win.destroy();
    hosts[0]?.emit('message', { type: 'ready' });
    expect(win.webContents.sent).toEqual([]);
  });

  it('после падения перезапускает хост с экспоненциальным backoff и заново выдаёт порты', () => {
    const { supervisor, hosts, fork, boot } = setup();
    const win = createFakeWindow(3);
    supervisor.start();
    supervisor.connect(win.webContents);
    boot(hosts[0] as FakeHost);
    expect(win.webContents.sent).toHaveLength(1);

    hosts[0]?.emit('exit', 1);
    vi.advanceTimersByTime(499);
    expect(fork).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fork).toHaveBeenCalledTimes(2);

    boot(hosts[1] as FakeHost);
    expect(win.webContents.sent).toHaveLength(2); // новый порт живому окну

    hosts[1]?.emit('exit', 1);
    vi.advanceTimersByTime(999);
    expect(fork).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(fork).toHaveBeenCalledTimes(3);
  });

  it('backoff не превышает потолок', () => {
    const { supervisor, hosts, fork, onFatal } = setup();
    supervisor.start();
    const delays: number[] = [];
    for (let crash = 1; crash <= MAX_CRASHES; crash++) {
      hosts[crash - 1]?.emit('exit', 1);
      const before = fork.mock.calls.length;
      let waited = 0;
      while (fork.mock.calls.length === before) {
        vi.advanceTimersByTime(1);
        waited += 1;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, BACKOFF_CAP_MS]);
    expect(onFatal).not.toHaveBeenCalled();
  });

  it('более 5 падений за 60 с: onFatal и без перезапуска', () => {
    const { supervisor, hosts, fork, onFatal } = setup();
    supervisor.start();
    for (let crash = 1; crash <= MAX_CRASHES; crash++) {
      hosts[crash - 1]?.emit('exit', 1);
      vi.advanceTimersByTime(BACKOFF_CAP_MS);
    }
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 1);
    expect(onFatal).not.toHaveBeenCalled();
    hosts[MAX_CRASHES]?.emit('exit', 1);
    expect(onFatal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BACKOFF_CAP_MS * 2);
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES + 1);
  });

  it('падения старше 60 с не накапливаются', () => {
    const { supervisor, hosts, fork, onFatal } = setup();
    supervisor.start();
    for (let crash = 0; crash < MAX_CRASHES * 2; crash++) {
      hosts[crash]?.emit('exit', 1);
      vi.advanceTimersByTime(61_000); // окно скользит, backoff ≤ 5 с
    }
    expect(onFatal).not.toHaveBeenCalled();
    expect(fork).toHaveBeenCalledTimes(MAX_CRASHES * 2 + 1);
  });

  it('kill убивает хост, перезапуск идёт как при крэше', () => {
    const { supervisor, hosts, fork, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    expect(supervisor.kill()).toBe(true);
    expect(hosts[0]?.killed).toBe(1);
    hosts[0]?.emit('exit', 137);
    vi.advanceTimersByTime(500);
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('stop: shutdown хосту, ожидание exit, без перезапуска', async () => {
    const { supervisor, hosts, fork, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    const stopped = vi.fn();
    const promise = supervisor.stop().then(stopped);
    expect(hosts[0]?.posted.at(-1)?.message).toEqual({ type: 'shutdown' });
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS - 1);
    expect(stopped).not.toHaveBeenCalled();
    expect(hosts[0]?.killed).toBe(0);
    hosts[0]?.emit('exit', 0);
    await promise;
    expect(stopped).toHaveBeenCalled();
    vi.advanceTimersByTime(BACKOFF_CAP_MS * 2);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('stop: хост не ответил за таймаут — kill', async () => {
    const { supervisor, hosts, boot } = setup();
    supervisor.start();
    boot(hosts[0] as FakeHost);
    const stopped = vi.fn();
    const promise = supervisor.stop().then(stopped);
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    expect(hosts[0]?.killed).toBe(1);
    expect(stopped).not.toHaveBeenCalled(); // ждём фактического exit
    hosts[0]?.emit('exit', 137);
    await promise;
    expect(stopped).toHaveBeenCalled();
  });

  it('stop во время ожидания перезапуска отменяет его', async () => {
    const { supervisor, hosts, fork } = setup();
    supervisor.start();
    hosts[0]?.emit('exit', 1);
    await supervisor.stop();
    vi.advanceTimersByTime(BACKOFF_CAP_MS);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('stop до spawn убивает процесс сразу', async () => {
    const { supervisor, hosts } = setup();
    supervisor.start();
    const promise = supervisor.stop();
    expect(hosts[0]?.killed).toBe(1);
    expect(hosts[0]?.posted).toEqual([]);
    hosts[0]?.emit('exit', 1);
    await promise;
  });
});
