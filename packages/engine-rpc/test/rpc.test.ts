import { CONTRACT_VERSION, RPC_METHODS } from '@lms/engine-contract';
import type { EngineEvent } from '@lms/engine-contract';
import { createCapturingLogger, silentLogger } from '@lms/testkit';
import { describe, expect, it } from 'vitest';
import { EngineCallError, createEngineClient } from '../src/client/index.ts';
import { createDispatcher, schemas } from '../src/host/index.ts';
import { createInProcessPair } from '../src/in-process.ts';
import {
  createFakeEngine,
  createRawClient,
  deferred,
  tick,
  type Method,
} from './helpers.ts';

const connect = async (
  overrides: Record<string, Method> = {},
  options: { verifyCloneable?: boolean } = {},
) => {
  const fake = createFakeEngine(overrides);
  const { logger, records } = createCapturingLogger();
  const dispatcher = createDispatcher({
    engine: fake.engine,
    schemas,
    logger,
    ...options,
  });
  const [hostSide, clientSide] = createInProcessPair();
  dispatcher.attach(hostSide, 'test');
  const client = createEngineClient();
  await client.attach(clientSide);
  return { fake, dispatcher, client, records, hostSide, clientSide };
};

describe('rpc contract', () => {
  it('recordAttempt через RPC идемпотентен', async () => {
    const seen = new Map<string, { eventId: string }>();
    const { client } = await connect({
      'practice.recordAttempt': (async (request: { requestId: string }) => {
        const previous = seen.get(request.requestId);
        if (previous) return { ...previous, duplicate: true };
        const stored = { eventId: `event-${seen.size + 1}` };
        seen.set(request.requestId, stored);
        return { ...stored, duplicate: false };
      }) as Method,
    });
    const request = {
      requestId: 'r1',
      exerciseId: 'c::l::e',
      grade: 5,
    } as const;
    const first = await client.engine.practice.recordAttempt(request);
    const second = await client.engine.practice.recordAttempt(request);
    expect(first).toMatchObject({ duplicate: false });
    expect(second).toMatchObject({ eventId: first.eventId, duplicate: true });
  });

  it('the client facade mirrors RPC_METHODS: nested paths, positional args', async () => {
    const { client, fake } = await connect();
    const result = await client.engine.library.listLessons('c', { limit: 5 });
    expect(result).toEqual({
      method: 'library.listLessons',
      args: ['c', { limit: 5 }],
    });
    await client.engine.sync.folder.sync();
    await client.engine.curation.blacklist.add('c::l');
    expect(fake.calls).toEqual([
      'diagnostics', // engine.hello
      'library.listLessons',
      'sync.folder.sync',
      'curation.blacklist.add',
    ]);
  });

  it('optional trailing arguments may be omitted or undefined', async () => {
    const { client } = await connect();
    await expect(client.engine.practice.getBatch()).resolves.toMatchObject({
      args: [],
    });
    await expect(
      client.engine.practice.getBatch(undefined),
    ).resolves.toMatchObject({ args: [] });
    await expect(
      client.engine.library.listCourses({ cursor: undefined } as never),
    ).resolves.toMatchObject({ args: [{}] });
  });

  it('schemas cover exactly the RPC_METHODS keys', () => {
    expect(Object.keys(schemas).sort()).toEqual(
      Object.keys(RPC_METHODS).sort(),
    );
  });
});

