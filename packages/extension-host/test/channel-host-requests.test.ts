import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SERVER_REGISTRATION } from '@dolphy-app/extension-api';
import { REPLACE_DEADLINE_MS } from '../src/channel.ts';
import type { ExtensionCandidate } from '../src/discover.ts';
import { createEndpointPair } from '../src/loopback.ts';
import type {
  HostResponse,
  ReplaceExtensionsRequest,
  ReplaceExtensionsResult,
} from '../src/protocol.ts';
import { createBareChannel, isReplaceRequest } from './channel-helpers.ts';
import { candidateOf, createLogger } from './helpers.ts';
import { createStubEngine } from './state-harness.ts';

afterEach(() => vi.useRealTimers());

/** Итог регистрации, в котором каждое расширение зарегистрировалось без вкладов. */
const registeredEmpty = (
  extensions: readonly ExtensionCandidate[],
): ReplaceExtensionsResult => ({
  registrations: Object.fromEntries(
    extensions.map(({ id }) => [
      id,
      { ok: true, registration: EMPTY_SERVER_REGISTRATION },
    ]),
  ),
});

/** Ответ хоста на запрос движка без идентификатора. */
type Reply =
  | { ok: true; result: unknown }
  | { ok: false; error: { cause: string; message: string } };

interface SetupOptions {
  restart?: () => void;
  connectTimeoutMs?: number;
  currentExtensions?: () => readonly ExtensionCandidate[];
  onRegistrations?: (result: ReplaceExtensionsResult) => void;
  /**
   * Ответ хоста на `replaceExtensions` (номер запроса с нуля): `null` — хост
   * молчит. По умолчанию каждое присланное расширение регистрируется пустым.
   */
  replyReplace?: (
    request: ReplaceExtensionsRequest,
    ordinal: number,
  ) => Reply | null;
}

