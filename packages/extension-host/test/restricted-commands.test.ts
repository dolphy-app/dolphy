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
import { createLogger } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/command-extensions', import.meta.url),
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

const ID = 'acme.commands';
const id = (name: string) => `${ID}.${name}`;
const TEST_TIMEOUT = 30_000;

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

const start = async (commandDeadlineMs?: number) => {
  const found = await discoverExtensions({
    roots: [{ dir: fixtures, origin: 'user' }],
    logger: createLogger(),
  });
  const extension = found.extensions.find(
    (item) => item.id === ID,
  ) as ResolvedExtension;
  const restart = vi.fn();
  // origin user и не доверено: изоляция включена
  harness = createHarness({
    extensions: [extension],
    restart,
    runners: {
      create: (item, engine) =>
        createRestrictedRunner({
          extension: item,
          entryPath,
          library: { readText: async () => '', stat: async () => null },
          engine,
          logger: createLogger(),
          spawn: spawnFromSources,
          ...(commandDeadlineMs !== undefined && { commandDeadlineMs }),
        }),
    },
  });
  return { h: harness, restart };
};

describe('команды изолированного расширения в настоящем ограниченном процессе', () => {
  it(
    'аргументы и результат проходят через процесс; уведомление приходит как notify',
    async () => {
      const { h } = await start();

      expect(
        await h.commands.invoke(ID, id('echo'), { list: [1, 'a', null] }),
      ).toEqual({ kind: 'data', value: { got: { list: [1, 'a', null] } } });
      expect(await h.commands.invoke(ID, id('echo'), undefined)).toEqual({
        kind: 'data',
        value: { got: null },
      });
      expect(await h.commands.invoke(ID, id('notify'), undefined)).toEqual({
        kind: 'notify',
        text: 'from the process',
      });
    },
    TEST_TIMEOUT,
  );

  it(
    'сбой обработчика и результат вне правил доходят типизированной ошибкой, процесс остаётся жив',
    async () => {
      const { h, restart } = await start();
      const pid = await h.commands.invoke(ID, id('pid'), undefined);

      await expect(
        h.commands.invoke(ID, id('fail'), undefined),
      ).rejects.toMatchObject({
        cause: 'handler-failed',
        message: 'child boom',
      });
      await expect(
        h.commands.invoke(ID, id('ghost-panel'), undefined),
      ).rejects.toMatchObject({ cause: 'invalid-result' });

      expect(await h.commands.invoke(ID, id('pid'), undefined)).toEqual(pid);
      expect(restart).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );

  it(
    'бесконечный цикл: раннер убивает процесс по своему сроку — timeout; хост не перезапускается, следующий вызов поднимает новый процесс',
    async () => {
      const { h, restart } = await start(2_500);
      const before = await h.commands.invoke(ID, id('pid'), undefined);

      await expect(
        h.commands.invoke(ID, id('spin'), undefined),
      ).rejects.toMatchObject({
        name: 'ExtensionCommandError',
        cause: 'timeout',
      });

      const after = await h.commands.invoke(ID, id('pid'), undefined);
      expect(after).toMatchObject({ kind: 'data' });
      expect(after).not.toEqual(before);
      expect(restart).not.toHaveBeenCalled();
    },
    TEST_TIMEOUT,
  );
});
