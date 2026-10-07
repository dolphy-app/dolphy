import { fileURLToPath } from 'node:url';
import { ExerciseTypeError } from '@dolphy-app/engine/ports';
import type { ExtensionModule } from '@dolphy-app/extension-api';
import { describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import { createHostChannel } from '../src/channel.ts';
import { createRemoteExerciseTypes } from '../src/client.ts';
import { discoverExtensions } from '../src/discover.ts';
import type { DiscoveryResult } from '../src/discover.ts';
import { createDiscoveryHolder } from '../src/holder.ts';
import { createEndpointPair } from '../src/loopback.ts';
import { createAllEnabledPolicy } from '../src/policy.ts';
import { createExtensionReloader } from '../src/reloader.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime } from '../src/runtime.ts';
import { createLogger, nullLibrary } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const discover = (): Promise<DiscoveryResult> =>
  discoverExtensions({
    roots: [{ dir: fixtures, origin: 'bundled' }],
    logger: createLogger(),
  });

/** `grade` ждёт `gate` и сообщает, что вошёл в обработчик: тест держит вызов в полёте, пока не отпустит. */
const control: { gate: Promise<void>; entered: () => void } = {
  gate: Promise.resolve(),
  entered: () => {},
};

const echoModule = (label: string): ExtensionModule => ({
  activate(ctx) {
    ctx.registerExerciseType('acme.echo', {
      project: () => label,
      grade: async () => {
        control.entered();
        await control.gate;
        return { outcome: 'passed' };
      },
    });
  },
});

/** Движок и хост расширений, соединённые в памяти: канал, который сам отправляет набор при подключении. */
const setup = async () => {
  const empty: DiscoveryResult = {
    extensions: [],
    diagnostics: [],
    overridden: [],
  };
  const holder = createDiscoveryHolder(empty);
  const logger = createLogger();
  const channel = createHostChannel({
    logger,
    currentExtensions: () => holder.get().extensions,
  });
  const types = createRemoteExerciseTypes({
    channel,
    catalog: createCatalog(holder, createAllEnabledPolicy()),
    logger,
  });
  const connect = (): ExtensionRuntime => {
    const runtime = createExtensionRuntime({
      extensions: [],
      library: nullLibrary,
      logger: createLogger(),
      modules: { 'acme.echo': echoModule('v1') },
    });
    const [engineSide, hostSide] = createEndpointPair();
    runtime.attach(hostSide);
    channel.attach(engineSide);
    return runtime;
  };
  const reloadFrom = (source: () => Promise<DiscoveryResult>) =>
    createExtensionReloader({ holder, discover: source, channel, logger });
  return { holder, channel, types, connect, reloadFrom, logger };
};

describe('createExtensionReloader', () => {
  it('заменяет снимок движка и набор хоста; вызов к новому виду проходит после reload()', async () => {
    const { holder, types, connect, reloadFrom, logger } = await setup();
    connect();
    await expect(
      types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    ).rejects.toBeInstanceOf(ExerciseTypeError); // набор пуст

    await reloadFrom(discover).reload();
    expect(holder.get().extensions.length).toBeGreaterThan(0);
    // хост подтвердил замену: предупреждения об отсутствии подтверждения нет
    expect(logger.warn).not.toHaveBeenCalled();
    expect(
      await types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    ).toBe('v1');
  });

  it('хост, подключённый после reload(), получает текущий набор при подключении', async () => {
    const { types, connect, reloadFrom, channel } = await setup();
    await reloadFrom(discover).reload(); // хоста нет: ничего не отправляется и ничего не ждётся
    expect(channel.connected()).toBe(false);
    connect();
    expect(
      await types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    ).toBe('v1');
  });

  it('перезапущенный хост (новый порт, пустой рантайм) снова получает набор', async () => {
    const { types, connect, reloadFrom } = await setup();
    connect();
    await reloadFrom(discover).reload();
    const first = connect(); // «перезапуск»: прежний endpoint закрывается, рантайм новый
    await first.dispose();
    const second = connect();
    expect(
      await types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} }),
    ).toBe('v1');
    await second.dispose();
  });

  it('набор, который не удалось собрать, прежний снимок не меняет и отдаётся ошибкой', async () => {
    const { holder, reloadFrom } = await setup();
    const before = holder.get();
    const failing = vi.fn(async (): Promise<DiscoveryResult> => {
      throw new Error('roots are unreadable');
    });
    await expect(reloadFrom(failing).reload()).rejects.toThrow(
      'roots are unreadable',
    );
    expect(holder.get()).toBe(before);
  });

  it('удаление расширения посреди вызова: вызов завершается своим вердиктом, а не worker_crash', async () => {
    const { holder, types, connect, reloadFrom } = await setup();
    connect();
    await reloadFrom(discover).reload();
    let release: () => void = () => {};
    control.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      control.entered = resolve;
    });
    const call = () =>
      types.grade({
        type: 'acme.echo',
        exerciseId: 'e',
        spec: {},
        answer: 1,
        timeoutMs: 1000,
        authorMode: false,
      });
    const running = call();
    // вызов дошёл до обработчика хоста и стоит на `control.gate`
    await entered;
    const removed = async (): Promise<DiscoveryResult> => ({
      ...holder.get(),
      extensions: holder
        .get()
        .extensions.filter(({ id }): boolean => id !== 'acme.echo'),
    });
    await reloadFrom(removed).reload();
    release();
    control.gate = Promise.resolve();
    expect(await running).toMatchObject({ outcome: 'passed' });
    // новый вызов уже не находит вид: ошибка, не крах
    await expect(call()).resolves.toMatchObject({
      outcome: 'error',
      reason: 'internal',
    });
  });
});
