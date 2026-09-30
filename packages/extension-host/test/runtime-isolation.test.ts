import { fileURLToPath } from 'node:url';
import type { ExtensionModule } from '@spirula-app/extension-api';
import { describe, expect, it, vi } from 'vitest';
import { discoverExtensions } from '../src/discover.ts';
import type { ExtensionOrigin } from '../src/discover.ts';
import type { ExtRequest, ExtResponse } from '../src/protocol.ts';
import { createExtensionRuntime } from '../src/runtime.ts';
import type { RestrictedRunner } from '../src/restricted-runner.ts';
import { createLogger, nullLibrary } from './helpers.ts';

const fixtures = fileURLToPath(
  new URL('./fixtures/extensions', import.meta.url),
);

const request = (isolated: boolean, id = '1'): ExtRequest => ({
  id,
  method: 'project',
  params: { type: 'acme.echo', exerciseId: 'e', spec: {}, isolated },
});

const setup = async (
  origin: ExtensionOrigin,
  options: { withRunners?: boolean; enforceIsolation?: boolean } = {},
) => {
  const { extensions } = await discoverExtensions({
    roots: [{ dir: fixtures, origin }],
    logger: createLogger(),
  });
  const deactivate = vi.fn();
  const activate = vi.fn((ctx: Parameters<ExtensionModule['activate']>[0]) => {
    ctx.registerExerciseType('acme.echo', {
      project: () => 'in-process',
      grade: () => ({ outcome: 'passed' }),
    });
  });
  const runnerDispose = vi.fn(async () => {});
  const runnerHandle = vi.fn(
    async (incoming: ExtRequest): Promise<ExtResponse> => ({
      id: incoming.id,
      ok: true,
      result: 'restricted',
    }),
  );
  const runner: RestrictedRunner = {
    handle: runnerHandle,
    dispose: runnerDispose,
  };
  const create = vi.fn(() => runner);
  const runtime = createExtensionRuntime({
    extensions,
    library: nullLibrary,
    logger: createLogger(),
    modules: { 'acme.echo': { activate, deactivate } },
    ...(options.withRunners !== false && { runners: { create } }),
    ...(options.enforceIsolation !== undefined && {
      enforceIsolation: options.enforceIsolation,
    }),
  });
  return { runtime, activate, deactivate, create, runnerDispose, runnerHandle };
};

const resultOf = (response: ExtResponse): unknown =>
  response.ok ? response.result : response.error;

describe('маршрутизация по isolated', () => {
  it('изолированный запрос к расширению не из поставки идёт в ограниченный раннер, код в хосте не активируется', async () => {
    const { runtime, activate, create, runnerHandle } = await setup('user');
    expect(resultOf(await runtime.handle(request(true)))).toBe('restricted');
    expect(resultOf(await runtime.handle(request(true, '2')))).toBe(
      'restricted',
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(runnerHandle).toHaveBeenCalledTimes(2);
    expect(activate).not.toHaveBeenCalled();
  });

  it('доверенное расширение (isolated: false) исполняется в хосте', async () => {
    const { runtime, activate, create } = await setup('user');
    expect(resultOf(await runtime.handle(request(false)))).toBe('in-process');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('расширение из поставки всегда исполняется в хосте, даже с isolated: true', async () => {
    const { runtime, create } = await setup('bundled');
    expect(resultOf(await runtime.handle(request(true)))).toBe('in-process');
    expect(create).not.toHaveBeenCalled();
  });

  it('расширение из разработки изолируется так же, как пользовательское', async () => {
    const { runtime } = await setup('dev');
    expect(resultOf(await runtime.handle(request(true)))).toBe('restricted');
  });

  it('без фабрики раннеров изолированный запрос отклоняется, код не исполняется', async () => {
    const { runtime, activate } = await setup('user', { withRunners: false });
    expect(resultOf(await runtime.handle(request(true)))).toEqual({
      cause: 'activation-failed',
      message: 'isolated execution is not configured',
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it('enforceIsolation: false — процесс сам ограничение, запрос исполняется на месте', async () => {
    const { runtime, create } = await setup('user', {
      enforceIsolation: false,
    });
    expect(resultOf(await runtime.handle(request(true)))).toBe('in-process');
    expect(create).not.toHaveBeenCalled();
  });

  it('смена режима освобождает активацию другого режима без перезапуска', async () => {
    const { runtime, activate, deactivate, create, runnerDispose } =
      await setup('user');
    await runtime.handle(request(false));
    expect(activate).toHaveBeenCalledTimes(1);

    await runtime.handle(request(true));
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);

    expect(resultOf(await runtime.handle(request(false)))).toBe('in-process');
    expect(runnerDispose).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('dispose освобождает раннеры и активации', async () => {
    const { runtime, deactivate, runnerDispose } = await setup('user');
    await runtime.handle(request(true));
    await runtime.dispose();
    expect(runnerDispose).toHaveBeenCalledTimes(1);
    await runtime.handle(request(false));
    await runtime.dispose();
    expect(deactivate).toHaveBeenCalledTimes(1);
  });
});
