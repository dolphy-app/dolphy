import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostChannel } from '../src/channel.ts';
import { createEndpointPair } from '../src/loopback.ts';
import type { HostResponse } from '../src/protocol.ts';
import { createLogger } from './helpers.ts';
import { createStubEngine } from './state-harness.ts';

afterEach(() => vi.useRealTimers());

/** Канал на стороне движка и «голый» endpoint хоста, с которого тест шлёт запросы вручную. */
const setup = (options: { restart?: () => void } = {}) => {
  const logger = createLogger();
  const channel = createHostChannel({ logger, ...options });
  const [engineSide, hostSide] = createEndpointPair();
  const received: unknown[] = [];
  hostSide.onMessage((message) => received.push(message));
  channel.attach(engineSide);
  let counter = 0;
  const request = async (
    method: string,
    params: unknown,
    id = `h${counter++}`,
  ): Promise<HostResponse> => {
    hostSide.post({ id, method, params });
    const answered = (): HostResponse | undefined =>
      (received as HostResponse[]).find(
        (message) => message.id === id && 'ok' in message,
      );
    await vi.waitFor(() => expect(answered()).toBeDefined());
    return answered() as HostResponse;
  };
  return { channel, logger, hostSide, received, request };
};

describe('запросы хоста к движку по каналу', () => {
  it('хранилище и настройки обслуживает движок; ответы несут идентификатор запроса', async () => {
    const engine = createStubEngine();
    const { channel, request } = setup();
    channel.serve(engine.extensionHost);
    const ext = 'acme.a';

    expect(
      await request(
        'storage.set',
        { extensionId: ext, key: 'k', value: [1] },
        'h1',
      ),
    ).toEqual({ id: 'h1', ok: true, result: undefined });
    expect(
      await request('storage.get', { extensionId: ext, key: 'k' }, 'h2'),
    ).toEqual({ id: 'h2', ok: true, result: [1] });
    expect(await request('storage.keys', { extensionId: ext }, 'h3')).toEqual({
      id: 'h3',
      ok: true,
      result: ['k'],
    });
    expect(
      await request('storage.delete', { extensionId: ext, key: 'k' }, 'h4'),
    ).toEqual({ id: 'h4', ok: true, result: true });
    engine.changeSetting({ extensionId: ext, id: 'acme.a.x', value: 5 });
    expect(await request('settings.all', { extensionId: ext }, 'h5')).toEqual({
      id: 'h5',
      ok: true,
      result: { 'acme.a.x': 5 },
    });
  });

  it('статистику обслуживает движок: параметры доходят как есть, форма проверяется строго', async () => {
    const engine = createStubEngine();
    const { channel, request } = setup();
    channel.serve(engine.extensionHost);
    const ext = 'acme.a';

    expect(await request('stats.streak', { extensionId: ext }, 's1')).toEqual({
      id: 's1',
      ok: true,
      result: { current: 3, longest: 7 },
    });
    expect(
      await request(
        'stats.daily',
        {
          extensionId: ext,
          from: '2024-05-01',
          to: '2024-05-02',
          courseId: 'c',
        },
        's2',
      ),
    ).toMatchObject({ id: 's2', ok: true });
    expect(engine.statsCalls).toEqual([
      { extensionId: ext, method: 'streak', args: [] },
      {
        extensionId: ext,
        method: 'daily',
        args: ['2024-05-01', '2024-05-02', 'c'],
      },
    ]);

    for (const params of [
      { extensionId: ext, courseId: 7 },
      { extensionId: ext, extra: true },
      { extensionId: ext, from: '2024-05-01' },
    ]) {
      const method = 'from' in params ? 'stats.daily' : 'stats.streak';
      expect(await request(method, params), method).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
    expect(engine.statsCalls).toHaveLength(2);
  });

  it('секреты: у отсутствующего ключа ответ без значения, сбой службы идёт с кодом SECRETS_UNAVAILABLE', async () => {
    const engine = createStubEngine();
    const { channel, request } = setup();
    channel.serve(engine.extensionHost);
    const ext = 'acme.a';

    expect(
      await request('secrets.get', { extensionId: ext, key: 't' }, 'h1'),
    ).toEqual({ id: 'h1', ok: true, result: undefined });
    await request(
      'secrets.set',
      { extensionId: ext, key: 't', value: 'v' },
      'h1-set',
    );
    expect(
      await request('secrets.get', { extensionId: ext, key: 't' }, 'h2'),
    ).toEqual({ id: 'h2', ok: true, result: 'v' });
    engine.keyStore.available = false;
    expect(
      await request('secrets.get', { extensionId: ext, key: 't' }, 'h2-down'),
    ).toMatchObject({ ok: false, error: { code: 'SECRETS_UNAVAILABLE' } });
    expect(
      await request('secrets.delete', { extensionId: ext, key: 't' }, 'h3'),
    ).toEqual({ id: 'h3', ok: true, result: true });
  });

  it('уведомления обслуживает движок: параметры доходят как есть, форма проверяется строго', async () => {
    const engine = createStubEngine();
    const { channel, request } = setup();
    channel.serve(engine.extensionHost);
    const ext = 'acme.a';

    expect(
      await request(
        'notifications.show',
        { extensionId: ext, title: 'T', body: 'B' },
        'n1',
      ),
    ).toEqual({ id: 'n1', ok: true, result: true });
    expect(engine.notified).toEqual([
      { extensionId: ext, title: 'T', body: 'B' },
    ]);

    for (const params of [
      { extensionId: ext, title: 'T' },
      { extensionId: ext, title: 1, body: 'B' },
      { extensionId: ext, title: 'T', body: 'B', silent: true },
    ]) {
      expect(await request('notifications.show', params)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
    expect(engine.notified).toHaveLength(1);
  });

  it('сообщение хоста о сбое вне вызова попадает в здоровье расширения; неверная форма отклоняется', async () => {
    const engine = createStubEngine();
    const { channel, request } = setup();
    channel.serve(engine.extensionHost);

    expect(
      await request('health.report', {
        extensionId: 'acme.a',
        kind: 'failed',
        reason: 'ipc-size',
        message: 'too big',
      }),
    ).toMatchObject({ ok: true });
    expect(engine.health.get('acme.a')).toMatchObject({
      failures: 1,
      lastFailure: { reason: 'ipc-size', message: 'too big' },
    });
    expect(
      await request('health.report', { extensionId: 'acme.a', kind: 'failed' }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(engine.health.get('acme.a').failures).toBe(1);
  });

  it('превышение потолка и отказ отключённого расширения доходят с кодом и details', async () => {
    const engine = createStubEngine();
    const { channel, request } = setup();
    channel.serve(engine.extensionHost);

    const quota = await request('storage.set', {
      extensionId: 'acme.a',
      key: 'x'.repeat(129),
      value: 1,
    });
    expect(quota).toEqual({
      id: expect.any(String),
      ok: false,
      error: {
        code: 'EXTENSION_STORAGE_QUOTA',
        message: expect.any(String),
        details: { extensionId: 'acme.a', kind: 'key-length', limit: 128 },
      },
    });

    engine.disabled.add('acme.a');
    const disabled = await request('storage.keys', { extensionId: 'acme.a' });
    expect(disabled).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT', details: { reason: 'disabled' } },
    });
  });

  it('без сервисов запрос отклоняется (UNAVAILABLE), неверная форма — INVALID_ARGUMENT', async () => {
    const { channel, request } = setup();
    expect(
      await request('storage.keys', { extensionId: 'acme.a' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    });

    channel.serve(createStubEngine().extensionHost);
    expect(
      await request('storage.get', { extensionId: 'acme.a' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    expect(
      await request('storage.wipe', { extensionId: 'acme.a' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });

  it('запрос хоста не мешает вызовам движка: оба потока идут по одному каналу', async () => {
    const { channel, hostSide, request } = setup();
    channel.serve(createStubEngine().extensionHost);
    hostSide.onMessage((message) => {
      const call = message as { id: string; method?: string };
      if (call.method === 'project') {
        hostSide.post({ id: call.id, ok: true, result: 'projected' });
      }
    });

    const call = channel.call(
      'project',
      { type: 't', exerciseId: 'e', spec: {}, isolated: false },
      1000,
    );
    const keys = await request('storage.keys', { extensionId: 'acme.a' });

    expect(keys).toMatchObject({ ok: true, result: [] });
    expect(await call).toMatchObject({
      kind: 'response',
      response: { ok: true, result: 'projected' },
    });
  });

  it('сообщение без хоста теряется, исключения нет', () => {
    const channel = createHostChannel({ logger: createLogger() });
    expect(() =>
      channel.notify({
        method: 'settingChanged',
        params: { extensionId: 'acme.a', id: 'acme.a.x', value: 1 },
      }),
    ).not.toThrow();
  });
});

describe('срок вызова без перезапуска хоста', () => {
  it('просрочка best-effort вызова (restart: false) хост не перезапускает, обычного вызова — перезапускает', async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const { channel } = setup({ restart });
    const params = {
      extensionId: 'acme.a',
      name: 'session.started' as const,
      payload: { sessionId: 's', at: 1 },
      isolated: false,
    };

    const quiet = channel.call('deliverEvent', params, 100, { restart: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(await quiet).toEqual({ kind: 'timeout' });
    expect(restart).not.toHaveBeenCalled();

    const strict = channel.call('deliverEvent', params, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(await strict).toEqual({ kind: 'timeout' });
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
