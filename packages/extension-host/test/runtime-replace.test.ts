import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntryResult } from '@dolphy-app/extension-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionCandidate, ExtensionOrigin } from '../src/discover.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { ExtensionRuntime, ServerModule } from '../src/runtime.ts';
import { candidateOf, createLogger, nullLibrary } from './helpers.ts';
import type { TestLogger } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const ID = 'acme.echo';

const echo = (overrides: Partial<ExtensionCandidate> = {}) =>
  candidateOf(ID, { revision: 'r1', ...overrides });

const project = (id = '1'): ExtRequest => ({
  id,
  method: 'project',
  params: { type: ID, exerciseId: 'e', spec: {} },
});

const grade = (id = '1', timeoutMs = 1000): ExtRequest => ({
  id,
  method: 'grade',
  params: {
    type: ID,
    exerciseId: 'e',
    spec: {},
    answer: 1,
    timeoutMs,
    authorMode: false,
  },
});

const resultOf = (response: ExtResponse): unknown =>
  response.ok ? response.result : response.error;

const schemas = {
  specSchema: { type: 'object' },
  answerSchema: { type: 'string' },
};

/** Серверная часть, отвечающая своим именем; `grade` ждёт, пока тест его не отпустит. */
const versioned = (
  label: string,
  options: { gate?: Promise<void>; cleanup?: EntryResult; id?: string } = {},
) => {
  const cleanup = vi.fn();
  const server = vi.fn<NonNullable<ServerModule['server']>>((s) => {
    s.registerExerciseType({
      id: options.id ?? ID,
      ...schemas,
      project: () => label,
      grade: async () => {
        await options.gate;
        return { outcome: 'passed', feedback: label };
      },
    });
    return options.cleanup ?? cleanup;
  });
  return { module: { server } satisfies ServerModule, server, cleanup };
};

let runtime: ExtensionRuntime | null = null;
let logger: TestLogger;
afterEach(async () => {
  vi.useRealTimers();
  await runtime?.dispose();
  runtime = null;
});

const open = (
  modules: Record<string, ServerModule>,
  options: { drainGraceMs?: number } = {},
): ExtensionRuntime => {
  logger = createLogger();
  runtime = createExtensionRuntime({
    library: nullLibrary,
    logger,
    modules,
    ...options,
  });
  return runtime;
};