describe('dispatcher validation', () => {
  it('an unknown method is INVALID_ARGUMENT', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw');
    const raw = createRawClient(rawSide);
    for (const method of ['nope.method', '__proto__', 'constructor']) {
      const response = await raw.call(method, []);
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT', retryable: false },
      });
    }
  });

  it('invalid arguments give INVALID_ARGUMENT with issues', async () => {
    const { client, fake } = await connect();
    const error: unknown = await client.engine.practice
      .recordAttempt({ requestId: 'r', exerciseId: 'e', grade: 9 } as never)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EngineCallError);
    expect(error).toMatchObject({
      code: 'INVALID_ARGUMENT',
      retryable: false,
    });
    const details = (error as EngineCallError).details;
    expect(details?.['method']).toBe('practice.recordAttempt');
    const issues = details?.['issues'] as Array<{ path: unknown[] }>;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.path.includes(0))).toBe(true);
    expect(fake.calls).not.toContain('practice.recordAttempt');
  });

  it('rejects unknown keys, extra arguments and non-array params', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw');
    const raw = createRawClient(rawSide);
    const rejected = [
      await raw.call('practice.getBatch', [{ typo: 1 }]),
      await raw.call('practice.getBatch', [{}, 1]),
      await raw.call('library.getInfo', { a: 1 }),
      await raw.call('practice.beginAttempt', []),
    ];
    for (const response of rejected) {
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
    expect(await raw.call('practice.getBatch', [])).toMatchObject({ ok: true });
    expect(await raw.call('practice.getBatch')).toMatchObject({ ok: true });
  });

  it('a contract version mismatch is INCOMPATIBLE_CONTRACT from engine.hello', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw');
    const raw = createRawClient(rawSide);
    expect(
      await raw.call('engine.hello', [
        { contractVersion: CONTRACT_VERSION + 1 },
      ]),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'INCOMPATIBLE_CONTRACT',
        retryable: false,
        details: { host: CONTRACT_VERSION, client: CONTRACT_VERSION + 1 },
      },
    });
    expect(
      await raw.call('engine.hello', [{ contractVersion: CONTRACT_VERSION }]),
    ).toEqual({
      id: expect.any(String) as string,
      ok: true,
      result: { contractVersion: CONTRACT_VERSION, engineVersion: 'fake-1' },
    });
  });

  it('a host with a schema missing for a method fails fast', () => {
    const fake = createFakeEngine();
    const incomplete = Object.fromEntries(
      Object.entries(schemas).filter(([name]) => name !== 'library.getInfo'),
    );
    expect(() =>
      createDispatcher({
        engine: fake.engine,
        schemas: incomplete as never,
        logger: silentLogger,
      }),
    ).toThrow(/library\.getInfo/);
  });

  it('an unexpected engine exception becomes INTERNAL and is logged', async () => {
    const { client, records } = await connect({
      'library.getInfo': (async () => {
        throw new Error('leak me not');
      }) as Method,
    });
    const error: unknown = await client.engine.library
      .getInfo()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'INTERNAL' });
    expect((error as Error).message).not.toContain('leak');
    expect(records.some((record) => record.level === 'error')).toBe(true);
  });

  it('an engine EngineError keeps code and details across the wire', async () => {
    const { EngineError } = await import('@lms/engine/app');
    const { client } = await connect({
      'practice.getUnitScore': (async () => {
        throw new EngineError('NOT_FOUND', { details: { unitId: 'x' } });
      }) as Method,
    });
    await expect(
      client.engine.practice.getUnitScore('x'),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      retryable: false,
      details: { unitId: 'x' },
    });
  });
});

describe('ordering and events', () => {
  it('responses may arrive out of order; they are matched by id', async () => {
    const gate = deferred<string>();
    const { client } = await connect({
      'practice.submitAnswer': (async () => gate.promise) as Method,
    });
    const order: string[] = [];
    const slow = client.engine.practice
      .submitAnswer({
        attemptId: 'a',
        answer: 'select 1',
      })
      .then((value) => {
        order.push('submit');
        return value;
      });
    const fast = client.engine.practice.getUnitScore('u').then((value) => {
      order.push('score');
      return value;
    });
    await fast;
    expect(order).toEqual(['score']);
    gate.resolve('verdict');
    await expect(slow).resolves.toBe('verdict');
    expect(order).toEqual(['score', 'submit']);
  });

  it('events.subscribe pushes events; unsubscribe stops them', async () => {
    const { client, fake } = await connect();
    const seen: EngineEvent[] = [];
    const off = client.engine.subscribe((event) => seen.push(event));
    await tick();
    expect(fake.listenerCount()).toBe(1);
    const event: EngineEvent = { type: 'progress', unitIds: ['u'], at: 1 };
    fake.emit(event);
    await tick();
    expect(seen).toEqual([event]);
    off();
    await tick();
    expect(fake.listenerCount()).toBe(0);
    fake.emit(event);
    await tick();
    expect(seen).toHaveLength(1);
  });

  it('several local listeners share one remote subscription', async () => {
    const { client, fake } = await connect();
    const a: EngineEvent[] = [];
    const b: EngineEvent[] = [];
    const offA = client.engine.subscribe((event) => a.push(event));
    const offB = client.engine.subscribe((event) => b.push(event));
    await tick();
    expect(fake.listenerCount()).toBe(1);
    fake.emit({ type: 'state-rebuilt', entries: 1, ms: 1 });
    await tick();
    expect([a.length, b.length]).toEqual([1, 1]);
    offA();
    await tick();
    expect(fake.listenerCount()).toBe(1);
    offB();
    await tick();
    expect(fake.listenerCount()).toBe(0);
  });

  it('closing the port removes the engine listener: no leak', async () => {
    const { client, fake, hostSide } = await connect();
    client.engine.subscribe(() => undefined);
    await tick();
    expect(fake.listenerCount()).toBe(1);
    hostSide.close();
    expect(fake.listenerCount()).toBe(0);
  });

  it('re-attaching with the same clientId replaces the old connection', async () => {
    const { dispatcher, fake } = await connect();
    const [hostA, clientA] = createInProcessPair();
    const [hostB, clientB] = createInProcessPair();
    dispatcher.attach(hostA, 'window-1');
    const a = createEngineClient();
    await a.attach(clientA);
    a.engine.subscribe(() => undefined);
    await tick();
    dispatcher.attach(hostB, 'window-1');
    const b = createEngineClient();
    await b.attach(clientB);
    await tick();
    expect(fake.listenerCount()).toBe(0); // подписка старого окна снята
  });
});
