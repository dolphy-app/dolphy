import { ExerciseTypeError } from '@dolphy-app/engine/ports';
import { describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import { createHostChannel } from '../src/channel.ts';
import { createRemoteExerciseTypes } from '../src/client.ts';
import type { DiscoveryResult } from '../src/discover.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import { createEndpointPair } from '../src/loopback.ts';
import { createAllEnabledPolicy } from '../src/policy.ts';
import { createExtensionReloader } from '../src/reloader.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime, ServerModule } from '../src/runtime.ts';
import { candidateOf, createLogger, nullLibrary } from './helpers.ts';

const discover = async (): Promise<DiscoveryResult> =>
  discoveryOf([candidateOf('acme.echo')]);

/** `grade` ждёт `gate` и сообщает, что вошёл в обработчик: тест держит вызов в полёте, пока не отпустит. */
const control: { gate: Promise<void>; entered: () => void } = {
  gate: Promise.resolve(),
  entered: () => {},
};

const echoModule = (label: string): ServerModule => ({
  server(server) {
    server.registerExerciseType({
      id: 'acme.echo',
      specSchema: { type: 'object' },
      answerSchema: { type: 'number' },
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
const setup = () => {
  let registered = (): void => {};
  /** Завершается, когда канал отдал регистрации хоста: движок узнаёт о видах только после этого. */
  const nextRegistrations = (): Promise<void> =>
    new Promise((resolve) => {
      registered = resolve;
    });
  const holder = createDiscoveryHolder(discoveryOf([]));
  const logger = createLogger();
  const channel = createHostChannel({
    logger,
    restart: () => {},
    currentExtensions: () => holder.get().candidates,
    onRegistrations: (result) => {
      holder.applyRegistrations(result);
      registered();
    },
  });
  const types = createRemoteExerciseTypes({
    channel,
    catalog: createCatalog(holder, createAllEnabledPolicy()),
    logger,
  });
  const connect = (): ExtensionRuntime => {
    const runtime = createExtensionRuntime({
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
  return {
    holder,
    channel,
    types,
    connect,
    reloadFrom,
    logger,
    nextRegistrations,
  };
};

const project = (types: ReturnType<typeof setup>['types']) =>
  types.project({ type: 'acme.echo', exerciseId: 'e', spec: {} });

describe('createExtensionReloader', () => {
  it('заменяет снимок движка и набор хоста; регистрация из ответа хоста действует после reload()', async () => {
    const { holder, types, connect, reloadFrom, logger } = setup();
    connect();
    await expect(project(types)).rejects.toBeInstanceOf(ExerciseTypeError); // набор пуст

    await reloadFrom(discover).reload();
    expect(holder.get().extensions).toMatchObject([
      { id: 'acme.echo', exerciseTypes: [{ id: 'acme.echo' }] },
    ]);
    // хост подтвердил замену: предупреждения об отсутствии подтверждения нет
    expect(logger.warn).not.toHaveBeenCalled();
    expect(await project(types)).toBe('v1');
  });

  it('хост, подключённый после reload(), получает кандидатов и отдаёт регистрации при подключении', async () => {
    const { holder, types, connect, reloadFrom, channel, nextRegistrations } =
      setup();
    await reloadFrom(discover).reload(); // хоста нет: ничего не отправляется и ничего не ждётся
    expect(channel.connected()).toBe(false);
    expect(holder.get().extensions[0]?.exerciseTypes).toEqual([]);
    const applied = nextRegistrations();
    connect();
    await applied;
    expect(await project(types)).toBe('v1');
    expect(holder.get().extensions[0]?.exerciseTypes).toHaveLength(1);
  });

  it('перезапущенный хост (новый порт, пустой рантайм) снова получает набор', async () => {
    const { types, connect, reloadFrom, nextRegistrations } = setup();
    connect();
    await reloadFrom(discover).reload();
    const first = connect(); // «перезапуск»: прежний endpoint закрывается, рантайм новый
    await first.dispose();
    const applied = nextRegistrations();
    const second = connect();
    await applied;
    expect(await project(types)).toBe('v1');
    await second.dispose();
  });

  it('набор, который не удалось собрать, прежний снимок не меняет и отдаётся ошибкой', async () => {
    const { holder, reloadFrom } = setup();
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
    const { types, connect, reloadFrom } = setup();
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
    await reloadFrom(async () => discoveryOf([])).reload();
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
