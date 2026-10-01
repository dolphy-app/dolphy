import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionModule } from '@dolphy-app/extension-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionOrigin, ResolvedExtension } from '../src/discover.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import type {
  RestrictedRunner,
  RunnerFactory,
} from '../src/restricted-runner.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import { createLogger, nullLibrary } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const discover = async (
  dir = fixtures,
  origin: ExtensionOrigin = 'user',
): Promise<ResolvedExtension[]> =>
  (
    await discoverExtensions({
      roots: [{ dir, origin }],
      logger: createLogger(),
    })
  ).extensions;

const project = (id = '1', isolated = false): ExtRequest => ({
  id,
  method: 'project',
  params: { type: 'acme.echo', exerciseId: 'e', spec: {}, isolated },
});

const grade = (id = '1', timeoutMs = 1000): ExtRequest => ({
  id,
  method: 'grade',
  params: {
    type: 'acme.echo',
    exerciseId: 'e',
    spec: {},
    answer: 1,
    timeoutMs,
    authorMode: false,
    isolated: false,
  },
});

const resultOf = (response: ExtResponse): unknown =>
  response.ok ? response.result : response.error;

/** Модуль расширения, отвечающий своим именем; `grade` ждёт, пока тест его не отпустит. */
const versioned = (label: string, gate?: Promise<void>) => {
  const deactivate = vi.fn();
  const module: ExtensionModule = {
    activate(ctx) {
      ctx.registerExerciseType('acme.echo', {
        project: () => label,
        grade: async () => {
          await gate;
          return { outcome: 'passed', feedback: label };
        },
      });
    },
    deactivate,
  };
  return { module, deactivate };
};

const open = async (
  modules: Record<string, ExtensionModule>,
  extra: { drainGraceMs?: number; runners?: RunnerFactory } = {},
) => {
  const all = await discover();
  const echo = all.find(({ id }) => id === 'acme.echo') as ResolvedExtension;
  const runtime = createExtensionRuntime({
    extensions: [echo],
    library: nullLibrary,
    logger: createLogger(),
    modules,
    ...(extra.drainGraceMs !== undefined && {
      drainGraceMs: extra.drainGraceMs,
    }),
    ...(extra.runners !== undefined && { runners: extra.runners }),
  });
  return { runtime, echo, all };
};

