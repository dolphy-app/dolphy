import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import { afterEach, describe, expect, it } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import { createHostChannel } from '../src/channel.ts';
import { createRemoteExerciseTypes } from '../src/client.ts';
import { discoverExtensions } from '../src/discover.ts';
import { createAllEnabledPolicy } from '../src/policy.ts';
import { createDiscoveryHolder, discoveryOf } from '../src/holder.ts';
import { createLogger, deferred } from './helpers.ts';
import type { Deferred } from './helpers.ts';

const childPath = fileURLToPath(
  new URL('./fixtures/host-child.mjs', import.meta.url),
);
const extensionsDir = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

/** Endpoint поверх IPC-канала дочернего процесса. */
const ipcEndpoint = (child: ChildProcess): MessageEndpoint => ({
  post: (message) => {
    if (child.connected) child.send(message as never);
  },
  onMessage: (listener) => {
    child.on('message', (message) => listener(message));
  },
  onClose: (listener) => {
    child.once('exit', listener);
  },
  close: () => void child.kill('SIGKILL'),
});

/** Запускает extension host и ждёт `{ ready: true }`. */
const spawnHost = async (): Promise<ChildProcess> => {
  const execArgv = ['--disable-warning=ExperimentalWarning'];
  const { typescript } = process.features as { typescript?: unknown };
  // Node 22.12–22.17: type stripping включается флагом
  if (typescript === false) execArgv.unshift('--experimental-strip-types');
  const child = fork(childPath, [], {
    execArgv,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'json',
  });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  await new Promise<void>((resolve, reject) => {
    child.on('message', (message) => {
      if ((message as { ready?: boolean }).ready) resolve();
    });
    child.once('exit', (code) =>
      reject(new Error(`host exited with ${code}: ${stderr}`)),
    );
  });
  return child;
};

describe('extension host в отдельном процессе', () => {
  it('набор расширений приходит по каналу, хост регистрирует их в своём процессе', async () => {
    const { extensions } = await discoverExtensions({
      roots: [{ dir: extensionsDir, origin: 'bundled' }],
      logger: createLogger(),
    });
    const holder = createDiscoveryHolder(discoveryOf(extensions));
    const registered = deferred();
    const channel = createHostChannel({
      logger: createLogger(),
      connectTimeoutMs: 5000,
      currentExtensions: () => holder.get().candidates,
      onRegistrations: (result) => {
        holder.applyRegistrations(result);
        registered.resolve();
      },
    });
    // до подключения хоста вкладов нет: их регистрирует код расширений
    expect(
      holder.get().extensions.flatMap(({ exerciseTypes }) => exerciseTypes),
    ).toEqual([]);

    channel.attach(ipcEndpoint(await spawnHost()));
    await registered.promise;
    const types = holder
      .get()
      .extensions.flatMap(({ exerciseTypes }) => exerciseTypes)
      .map(({ id }) => id);
    expect(types).toEqual(
      expect.arrayContaining(['acme.echo', 'acme.crash', 'acme.minimal']),
    );
    expect(holder.get().diagnostics).toEqual([]);
    await channel.close();
  });

  it('падение расширения во время grade → worker_crash, новый процесс получает набор и работает', async () => {
    const { extensions } = await discoverExtensions({
      roots: [{ dir: extensionsDir, origin: 'bundled' }],
      logger: createLogger(),
    });
    const holder = createDiscoveryHolder(discoveryOf(extensions));
    const logger = createLogger();
    let registered: Deferred = deferred();
    const channel = createHostChannel({
      logger,
      connectTimeoutMs: 5000,
      currentExtensions: () => holder.get().candidates,
      onRegistrations: (result) => {
        holder.applyRegistrations(result);
        registered.resolve();
      },
    });
    const client = createRemoteExerciseTypes({
      channel,
      catalog: createCatalog(holder, createAllEnabledPolicy()),
      logger,
    });
    const grade = (type: string, answer: string) =>
      client.grade({
        type,
        exerciseId: 'e',
        spec: { expected: '42' },
        answer,
        timeoutMs: 5000,
        authorMode: false,
      });

    const first = await spawnHost();
    channel.attach(ipcEndpoint(first));
    await registered.promise;
    expect(await grade('acme.echo', '42')).toMatchObject({ outcome: 'passed' });
    expect(await grade('acme.crash', 'crash')).toMatchObject({
      outcome: 'error',
      reason: 'worker_crash',
    });
    expect(first.exitCode).toBe(3);

    // перезапущенный хост не знает расширений, пока канал не пришлёт набор при подключении
    registered = deferred();
    const second = await spawnHost();
    channel.attach(ipcEndpoint(second));
    await registered.promise;
    expect(await grade('acme.echo', '42')).toMatchObject({ outcome: 'passed' });
    expect(await grade('acme.echo', '1')).toMatchObject({
      outcome: 'failed',
      reason: 'mismatch',
    });
    await client.close();
  });
});