/** Канал на стороне движка и «голый» endpoint хоста, с которого тест шлёт запросы вручную. */
const setup = (options: SetupOptions = {}) => {
  const logger = createLogger();
  const channel = createBareChannel({
    logger,
    ...(options.restart !== undefined && { restart: options.restart }),
    ...(options.connectTimeoutMs !== undefined && {
      connectTimeoutMs: options.connectTimeoutMs,
    }),
    ...(options.currentExtensions !== undefined && {
      currentExtensions: options.currentExtensions,
    }),
    ...(options.onRegistrations !== undefined && {
      onRegistrations: options.onRegistrations,
    }),
  });
  const [engineSide, hostSide] = createEndpointPair();
  const received: unknown[] = [];
  const replaceRequests: ReplaceExtensionsRequest[] = [];
  hostSide.onMessage((message) => {
    received.push(message);
    if (!isReplaceRequest(message)) return;
    const ordinal = replaceRequests.push(message) - 1;
    const reply: Reply | null =
      options.replyReplace === undefined
        ? { ok: true, result: registeredEmpty(message.params.extensions) }
        : options.replyReplace(message, ordinal);
    if (reply !== null) hostSide.post({ id: message.id, ...reply });
  });
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
  return { channel, logger, hostSide, received, replaceRequests, request };
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
      { type: 't', exerciseId: 'e', spec: {} },
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
    const channel = createBareChannel({ logger: createLogger() });
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

describe('набор расширений по каналу', () => {
  const acme = candidateOf('acme.a');
  const beta = candidateOf('acme.b');

  it('после attach хост первым сообщением получает текущих кандидатов, а итог регистрации уходит владельцу канала', async () => {
    const onRegistrations = vi.fn();
    const { received, replaceRequests } = setup({
      currentExtensions: () => [acme],
      onRegistrations,
    });

    await vi.waitFor(() => expect(onRegistrations).toHaveBeenCalledTimes(1));
    expect(received[0]).toBe(replaceRequests[0]);
    expect(replaceRequests[0]?.params.extensions).toEqual([acme]);
    expect(onRegistrations).toHaveBeenCalledWith(registeredEmpty([acme]));
  });

  it('повторный attach (перезапуск хоста) снова отправляет актуальный набор, а не тот, что был при первом', async () => {
    let current: readonly ExtensionCandidate[] = [acme];
    const onRegistrations = vi.fn();
    const { channel } = setup({
      currentExtensions: () => current,
      onRegistrations,
    });
    await vi.waitFor(() => expect(onRegistrations).toHaveBeenCalledTimes(1));

    current = [acme, beta];
    const [nextEngine, nextHost] = createEndpointPair();
    const sent: ReplaceExtensionsRequest[] = [];
    nextHost.onMessage((message) => {
      if (!isReplaceRequest(message)) return;
      sent.push(message);
      nextHost.post({
        id: message.id,
        ok: true,
        result: registeredEmpty(message.params.extensions),
      });
    });
    channel.attach(nextEngine);

    await vi.waitFor(() => expect(onRegistrations).toHaveBeenCalledTimes(2));
    expect(sent[0]?.params.extensions).toEqual([acme, beta]);
    expect(onRegistrations).toHaveBeenLastCalledWith(
      registeredEmpty([acme, beta]),
    );
  });

  it('replaceExtensions отправляет кандидатов и возвращает итог хоста по каждому расширению', async () => {
    const answer: ReplaceExtensionsResult = {
      registrations: {
        [beta.id]: { ok: false, error: 'server() threw: boom' },
        [acme.id]: { ok: true, registration: EMPTY_SERVER_REGISTRATION },
      },
    };
    const { channel, replaceRequests } = setup({
      replyReplace: (request, ordinal) => ({
        ok: true,
        result:
          ordinal === 0 ? registeredEmpty(request.params.extensions) : answer,
      }),
    });

    const result = await channel.replaceExtensions([acme, beta]);

    expect(replaceRequests[1]?.params.extensions).toEqual([acme, beta]);
    expect(result).toEqual(answer);
  });

  it.each([
    [
      'хост отказал',
      { ok: false as const, error: { cause: 'handler-failed', message: 'x' } },
      /refused/,
    ],
    [
      'итог неверной формы',
      {
        ok: true as const,
        result: { registrations: { 'acme.a': { ok: true } } },
      },
      /invalid registration result/,
    ],
    [
      'итог не объект',
      { ok: true as const, result: 'registered' },
      /invalid registration result/,
    ],
  ])(
    'replaceExtensions отклоняется, если %s',
    async (_name, reply, message) => {
      const { channel } = setup({
        replyReplace: (request, ordinal) =>
          ordinal === 0
            ? { ok: true, result: registeredEmpty(request.params.extensions) }
            : reply,
      });

      await expect(channel.replaceExtensions([acme])).rejects.toThrow(message);
    },
  );

  it('хост не ответил к сроку: replaceExtensions отклоняется и хост перезапускается', async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const { channel } = setup({
      restart,
      replyReplace: (request, ordinal) =>
        ordinal === 0
          ? { ok: true, result: registeredEmpty(request.params.extensions) }
          : null,
    });

    let settled = false;
    const assertion = expect(channel.replaceExtensions([acme])).rejects.toThrow(
      /did not answer/,
    );
    void assertion.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(REPLACE_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    expect(restart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('закрытие endpoint до ответа: replaceExtensions отклоняется', async () => {
    const { channel, hostSide, replaceRequests } = setup({
      replyReplace: () => null,
    });
    const assertion = expect(channel.replaceExtensions([acme])).rejects.toThrow(
      /closed/,
    );
    await vi.waitFor(() => expect(replaceRequests).toHaveLength(2));

    hostSide.close();

    await assertion;
  });

  it('хоста нет дольше connectTimeoutMs: replaceExtensions отклоняется', async () => {
    vi.useFakeTimers();
    const channel = createBareChannel({
      logger: createLogger(),
      connectTimeoutMs: 500,
    });
    const assertion = expect(channel.replaceExtensions([acme])).rejects.toThrow(
      /not connected/,
    );

    await vi.advanceTimersByTimeAsync(500);

    await assertion;
  });

  it('хост не прислал итог на attach: владелец канала итога не получает, сбой попадает в журнал', async () => {
    const onRegistrations = vi.fn();
    const { logger } = setup({
      onRegistrations,
      replyReplace: () => ({
        ok: false,
        error: { cause: 'handler-failed', message: 'x' },
      }),
    });

    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledTimes(1));
    expect(onRegistrations).not.toHaveBeenCalled();
  });

  it('просрочка обычного вызова перезапускает хост', async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const { channel } = setup({ restart });

    const outcome = channel.call(
      'project',
      { type: 't', exerciseId: 'e', spec: {} },
      200,
    );
    await vi.advanceTimersByTimeAsync(199);
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toEqual({ kind: 'timeout' });
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
