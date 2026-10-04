import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import {
  createRestrictedRunner,
  defaultSpawn,
} from '../src/restricted-runner.ts';
import type { SpawnRestricted } from '../src/restricted-runner.ts';
import {
  attemptClosed,
  createHarness,
  sessionStarted,
} from './state-harness.ts';
import type { Harness } from './state-harness.ts';
import { createLogger } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/state-extensions', import.meta.url),
);
const entryPath = fileURLToPath(
  new URL('./fixtures/restricted-main.mjs', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Тест запускает дочерний процесс из исходников (см. restricted.test.ts)
const extraArgs = [
  `--allow-fs-read=${realpathSync(repoRoot)}`,
  '--disable-warning=ExperimentalWarning',
  ...((process.features as { typescript?: unknown }).typescript === false
    ? ['--experimental-strip-types']
    : []),
];
const spawnFromSources: SpawnRestricted = (spec) =>
  defaultSpawn({
    ...spec,
    args: [...spec.args.slice(0, -1), ...extraArgs, spec.args.at(-1) as string],
  });

const ID = 'acme.stateful';
// запуск процесса из исходников занимает секунды
const SLOW = { timeout: 20_000, interval: 50 };
let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

const start = async (): Promise<Harness> => {
  const found = await discoverExtensions({
    roots: [{ dir: fixtures, origin: 'user' }],
    logger: createLogger(),
  });
  const extension = found.extensions.find(
    ({ id }) => id === ID,
  ) as ResolvedExtension;
  harness = createHarness({
    extensions: [extension], // origin user и не доверено: изоляция включена
    runners: {
      create: (item, engine) =>
        createRestrictedRunner({
          extension: item,
          entryPath,
          library: { readText: async () => '', stat: async () => null },
          engine,
          logger: createLogger(),
          spawn: spawnFromSources,
        }),
    },
  });
  return harness;
};

describe('изолированное расширение в настоящем ограниченном процессе', () => {
  it('получает события, читает настройки и пишет в хранилище через движок', async () => {
    const h = await start();
    h.engine.changeSetting({
      extensionId: ID,
      id: 'acme.stateful.greeting',
      value: 'hi',
    });

    h.engine.emit(attemptClosed('e1'));

    await vi.waitFor(
      async () =>
        expect(await h.engine.read(ID, 'attempt:e1')).toEqual({
          grade: 4,
          greeting: 'hi',
        }),
      SLOW,
    );
    expect(await h.engine.read(ID, 'greeting-at-start')).toBe('hi');
    expect(await h.engine.read(ID, 'activations')).toBe(1);
  });

  it('превышение потолка в процессе — StorageQuotaError с kind и limit; изменение настройки доходит без перезапуска', async () => {
    const h = await start();
    h.engine.emit(sessionStarted('s1'));
    await vi.waitFor(
      async () =>
        expect(await h.engine.read(ID, 'quota')).toEqual({
          name: 'StorageQuotaError',
          kind: 'key-length',
          limit: 128,
        }),
      SLOW,
    );

    h.engine.changeSetting({
      extensionId: ID,
      id: 'acme.stateful.greeting',
      value: 'later',
    });

    await vi.waitFor(
      async () =>
        expect(await h.engine.read(ID, 'changed')).toEqual({
          id: 'acme.stateful.greeting',
          value: 'later',
        }),
      SLOW,
    );
    // процесс не перезапускался: активация одна
    expect(await h.engine.read(ID, 'activations')).toBe(1);
  });

  it('доверенное расширение получает те же события в процессе хоста', async () => {
    const h = await start();
    h.policy.update({ disabled: [], trusted: [ID], checkUpdates: true });
    // в процессе хоста модуль берётся настоящим import() из каталога расширения
    h.engine.emit(attemptClosed('e2'));

    await vi.waitFor(
      async () =>
        expect(await h.engine.read(ID, 'attempt:e2')).toEqual({
          grade: 4,
          greeting: 'hello',
        }),
      SLOW,
    );
  });
});