describe('ExtensionRuntime.replace', () => {
  it('тот же набор ничего не перезагружает', async () => {
    const first = versioned('v1');
    const activate = vi.spyOn(first.module, 'activate');
    const { runtime } = await open({ 'acme.echo': first.module });
    await runtime.handle(project());
    await runtime.replace(await discover());
    expect(resultOf(await runtime.handle(project('2')))).toBe('v1');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(first.deactivate).not.toHaveBeenCalled();
  });

  it('новая версия: следующие вызовы идут в неё, прежняя активация получает deactivate()', async () => {
    const modules: Record<string, ExtensionModule> = {};
    const old = versioned('v1');
    const next = versioned('v2');
    modules['acme.echo'] = old.module;
    const { runtime, echo } = await open(modules);
    expect(resultOf(await runtime.handle(project()))).toBe('v1');

    modules['acme.echo'] = next.module;
    await runtime.replace([{ ...echo, version: '2.0.0' }]);
    expect(old.deactivate).toHaveBeenCalledTimes(1);
    expect(resultOf(await runtime.handle(project('2')))).toBe('v2');
    expect(next.deactivate).not.toHaveBeenCalled();
  });

  it('тот же номер версии, другие файлы (revision) — тоже перезагрузка', async () => {
    const modules: Record<string, ExtensionModule> = {};
    const old = versioned('v1');
    modules['acme.echo'] = old.module;
    const { runtime, echo } = await open(modules);
    await runtime.handle(project());
    modules['acme.echo'] = versioned('v1-edited').module;
    await runtime.replace([{ ...echo, revision: 'edited' }]);
    expect(old.deactivate).toHaveBeenCalledTimes(1);
    expect(resultOf(await runtime.handle(project('2')))).toBe('v1-edited');
  });

  it('удалённое расширение перестаёт отвечать и освобождается; вызов к нему — unknown-type', async () => {
    const old = versioned('v1');
    const { runtime } = await open({ 'acme.echo': old.module });
    await runtime.handle(project());
    await runtime.replace([]);
    expect(old.deactivate).toHaveBeenCalledTimes(1);
    expect(resultOf(await runtime.handle(project('2')))).toMatchObject({
      cause: 'unknown-type',
    });
  });

  it('добавленное расширение сразу доступно, остальные не затронуты', async () => {
    const old = versioned('v1');
    const { runtime, echo, all } = await open({ 'acme.echo': old.module });
    const policy = all.find(
      ({ id }) => id === 'acme.policy',
    ) as ResolvedExtension;
    await runtime.handle(project());
    const promised = runtime.replace([echo, policy]);
    // каталог заменён синхронно: ответ на replace ждать не нужно
    const response = await runtime.handle({
      id: '2',
      method: 'gradePolicy',
      params: {
        policyId: 'acme.policy.generous',
        verdicts: [],
        gaveUp: false,
        isolated: false,
      },
    });
    expect(resultOf(response)).not.toMatchObject({ cause: 'unknown-policy' });
    await promised;
    expect(old.deactivate).not.toHaveBeenCalled();
  });

  describe('вызовы в полёте', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('идущий grade доходит до результата старой версии, deactivate — только после него; новый вызов идёт в новую', async () => {
      const modules: Record<string, ExtensionModule> = {};
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const old = versioned('v1', gate);
      const next = versioned('v2');
      modules['acme.echo'] = old.module;
      const { runtime, echo } = await open(modules);
      const inFlight = runtime.handle(grade());
      await vi.advanceTimersByTimeAsync(0);

      modules['acme.echo'] = next.module;
      let evicted = false;
      const replaced = runtime
        .replace([{ ...echo, version: '2.0.0' }])
        .then(() => {
          evicted = true;
        });
      expect(resultOf(await runtime.handle(project('2')))).toBe('v2');
      await vi.advanceTimersByTimeAsync(10);
      expect(evicted).toBe(false);
      expect(old.deactivate).not.toHaveBeenCalled();

      release();
      expect(resultOf(await inFlight)).toMatchObject({
        outcome: 'passed',
        feedback: 'v1',
      });
      await replaced;
      expect(old.deactivate).toHaveBeenCalledTimes(1);
      expect(next.deactivate).not.toHaveBeenCalled();
    });

    it('вызов, не завершившийся за срок и запас, не держит вытеснение', async () => {
      const never = new Promise<void>(() => {});
      const old = versioned('v1', never);
      const { runtime } = await open(
        { 'acme.echo': old.module },
        { drainGraceMs: 50 },
      );
      void runtime.handle(grade('1', 100));
      await vi.advanceTimersByTimeAsync(0);
      const replaced = runtime.replace([]);
      await vi.advanceTimersByTimeAsync(149);
      expect(old.deactivate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await replaced;
      expect(old.deactivate).toHaveBeenCalledTimes(1);
    });
  });

  it('ограниченный процесс изменившегося расширения закрывается, следующий изолированный вызов получает свежий', async () => {
    const runnerOf = () => {
      const dispose = vi.fn(async () => {});
      const runner: RestrictedRunner = {
        handle: async (incoming) => ({
          id: incoming.id,
          ok: true,
          result: 'restricted',
        }),
        dispose,
      };
      return { runner, dispose };
    };
    const first = runnerOf();
    const second = runnerOf();
    const create = vi
      .fn<(extension: ResolvedExtension) => RestrictedRunner>()
      .mockReturnValueOnce(first.runner)
      .mockReturnValueOnce(second.runner);
    const { runtime, echo } = await open(
      { 'acme.echo': versioned('v1').module },
      { runners: { create } },
    );
    await runtime.handle(project('1', true));
    expect(create).toHaveBeenCalledTimes(1);

    const updated = { ...echo, version: '2.0.0' };
    await runtime.replace([updated]);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    await runtime.handle(project('2', true));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(updated);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('dispose дожидается начатого вытеснения', async () => {
    const old = versioned('v1');
    const { runtime } = await open({ 'acme.echo': old.module });
    await runtime.handle(project());
    void runtime.replace([]);
    await runtime.dispose();
    expect(old.deactivate).toHaveBeenCalledTimes(1);
  });
});

describe('ExtensionRuntime.replace: настоящие файлы', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dolphy-replace-'));
    await cp(join(fixtures, 'acme.echo'), join(root, 'acme.echo'), {
      recursive: true,
    });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const source = (label: string) =>
    `export default { activate(ctx) { ctx.registerExerciseType('acme.echo', { project: () => '${label}', grade: () => ({ outcome: 'passed' }) }); } };\n`;

  it('правка main.mjs без смены версии подхватывается: загрузчик ESM не отдаёт старый модуль', async () => {
    const main = join(root, 'acme.echo', 'main.mjs');
    await writeFile(main, source('first'));
    const runtime = createExtensionRuntime({
      extensions: await discover(root, 'dev'),
      library: nullLibrary,
      logger: createLogger(),
    });
    expect(resultOf(await runtime.handle(project()))).toBe('first');

    await writeFile(main, source('second, longer'));
    await runtime.replace(await discover(root, 'dev'));
    expect(resultOf(await runtime.handle(project('2')))).toBe('second, longer');
    await runtime.dispose();
  });
});
