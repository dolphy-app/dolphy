import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions, inspectExtensionDir } from '../src/discover.ts';
import type { ResolvedExtension } from '../src/discover.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime } from '../src/runtime.ts';
import {
  createRestrictedRunner,
  defaultSpawn,
} from '../src/restricted-runner.ts';
import type {
  RestrictedRunner,
  SpawnRestricted,
} from '../src/restricted-runner.ts';
import { createLogger, nullEngine } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);
const entryPath = fileURLToPath(
  new URL('./fixtures/restricted-main.mjs', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Тест запускает дочерний процесс из исходников: ему нужны TypeScript-файлы и
// node_modules репозитория. Сборка приложения самодостаточна и этого не требует.
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

const grade = (id: string, answer: string, type: string): ExtRequest => ({
  id,
  method: 'grade',
  params: {
    type,
    exerciseId: 'e',
    spec: { libraryPath: 'lib/probe.md' },
    answer,
    timeoutMs: 15_000,
    authorMode: false,
    isolated: true,
  },
});

const project = (id: string, type: string): ExtRequest => ({
  id,
  method: 'project',
  params: { type, exerciseId: 'e', spec: {}, isolated: true },
});

const reportOf = (response: ExtResponse): Record<string, string> => {
  if (!response.ok) throw new Error(JSON.stringify(response.error));
  const { feedback } = response.result as { feedback: string };
  return Object.fromEntries(
    (JSON.parse(feedback) as string[]).map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );
};

const extensions = async (): Promise<Map<string, ResolvedExtension>> => {
  const found = await discoverExtensions({
    roots: [{ dir: fixtures, origin: 'user' }],
    logger: createLogger(),
  });
  return new Map(
    found.extensions.map((extension) => [extension.id, extension]),
  );
};

let tmp = '';
const disposables: (() => Promise<void>)[] = [];
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'dolphy-restricted-'));
});
afterEach(async () => {
  for (const dispose of disposables.splice(0)) await dispose();
  await rm(tmp, { recursive: true, force: true });
});

const createRunner = async (
  extension: ResolvedExtension,
  readText = vi.fn(async (file: string) => `lib:${file}`),
): Promise<RestrictedRunner> => {
  const runner = createRestrictedRunner({
    extension,
    entryPath,
    library: { readText, stat: async () => null },
    engine: nullEngine,
    logger: createLogger(),
    spawn: spawnFromSources,
  });
  disposables.push(() => runner.dispose());
  return runner;
};

describe('код расширения в настоящем ограниченном процессе', () => {
  it('без разрешений всё запрещённое отказывает внутри расширения, хост жив и продолжает отвечать', async () => {
    const hostile = (await extensions()).get('acme.hostile');
    if (hostile === undefined) throw new Error('fixture missing');
    const readText = vi.fn(async () => 'secret');
    const runner = await createRunner(hostile, readText);
    const marker = path.join(tmp, 'pwned.txt');

    const report = reportOf(
      await runner.handle(grade('1', marker, 'acme.hostile')),
    );

    expect(report).toEqual({
      'read:/etc/hosts': 'denied',
      write: 'denied',
      spawn: 'denied',
      worker: 'denied',
      'env:HOME': 'unset',
      library: 'denied',
    });
    expect(existsSync(marker)).toBe(false);
    expect(readText).not.toHaveBeenCalled();
    expect(await runner.handle(project('2', 'acme.hostile'))).toEqual({
      id: '2',
      ok: true,
      result: {},
    });
  });

  it('объявленные process.spawn и library.read работают, остальное по-прежнему закрыто', async () => {
    const permitted = (await extensions()).get('acme.permitted');
    if (permitted === undefined) throw new Error('fixture missing');
    const readText = vi.fn(async () => 'hello');
    const runner = await createRunner(permitted, readText);
    const marker = path.join(tmp, 'pwned.txt');

    const report = reportOf(
      await runner.handle(grade('1', marker, 'acme.permitted')),
    );

    expect(report).toMatchObject({
      'read:/etc/hosts': 'denied',
      write: 'denied',
      spawn: 'allowed',
      worker: 'denied',
      library: 'allowed:5',
    });
    expect(readText).toHaveBeenCalledWith('lib/probe.md');
    expect(existsSync(marker)).toBe(false);
  });

  it('смена режима на лету: изоляция → доверие → изоляция', async () => {
    const hostile = (await extensions()).get('acme.hostile');
    if (hostile === undefined) throw new Error('fixture missing');
    const runtime: ExtensionRuntime = createExtensionRuntime({
      extensions: [hostile],
      library: { readText: async () => 'text', stat: async () => null },
      logger: createLogger(),
      runners: {
        create: (extension) => {
          const runner = createRestrictedRunner({
            extension,
            entryPath,
            library: { readText: async () => 'text', stat: async () => null },
            engine: nullEngine,
            logger: createLogger(),
            spawn: spawnFromSources,
          });
          return runner;
        },
      },
    });
    disposables.push(() => runtime.dispose());
    const marker = path.join(tmp, 'pwned.txt');
    const attempt = async (id: string, isolated: boolean) => {
      const request = grade(id, marker, 'acme.hostile');
      if (request.method === 'grade') request.params.isolated = isolated;
      return reportOf(await runtime.handle(request));
    };

    expect((await attempt('1', true)).write).toBe('denied');
    expect(existsSync(marker)).toBe(false);

    const trusted = await attempt('2', false);
    expect(trusted).toMatchObject({
      'read:/etc/hosts': 'allowed',
      write: 'allowed',
      spawn: 'allowed',
      worker: 'allowed',
    });
    expect(existsSync(marker)).toBe(true);
    await rm(marker);

    expect((await attempt('3', true)).write).toBe('denied');
    expect(existsSync(marker)).toBe(false);
  });

  it('расширение в каталоге за символической ссылкой (/var → /private/var) загружается', async () => {
    const real = path.join(tmp, 'real');
    await mkdir(real);
    await cp(
      path.join(fixtures, 'acme.hostile'),
      path.join(real, 'acme.hostile'),
      {
        recursive: true,
      },
    );
    const link = path.join(tmp, 'link');
    await symlink(real, link);
    const inspected = await inspectExtensionDir(
      path.join(link, 'acme.hostile'),
    );
    if (!inspected.ok) throw new Error(inspected.message);
    const runner = await createRunner({
      ...inspected.extension,
      origin: 'user',
      revision: '',
      install: null,
    });

    expect(await runner.handle(project('1', 'acme.hostile'))).toEqual({
      id: '1',
      ok: true,
      result: {},
    });
  });
});
