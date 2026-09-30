import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import { afterEach, describe, expect, it } from 'vitest';
import { createCatalog } from '../src/catalog.ts';
import { createHostChannel } from '../src/channel.ts';
import { createRemoteExerciseTypes } from '../src/client.ts';
import { discoverExtensions } from '../src/discover.ts';
import { createAllTrustedPolicy } from '../src/policy.ts';
import { createLogger } from './helpers.ts';

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
  it('падение расширения во время grade → worker_crash, новый процесс работает', async () => {
    const { extensions } = await discoverExtensions({
      roots: [{ dir: extensionsDir, origin: 'bundled' }],
      logger: createLogger(),
    });
    const logger = createLogger();
    const channel = createHostChannel({ logger, connectTimeoutMs: 5000 });
    const client = createRemoteExerciseTypes({
      channel,
      catalog: createCatalog(extensions, createAllTrustedPolicy()),
      policy: createAllTrustedPolicy(),
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
    expect(await grade('acme.echo', '42')).toMatchObject({ outcome: 'passed' });
    expect(await grade('acme.crash', 'crash')).toMatchObject({
      outcome: 'error',
      reason: 'worker_crash',
    });
    expect(first.exitCode).toBe(3);

    // между падением и новым attach вызовы ждут хост, а не падают
    const waiting = grade('acme.echo', '42');
    const second = await spawnHost();
    channel.attach(ipcEndpoint(second));
    expect(await waiting).toMatchObject({ outcome: 'passed' });
    expect(await grade('acme.echo', '1')).toMatchObject({
      outcome: 'failed',
      reason: 'mismatch',
    });
    await client.close();
  });
});
