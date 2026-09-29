import type {
  EngineDiagnosticsDto,
  EngineEvent,
  LearningEngine,
} from '@lms/engine-contract';
import { createCapturingLogger } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import {
  EngineError,
  UNQUEUED,
  createEventBus,
  createFacade,
  wrapTree,
  type EngineServices,
  type FacadeContext,
} from '../../src/app/index.ts';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const DIAGNOSTICS = {
  engineVersion: 'test',
  dirty: false,
} as EngineDiagnosticsDto;

const createHarness = () => {
  const { logger, records } = createCapturingLogger();
  const bus = createEventBus(logger);
  const state = { dirty: false, closed: false };
  const calls: string[] = [];
  const closed: string[] = [];
  const ctx: FacadeContext = {
    logger,
    bus,
    state,
    verifiers: new Map([
      ['sql', { close: async () => void closed.push('verifier') }],
    ]),
    eventStore: { close: async () => void closed.push('store') },
    rebuild: async () => {
      calls.push('rebuild');
      state.dirty = false;
    },
    markDirty: () => {
      state.dirty = true;
    },
  };
  return { ctx, bus, state, calls, closed, records };
};

/** Реестр через `ctx`, как в реальных сервисах: внутренние вызовы мимо фасада. */
const createServices = (
  h: ReturnType<typeof createHarness>,
  partial: {
    onGetBatch?: () => Promise<unknown>;
    onSubmit?: () => Promise<unknown>;
  } = {},
): EngineServices => {
  const internalGetDue = async () => {
    h.calls.push('getDue');
    return { items: [] };
  };
  const practice = {
    getDue: async () => internalGetDue(),
    getBatch: async () => {
      h.calls.push('getBatch:start');
      h.bus.emit({ type: 'progress', unitIds: ['u'], at: 1 });
      await internalGetDue(); // сервис зовёт внутренний объект, не фасад
      if (partial.onGetBatch) await partial.onGetBatch();
      h.calls.push('getBatch:end');
      return { ok: true };
    },
    recordAttempt: async () => {
      h.calls.push('record');
      return 1;
    },
    submitAnswer: async () => {
      h.calls.push('submit:start');
      if (partial.onSubmit) await partial.onSubmit();
      h.calls.push('submit:end');
      return 'verdict';
    },
    notFound: async () => {
      throw new EngineError('NOT_FOUND', { details: { id: 'x' } });
    },
    bug: async () => {
      h.bus.emit({ type: 'progress', unitIds: ['lost'], at: 2 });
      throw new TypeError('bug');
    },
  };
  return {
    practice,
    library: { getInfo: async () => 'info' },
    sync: { folder: { sync: async () => 'synced' } },
  } as unknown as EngineServices;
};

const create = (
  h: ReturnType<typeof createHarness>,
  services: EngineServices = createServices(h),
) => createFacade(h.ctx, services, async () => DIAGNOSTICS);

type Practice = Record<string, () => Promise<unknown>>;
const practiceOf = (engine: LearningEngine) =>
  engine.practice as unknown as Practice;

describe('wrapTree', () => {
  it('wraps every method at any depth and keeps the tree shape', () => {
    const names: string[] = [];
    const tree = { a: { b: { c: async () => 1 } }, d: async () => 2 };
    const wrapped = wrapTree(tree, '', (name, method) => {
      names.push(name);
      return method;
    });
    expect(names).toEqual(['a.b.c', 'd']);
    expect(Object.keys(wrapped.a.b)).toEqual(['c']);
  });
});

describe('createFacade', () => {
  it('queues commands: the second waits for the first', async () => {
    const h = createHarness();
    const gate = deferred();
    const engine = create(
      h,
      createServices(h, { onGetBatch: () => gate.promise }),
    );
    const first = practiceOf(engine)['getBatch']!();
    const second = practiceOf(engine)['recordAttempt']!();
    await sleep(5);
    expect(h.calls).toEqual(['getBatch:start', 'getDue']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(h.calls).toEqual([
      'getBatch:start',
      'getDue',
      'getBatch:end',
      'record',
    ]);
  });

  it('a service that calls a sibling internally does not wait for itself', async () => {
    const h = createHarness();
    const engine = create(h);
    // getBatch вызывает getDue внутри: через фасад это была бы взаимоблокировка
    await expect(
      Promise.race([
        practiceOf(engine)['getBatch']!(),
        sleep(1_000).then(() => {
          throw new Error('deadlock');
        }),
      ]),
    ).resolves.toEqual({ ok: true });
  });

  it('submitAnswer runs outside the queue and does not block other commands', async () => {
    expect(UNQUEUED.has('practice.submitAnswer')).toBe(true);
    const h = createHarness();
    const gate = deferred();
    const engine = create(
      h,
      createServices(h, { onSubmit: () => gate.promise }),
    );
    const submit = practiceOf(engine)['submitAnswer']!();
    await expect(practiceOf(engine)['recordAttempt']!()).resolves.toBe(1);
    expect(h.calls).toEqual(['submit:start', 'record']);
    gate.resolve();
    await expect(submit).resolves.toBe('verdict');
  });

  it('flushes events after a successful command and discards them on failure', async () => {
    const h = createHarness();
    const engine = create(h);
    const seen: EngineEvent[] = [];
    engine.subscribe((event) => seen.push(event));
    await practiceOf(engine)['getBatch']!();
    expect(seen).toHaveLength(1);
    await expect(practiceOf(engine)['bug']!()).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    expect(seen).toHaveLength(1); // 'lost' не доставлено
    await practiceOf(engine)['recordAttempt']!();
    expect(seen).toHaveLength(1);
  });

  it('operational errors pass through; programming errors become INTERNAL and mark dirty', async () => {
    const h = createHarness();
    const engine = create(h);
    await expect(practiceOf(engine)['notFound']!()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { id: 'x' },
    });
    expect(h.state.dirty).toBe(false);
    const error: unknown = await practiceOf(engine)['bug']!().catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({
      code: 'INTERNAL',
      retryable: true,
      details: { path: 'practice.bug' },
    });
    expect(h.state.dirty).toBe(true);
    expect(h.records.some((r) => r.level === 'error')).toBe(true);
  });

  it('rebuilds projections before the next command when dirty', async () => {
    const h = createHarness();
    const engine = create(h);
    await practiceOf(engine)['bug']!().catch(() => null);
    await practiceOf(engine)['recordAttempt']!();
    expect(h.calls).toEqual(['rebuild', 'record']);
    expect(h.state.dirty).toBe(false);
  });

  it('nested services and diagnostics are wrapped and callable', async () => {
    const h = createHarness();
    const engine = create(h);
    await expect(engine.sync.folder.sync()).resolves.toBe('synced');
    await expect(engine.library.getInfo()).resolves.toBe('info');
    await expect(engine.diagnostics()).resolves.toBe(DIAGNOSTICS);
  });

  it('close drains the running command, closes verifiers and the store, then rejects new calls', async () => {
    const h = createHarness();
    const gate = deferred();
    const engine = create(
      h,
      createServices(h, { onGetBatch: () => gate.promise }),
    );
    const running = practiceOf(engine)['getBatch']!();
    const closing = engine.close();
    await expect(practiceOf(engine)['recordAttempt']!()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    await sleep(5);
    expect(h.closed).toEqual([]); // ждём текущую команду
    gate.resolve();
    await running;
    await closing;
    expect(h.closed).toEqual(['verifier', 'store']);
    await engine.close();
    expect(h.closed).toEqual(['verifier', 'store']); // повторный close — no-op
  });
});
