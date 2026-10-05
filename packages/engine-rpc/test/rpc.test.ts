import { CONTRACT_VERSION, RPC_METHODS } from '@dolphy-app/engine-contract';
import type { EngineEvent } from '@dolphy-app/engine-contract';
import { EngineError } from '@dolphy-app/engine/app';
import { createCapturingLogger, silentLogger } from '@dolphy-app/testkit';
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

  it('settings.setUi accepts a theme id of an extension and rejects malformed ids', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-theme');
    const raw = createRawClient(rawSide);
    const ok = await raw.call('settings.setUi', [{ theme: 'acme.midnight' }]);
    expect(ok).toMatchObject({ ok: true });
    for (const theme of ['Sepia', 'a..b', `a${'b'.repeat(70)}`, 5]) {
      expect(await raw.call('settings.setUi', [{ theme }])).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
  });

  it('settings.setUi validates the material panel width and collapse', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-material');
    const raw = createRawClient(rawSide);
    for (const patch of [
      { materialWidth: 280 },
      { materialWidth: 800 },
      { materialWidth: null },
      { materialCollapsed: true },
      { materialCollapsed: false },
    ]) {
      expect(await raw.call('settings.setUi', [patch])).toMatchObject({
        ok: true,
      });
    }
    for (const patch of [
      { materialWidth: 279 },
      { materialWidth: 801 },
      { materialWidth: 400.5 },
      { materialWidth: '400' },
      { materialCollapsed: 'yes' },
    ]) {
      expect(await raw.call('settings.setUi', [patch])).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
  });

  it('settings.setLearning accepts passAtN and extension policy ids, rejects malformed ones', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-learning');
    const raw = createRawClient(rawSide);
    for (const gradePolicy of ['passAtN', 'acme.policy.generous', 'acme']) {
      expect(
        await raw.call('settings.setLearning', [{ gradePolicy }]),
      ).toMatchObject({ ok: true });
    }
    for (const gradePolicy of ['Sepia', 'a..b', `a${'b'.repeat(70)}`, 5]) {
      expect(
        await raw.call('settings.setLearning', [{ gradePolicy }]),
      ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
  });

  it('settings.setKeybindings accepts sets and null, rejects malformed patches', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-keybindings');
    const raw = createRawClient(rawSide);
    const entry = { key: 'Alt+1', when: null };
    for (const patch of [
      {},
      { 'app:a': [entry], 'app:b': null, 'app:c': [] },
      { 'app:a': [{ key: 'Alt+1', when: '!inputFocus' }] },
    ]) {
      expect(await raw.call('settings.setKeybindings', [patch])).toMatchObject({
        ok: true,
      });
    }
    const tooMany = Object.fromEntries(
      Array.from({ length: 513 }, (_, i) => [`app:c${i}`, null]),
    );
    for (const patch of [
      null,
      { 'app:a': 'Alt+1' },
      { 'app:a': [{ key: 'Alt+1' }] },
      { 'app:a': [{ key: 5, when: null }] },
      { 'app:a': [{ key: 'Alt+1', when: null, extra: 1 }] },
      { 'app:a': [{ key: 'x'.repeat(65), when: null }] },
      { 'app:a': [{ key: 'Alt+1', when: 'k'.repeat(257) }] },
      { ['a'.repeat(201)]: null },
      tooMany,
    ]) {
      expect(await raw.call('settings.setKeybindings', [patch])).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
    expect(await raw.call('settings.getKeybindings', [1])).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });

  it('extensions.setEnabled / setTrusted / setNotificationsEnabled require an extension id and a boolean', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-extensions');
    const raw = createRawClient(rawSide);
    for (const method of [
      'extensions.setEnabled',
      'extensions.setTrusted',
      'extensions.setNotificationsEnabled',
    ]) {
      expect(await raw.call(method, ['acme.ext', true])).toMatchObject({
        ok: true,
      });
      for (const args of [
        ['Acme', true],
        ['', true],
        [`a${'b'.repeat(70)}`, true],
        ['acme.ext', 'yes'],
        ['acme.ext'],
      ]) {
        expect(await raw.call(method, args)).toMatchObject({
          ok: false,
          error: { code: 'INVALID_ARGUMENT' },
        });
      }
    }
  });

  it('extensions.invokeCommand validates ids and passes JSON arguments through to the engine', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-command');
    const raw = createRawClient(rawSide);
    // схема пропустила: вызов дошёл до движка (в этом тесте он заглушка)
    for (const args of [
      ['acme.ext', 'acme.ext.run'],
      ['acme.ext', 'acme.ext.run', { n: [1, null, 'x'] }],
      ['acme.ext', 'x'.repeat(128)],
    ]) {
      expect(await raw.call('extensions.invokeCommand', args)).toMatchObject({
        ok: true,
      });
    }
    // отвергнуто схемой до движка
    for (const args of [
      [],
      ['acme.ext'],
      ['Acme', 'acme.ext.run'],
      ['acme.ext', ''],
      ['acme.ext', 'x'.repeat(129)],
      ['acme.ext', 'acme.ext.run', [undefined]],
      ['acme.ext', 'acme.ext.run', {}, 'extra'],
    ]) {
      expect(await raw.call('extensions.invokeCommand', args)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
  });

  it('extensions catalog/install/uninstall/updates/setCheckUpdates/setCatalogUrl validate their arguments', async () => {
    const { dispatcher } = await connect();
    const [hostSide, rawSide] = createInProcessPair();
    dispatcher.attach(hostSide, 'raw-install');
    const raw = createRawClient(rawSide);
    const accepted: [string, unknown[]][] = [
      ['extensions.catalog', []],
      ['extensions.catalog', [{}]],
      ['extensions.catalog', [{ refresh: true }]],
      ['extensions.install', ['acme.ext']],
      ['extensions.install', ['acme.ext', '1.2.3']],
      ['extensions.install', ['acme.ext', '1.2.3-beta.1']],
      ['extensions.uninstall', ['acme.ext']],
      ['extensions.uninstall', ['acme.ext', {}]],
      ['extensions.uninstall', ['acme.ext', { removeData: true }]],
      ['extensions.updates', []],
      ['extensions.docs', ['acme.ext']],
      ['extensions.docs', ['acme.ext', {}]],
      ['extensions.docs', ['acme.ext', { version: '1.2.3' }]],
      ['extensions.docImage', ['acme.ext', '1.2.3', 'docs/a.png']],
      ['extensions.setCheckUpdates', [false]],
      ['extensions.setCatalogUrl', [null]],
      ['extensions.setCatalogUrl', ['https://example.test/index.json']],
      ['extensions.catalogSource', []],
      [
        'extensions.setSettingValue',
        ['acme.ext', 'acme.ext.n', { a: [1, null] }],
      ],
      ['practice.finishSession', [{ sessionId: 's' }]],
    ];
    const rejected: [string, unknown[]][] = [
      ['extensions.catalog', [{ refresh: 'yes' }]],
      ['extensions.catalog', [{ force: true }]],
      ['extensions.install', []],
      ['extensions.install', ['Acme']],
      ['extensions.install', ['acme.ext', 'latest']],
      ['extensions.install', ['acme.ext', '1.2']],
      ['extensions.install', ['acme.ext', '1.2.3', 'x']],
      ['extensions.uninstall', ['']],
      ['extensions.uninstall', []],
      ['extensions.uninstall', ['acme.ext', { removeData: 'yes' }]],
      ['extensions.uninstall', ['acme.ext', { keepData: true }]],
      ['extensions.setSettingValue', ['acme.ext', '', 1]],
      ['extensions.setSettingValue', ['acme.ext', 'acme.ext.n']],
      ['extensions.setSettingValue', ['acme.ext', 'acme.ext.n', [undefined]]],
      ['practice.finishSession', [{ sessionId: '' }]],
      ['practice.finishSession', [{}]],
      ['extensions.updates', ['x']],
      ['extensions.docs', []],
      ['extensions.docs', ['Acme']],
      ['extensions.docs', ['acme.ext', { version: 'latest' }]],
      ['extensions.docs', ['acme.ext', { tag: 'x' }]],
      ['extensions.docImage', ['acme.ext', '1.2.3']],
      ['extensions.docImage', ['acme.ext', 'latest', 'a.png']],
      ['extensions.docImage', ['acme.ext', '1.2.3', '']],
      ['extensions.docImage', ['acme.ext', '1.2.3', 'x'.repeat(201)]],
      ['extensions.setCheckUpdates', ['no']],
      ['extensions.setCheckUpdates', []],
      ['extensions.setCatalogUrl', []],
      ['extensions.setCatalogUrl', [42]],
      ['extensions.setCatalogUrl', [undefined]],
      ['extensions.setCatalogUrl', ['https://example.test/i.json', 'x']],
      ['extensions.catalogSource', ['x']],
    ];
    for (const [method, args] of accepted) {
      expect(await raw.call(method, args), method).toMatchObject({ ok: true });
    }
    for (const [method, args] of rejected) {
      expect(await raw.call(method, args), method).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
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
    const { EngineError } = await import('@dolphy-app/engine/app');
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

  describe('repositories', () => {
    it.each([
      ['add', [{ url: '' }]],
      ['add', [{ url: 'https://h/r.git', ref: '' }]],
      ['add', [{ url: 'https://h/r.git', extra: 1 }]],
      ['add', [{ url: `https://h/${'a'.repeat(2048)}` }]],
      ['add', [{ url: 'https://h/r.git', ref: 'r'.repeat(256) }]],
      ['update', ['']],
      ['remove', ['x'.repeat(201)]],
      ['cancel', [42]],
      ['list', ['extra']],
    ] as const)(
      '%s rejects bad params without reaching the engine',
      async (name, params) => {
        const { fake, hostSide, clientSide } = await connect();
        void hostSide;
        const raw = createRawClient(clientSide);
        const response = await raw.call(`repositories.${name}`, params);
        expect(response).toMatchObject({
          ok: false,
          error: { code: 'INVALID_ARGUMENT' },
        });
        expect(fake.calls).not.toContain(`repositories.${name}`);
      },
    );

    it('routes valid calls to the engine with positional args', async () => {
      const { client, fake } = await connect();
      await client.engine.repositories.add({
        url: 'https://h/r.git',
        ref: 'main',
      });
      await client.engine.repositories.update('id1');
      await client.engine.repositories.remove('id2');
      await client.engine.repositories.cancel('id3');
      await client.engine.repositories.list();
      expect(fake.calls.filter((name) => name !== 'diagnostics')).toEqual([
        'repositories.add',
        'repositories.update',
        'repositories.remove',
        'repositories.cancel',
        'repositories.list',
      ]);
    });

    it('add is not replayed after a drop; update/remove/cancel/list are', () => {
      expect(RPC_METHODS['repositories.add'].idempotent).toBe(false);
      for (const name of ['list', 'update', 'remove', 'cancel'] as const) {
        expect(RPC_METHODS[`repositories.${name}`].idempotent).toBe(true);
      }
    });

    it('error details (reason) survive the round trip', async () => {
      const { client } = await connect({
        'repositories.add': (async () => {
          throw new EngineError('GIT_FETCH_FAILED', {
            details: { reason: 'auth-required', url: 'https://h/r.git' },
          });
        }) as Method,
      });
      await expect(
        client.engine.repositories.add({ url: 'https://h/r.git' }),
      ).rejects.toMatchObject({
        code: 'GIT_FETCH_FAILED',
        details: { reason: 'auth-required', url: 'https://h/r.git' },
      });
    });

    it('repository-progress events reach a subscribed client', async () => {
      const { client, fake } = await connect();
      const events: EngineEvent[] = [];
      client.engine.subscribe((event) => events.push(event));
      await tick(5);
      fake.emit({
        type: 'repository-progress',
        id: 'r',
        phase: 'fetch',
        loaded: 1,
        total: 2,
      });
      await tick(5);
      expect(events).toEqual([
        {
          type: 'repository-progress',
          id: 'r',
          phase: 'fetch',
          loaded: 1,
          total: 2,
        },
      ]);
    });
  });
});