describe('ExtensionRuntime.replace', () => {
  it('тот же revision и mainPath: server не вызывается снова, обработчики работают, очистка не вызывается', async () => {
    const first = versioned('v1');
    const host = open({ [ID]: first.module });
    await host.replace([echo()]);
    expect(resultOf(await host.handle(project()))).toBe('v1');

    const again = await host.replace([echo({ version: '1.0.1' })]);
    expect(again.registrations[ID]).toMatchObject({
      ok: true,
      registration: { exerciseTypes: [{ id: ID }] },
    });
    expect(resultOf(await host.handle(project('2')))).toBe('v1');
    expect(first.server).toHaveBeenCalledTimes(1);
    expect(first.cleanup).not.toHaveBeenCalled();
  });

  it('новый revision: server вызывается заново, вызовы идут в новый код, очистка прежнего вызвана', async () => {
    const modules: Record<string, ServerModule> = {};
    const old = versioned('v1');
    const next = versioned('v2');
    modules[ID] = old.module;
    const host = open(modules);
    await host.replace([echo()]);
    expect(resultOf(await host.handle(project()))).toBe('v1');

    modules[ID] = next.module;
    await host.replace([echo({ revision: 'r2' })]);
    expect(resultOf(await host.handle(project('2')))).toBe('v2');
    await host.dispose();
    expect(old.cleanup).toHaveBeenCalledTimes(1);
    expect(next.server).toHaveBeenCalledTimes(1);
    expect(next.cleanup).toHaveBeenCalledTimes(1);
  });

  it('другой mainPath при том же revision — тоже перезапуск', async () => {
    const modules: Record<string, ServerModule> = {};
    const old = versioned('v1');
    modules[ID] = old.module;
    const host = open(modules);
    await host.replace([echo()]);
    modules[ID] = versioned('moved').module;
    await host.replace([echo({ mainPath: '/y/acme.echo/main.mjs' })]);
    expect(resultOf(await host.handle(project('2')))).toBe('moved');
    await host.dispose();
    expect(old.cleanup).toHaveBeenCalledTimes(1);
  });

  it('новая версия не зарегистрировалась: прежняя выгружена, вклады расширения пропали', async () => {
    const modules: Record<string, ServerModule> = {};
    const old = versioned('v1');
    modules[ID] = old.module;
    const host = open(modules);
    await host.replace([echo()]);
    modules[ID] = {
      server: () => {
        throw new Error('v2 is broken');
      },
    };
    const result = await host.replace([echo({ revision: 'r2' })]);
    expect(result.registrations[ID]).toEqual({
      ok: false,
      error: 'v2 is broken',
    });
    expect(resultOf(await host.handle(project('2')))).toMatchObject({
      cause: 'unknown-type',
    });
    await host.dispose();
    expect(old.cleanup).toHaveBeenCalledTimes(1);
  });

  it('удалённое расширение перестаёт отвечать, его очистка вызвана; вызов к нему — unknown-type', async () => {
    const old = versioned('v1');
    const host = open({ [ID]: old.module });
    await host.replace([echo()]);
    await host.replace([]);
    await host.dispose();
    expect(old.cleanup).toHaveBeenCalledTimes(1);
    expect(resultOf(await host.handle(project('2')))).toMatchObject({
      cause: 'unknown-type',
    });
  });

  it('добавленное расширение сразу доступно, остальные не перезапускаются', async () => {
    const first = versioned('v1');
    const policy = vi.fn(() => 5 as const);
    const host = open({
      [ID]: first.module,
      'acme.policy': {
        server: (s) => {
          s.registerGradePolicy({
            id: 'acme.policy.generous',
            label: 'Generous',
            evaluate: policy,
          });
        },
      },
    });
    await host.replace([echo()]);
    await host.replace([echo(), candidateOf('acme.policy')]);
    const response = await host.handle({
      id: '2',
      method: 'gradePolicy',
      params: { policyId: 'acme.policy.generous', verdicts: [], gaveUp: false },
    });
    expect(resultOf(response)).toBe(5);
    expect(first.server).toHaveBeenCalledTimes(1);
    expect(first.cleanup).not.toHaveBeenCalled();
  });

  it('очистка — функция или объект с dispose: вызывается при замене и при dispose рантайма', async () => {
    const fn = vi.fn();
    const dispose = vi.fn();
    const objectCleanup = { dispose };
    const host = open({
      'acme.fn': versioned('fn', { id: 'acme.fn', cleanup: fn }).module,
      'acme.obj': versioned('obj', { id: 'acme.obj', cleanup: objectCleanup })
        .module,
    });
    const fnCandidate = candidateOf('acme.fn', { revision: 'r1' });
    const objCandidate = candidateOf('acme.obj', { revision: 'r1' });
    await host.replace([fnCandidate, objCandidate]);
    expect(fn).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();

    // замена кода: прежняя очистка вызвана; новая запись ещё жива
    await host.replace([{ ...fnCandidate, revision: 'r2' }, objCandidate]);
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(dispose).not.toHaveBeenCalled();

    await host.dispose();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('сбой очистки пишется в журнал и не мешает остальным', async () => {
    const good = vi.fn();
    const host = open({
      'acme.bad': versioned('bad', {
        id: 'acme.bad',
        cleanup: () => {
          throw new Error('cleanup exploded');
        },
      }).module,
      'acme.good': versioned('good', { id: 'acme.good', cleanup: good }).module,
    });
    await host.replace([
      candidateOf('acme.bad', { revision: 'r1' }),
      candidateOf('acme.good', { revision: 'r1' }),
    ]);
    await host.replace([]);
    await host.dispose();
    expect(good).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'acme.bad',
        error: 'cleanup exploded',
      }),
      expect.any(String),
    );
  });

  it('параллельные replace выполняются по очереди: последний набор побеждает', async () => {
    const old = versioned('v1');
    const host = open({ [ID]: old.module });
    const first = host.replace([echo()]);
    const second = host.replace([]);
    await Promise.all([first, second]);
    expect(resultOf(await host.handle(project()))).toMatchObject({
      cause: 'unknown-type',
    });
  });

  it('dispose дожидается начатого вытеснения', async () => {
    const old = versioned('v1');
    const host = open({ [ID]: old.module });
    await host.replace([echo()]);
    void host.replace([]);
    await host.dispose();
    expect(old.cleanup).toHaveBeenCalledTimes(1);
  });

  describe('вызовы в полёте', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('идущий grade доходит до результата старой версии, очистка — только после него; новый вызов идёт в новую', async () => {
      const modules: Record<string, ServerModule> = {};
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const old = versioned('v1', { gate });
      const next = versioned('v2');
      modules[ID] = old.module;
      const host = open(modules);
      await host.replace([echo()]);
      const inFlight = host.handle(grade());
      await vi.advanceTimersByTimeAsync(0);

      modules[ID] = next.module;
      await host.replace([echo({ revision: 'r2' })]);
      expect(resultOf(await host.handle(project('2')))).toBe('v2');
      await vi.advanceTimersByTimeAsync(10);
      expect(old.cleanup).not.toHaveBeenCalled();

      release();
      expect(resultOf(await inFlight)).toMatchObject({
        outcome: 'passed',
        feedback: 'v1',
      });
      await vi.waitFor(() => expect(old.cleanup).toHaveBeenCalledTimes(1));
      expect(next.cleanup).not.toHaveBeenCalled();
    });

    it('вызов, не завершившийся за срок и запас, не держит вытеснение', async () => {
      const never = new Promise<void>(() => {});
      const old = versioned('v1', { gate: never });
      const host = open({ [ID]: old.module }, { drainGraceMs: 50 });
      await host.replace([echo()]);
      void host.handle(grade('1', 100));
      await vi.advanceTimersByTimeAsync(0);
      await host.replace([]);
      await vi.advanceTimersByTimeAsync(149);
      expect(old.cleanup).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(old.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ExtensionRuntime.replace: настоящие файлы', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dolphy-replace-'));
    await cp(join(fixtures, ID), join(root, ID), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const discover = async (
    origin: ExtensionOrigin = 'dev',
  ): Promise<ExtensionCandidate[]> =>
    (
      await discoverExtensions({
        roots: [{ dir: root, origin }],
        logger: createLogger(),
      })
    ).extensions;

  const source = (label: string) =>
    `export const server = (s) => { s.registerExerciseType({ id: '${ID}', specSchema: { type: 'object' }, answerSchema: { type: 'string' }, project: () => '${label}', grade: () => ({ outcome: 'passed' }) }); };\n`;

  it('правка main.mjs без смены версии подхватывается: загрузчик ESM не отдаёт старый модуль', async () => {
    const main = join(root, ID, 'main.mjs');
    await writeFile(main, source('first'));
    const host = createExtensionRuntime({
      library: nullLibrary,
      logger: createLogger(),
    });
    runtime = host;
    await host.replace(await discover());
    expect(resultOf(await host.handle(project()))).toBe('first');

    await writeFile(main, source('second, longer'));
    await host.replace(await discover());
    expect(resultOf(await host.handle(project('2')))).toBe('second, longer');
  });
});
