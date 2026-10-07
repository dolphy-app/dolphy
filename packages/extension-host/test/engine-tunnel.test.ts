import { EngineError } from '@dolphy-app/engine/app';
import { CONTRACT_VERSION, RPC_METHODS } from '@dolphy-app/engine-contract';
import type {
  EngineEvent,
  ExtensionEngine,
  MessageEndpoint,
} from '@dolphy-app/engine-contract';
import { createDispatcher, schemas } from '@dolphy-app/engine-rpc/host';
import type {
  RpcContract,
  ServerContext,
  SettingValues,
} from '@dolphy-app/extension-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createEngineClients,
  createEngineTunnels,
} from '../src/engine-tunnel.ts';
import type { EngineClientSink, EngineClients } from '../src/engine-tunnel.ts';
import { createEndpointPair } from '../src/loopback.ts';
import type { EngineTunnelMessage } from '../src/protocol.ts';
import { createFakeEngine } from './engine-fake.ts';
import type { FakeEngine, FakeMethod } from './engine-fake.ts';
import { candidateOf, createLogger } from './helpers.ts';
import type { TestLogger } from './helpers.ts';
import { createHarness } from './state-harness.ts';
import type { Harness } from './state-harness.ts';

type Server = ServerContext<SettingValues, ExtensionEngine>;

const ID = 'acme.tun';
const EVENT: EngineEvent = { type: 'state-rebuilt', entries: 1, ms: 2 };
const HELLO_RESULT = { contractVersion: CONTRACT_VERSION, engineVersion: 'x' };

const requestFrame = z.object({ id: z.string(), method: z.string() });

/** Запрос клиента движка внутри сообщения туннеля; не кадр запроса — `null`. */
const requestOf = (message: EngineTunnelMessage) => {
  if (message.method !== 'engineFrame') return null;
  const parsed = requestFrame.safeParse(message.params.frame);
  return parsed.success ? parsed.data : null;
};

const frameOf = (extensionId: string, frame: unknown): EngineTunnelMessage => ({
  method: 'engineFrame',
  params: { extensionId, frame },
});

/** Конец канала, который записывает всё, что в него отправили. */
const recordingLink = () => {
  const sent: EngineTunnelMessage[] = [];
  const link: MessageEndpoint = {
    post: (message) => void sent.push(message as EngineTunnelMessage),
    onMessage: () => {},
    onClose: () => {},
    close: () => {},
  };
  return { link, sent };
};

/** Движок на другом конце порта: отвечает на рукопожатие и на каждый запрос `{ method }`. */
const answeringLink = (clients: EngineClients, extensionId: string) => {
  const { link, sent } = recordingLink();
  const record = link.post;
  link.post = (message) => {
    record(message);
    const request = requestOf(message as EngineTunnelMessage);
    if (request === null) return;
    const result =
      request.method === 'engine.hello'
        ? HELLO_RESULT
        : { method: request.method };
    queueMicrotask(() =>
      clients.receive(
        frameOf(extensionId, { id: request.id, ok: true, result }),
      ),
    );
  };
  return { link, sent };
};

describe('кадры движка в канале хоста: клиент extension:<id> и диспетчер', () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  const peek: RpcContract<null, unknown> = {
    name: 'engine.peek',
    input: z.null(),
    output: z.unknown(),
  };

  interface Setup {
    h: Harness;
    fake: FakeEngine;
    dispatcherLog: TestLogger;
    serve(): void;
    engines: Map<string, ExtensionEngine>;
  }

  /** Расширения `ids`: `server` запоминает `s.engine` и регистрирует `engine.peek` (вызов `library.getInfo`). */
  const start = async (
    ids: string[],
    options: {
      overrides?: Record<string, FakeMethod>;
      serve?: boolean;
      onServer?: (s: Server) => void;
    } = {},
  ): Promise<Setup> => {
    const fake = createFakeEngine(options.overrides);
    const dispatcherLog = createLogger();
    const dispatcher = createDispatcher({
      engine: fake.engine,
      schemas,
      logger: dispatcherLog,
    });
    const engines = new Map<string, ExtensionEngine>();
    const modules = Object.fromEntries(
      ids.map((id) => [
        id,
        {
          server: (s: Server) => {
            engines.set(id, s.engine);
            options.onServer?.(s);
            s.handle(peek, () => s.engine.library.getInfo());
          },
        },
      ]),
    );
    const h = await createHarness({
      candidates: ids.map((id) => candidateOf(id)),
      modules,
    });
    harness = h;
    const serve = () => h.channel.serveEngine(dispatcher);
    if (options.serve !== false) serve();
    return { h, fake, dispatcherLog, serve, engines };
  };

  it('расширение вызывает метод движка и получает ответ; клиент виден в журнале диспетчера как extension:<id>', async () => {
    const { h, fake, dispatcherLog } = await start([ID]);

    expect(await h.rpc.invoke(ID, 'engine.peek', null)).toEqual({
      method: 'library.getInfo',
      args: [],
    });

    expect(fake.calls).toEqual(['diagnostics', 'library.getInfo']);
    expect(dispatcherLog.info).toHaveBeenCalledWith(
      { clientId: `extension:${ID}` },
      'rpc client attached',
    );
    expect(dispatcherLog.debug).toHaveBeenCalledWith(
      { clientId: `extension:${ID}`, method: 'library.getInfo' },
      'rpc call',
    );
  });

  it('методы записи проходят с аргументами как у окна', async () => {
    const { engines, fake } = await start([ID]);
    const attempt = {
      requestId: 'r1',
      exerciseId: 'c::l::e',
      grade: 5,
    } as const;

    const result = await engines.get(ID)?.practice.recordAttempt(attempt);

    expect(result).toEqual({
      method: 'practice.recordAttempt',
      args: [attempt],
    });
    expect(fake.calls).toContain('practice.recordAttempt');
  });

  it('ошибка движка приходит как EngineCallError с кодом, retryable и details', async () => {
    const { engines } = await start([ID], {
      overrides: {
        'library.getInfo': async () => {
          throw new EngineError('NOT_FOUND', { details: { what: 'x' } });
        },
      },
    });

    await expect(engines.get(ID)?.library.getInfo()).rejects.toMatchObject({
      name: 'EngineCallError',
      code: 'NOT_FOUND',
      retryable: false,
      details: { what: 'x' },
    });
  });

  it('подписка приходит расширению', async () => {
    const { engines, fake } = await start([ID]);
    const received = new Promise<EngineEvent>((resolve) => {
      engines.get(ID)?.subscribe(resolve);
    });
    await fake.subscribed();
    expect(fake.listenerCount()).toBe(1);

    fake.emit(EVENT);

    expect(await received).toEqual(EVENT);
  });

  it('у каждого расширения свой клиент: события приходят каждому, в журнале два клиента', async () => {
    const { engines, fake, dispatcherLog } = await start([
      'acme.one',
      'acme.two',
    ]);
    const seen: EngineEvent[] = [];
    const bothSubscribed = fake.subscribed(2);
    const delivered = new Promise<void>((resolve) => {
      const listener = (event: EngineEvent): void => {
        seen.push(event);
        if (seen.length === 2) resolve();
      };
      engines.get('acme.one')?.subscribe(listener);
      engines.get('acme.two')?.subscribe(listener);
    });
    await bothSubscribed;
    expect(fake.listenerCount()).toBe(2);

    fake.emit(EVENT);
    await delivered;

    expect(seen).toEqual([EVENT, EVENT]);
    const attached = dispatcherLog.info.mock.calls
      .filter(([, message]) => message === 'rpc client attached')
      .map(([fields]) => fields);
    expect(attached).toEqual(
      expect.arrayContaining([
        { clientId: 'extension:acme.one' },
        { clientId: 'extension:acme.two' },
      ]),
    );
  });

  it('выгрузка расширения закрывает его клиент: подписка снимается, диспетчер пишет об отключении', async () => {
    const { h, engines, fake, dispatcherLog } = await start([ID]);
    engines.get(ID)?.subscribe(() => {});
    await fake.subscribed();
    const detached = new Promise<void>((resolve) => {
      dispatcherLog.info.mockImplementation((fields, message) => {
        if (message === 'rpc client detached') resolve();
        return fields;
      });
    });

    await h.replace([]);
    await detached;

    expect(fake.listenerCount()).toBe(0);
    expect(dispatcherLog.info).toHaveBeenCalledWith(
      { clientId: `extension:${ID}` },
      'rpc client detached',
    );
  });

  it('вызов, сделанный до подключения диспетчера (движок ещё открывается), ждёт, а не падает', async () => {
    const early: { call?: Promise<unknown> } = {};
    const { serve } = await start([ID], {
      serve: false,
      onServer: (s) => {
        early.call = s.engine.library.getInfo();
      },
    });
    const settled = vi.fn();
    early.call?.then(settled, settled);
    // регистрация уже завершилась, движка ещё нет
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    serve();

    expect(await early.call).toEqual({ method: 'library.getInfo', args: [] });
  });

  it('новое соединение с хостом: клиенты подключаются заново, вызовы и подписки работают', async () => {
    const { h, engines, fake } = await start([ID]);
    const received: EngineEvent[] = [];
    const delivered = new Promise<void>((resolve) => {
      engines.get(ID)?.subscribe((event) => {
        received.push(event);
        resolve();
      });
    });
    await fake.subscribed();

    const resubscribed = fake.subscribed();
    const [engineSide, hostSide] = createEndpointPair();
    h.runtime.attach(hostSide);
    h.channel.attach(engineSide);
    await resubscribed;

    expect(await engines.get(ID)?.library.getInfo()).toEqual({
      method: 'library.getInfo',
      args: [],
    });
    fake.emit(EVENT);
    await delivered;
    expect(received).toEqual([EVENT]);
  });
});

describe('createEngineClients (сторона хоста расширений)', () => {
  it('каждый метод RPC_METHODS доступен через server.engine; engine.hello и close — нет', async () => {
    const clients = createEngineClients(createLogger());
    const { link, sent } = answeringLink(clients, ID);
    const { engine } = clients.open(ID);
    clients.connect(link);

    for (const name of Object.keys(RPC_METHODS)) {
      let owner: unknown = engine;
      let target: unknown = engine;
      for (const segment of name.split('.')) {
        owner = target;
        target =
          typeof target === 'object' && target !== null
            ? Reflect.get(target, segment)
            : undefined;
      }
      expect(typeof target, name).toBe('function');
      if (typeof target !== 'function') continue;
      expect(await Reflect.apply(target, owner, [])).toEqual({ method: name });
    }

    const called = sent.flatMap((message) => requestOf(message)?.method ?? []);
    expect(new Set(called)).toEqual(
      new Set([...Object.keys(RPC_METHODS), 'engine.hello']),
    );
    expect(typeof engine.subscribe).toBe('function');
    expect('close' in engine).toBe(false);
  });

  it('вызовы до подключения порта ждут и уходят по порядку после рукопожатия', async () => {
    const clients = createEngineClients(createLogger());
    const { link, sent } = answeringLink(clients, ID);
    const { engine } = clients.open(ID);

    const first = engine.library.reload();
    const second = engine.library.compile();
    expect(sent).toEqual([]);
    clients.connect(link);

    await Promise.all([first, second]);
    expect(sent.map((message) => requestOf(message)?.method)).toEqual([
      'engine.hello',
      'library.reload',
      'library.compile',
    ]);
  });

  it('release до подключения порта снимает ждущие кадры: движок их никогда не увидит', async () => {
    const clients = createEngineClients(createLogger());
    const { link, sent } = recordingLink();
    const handle = clients.open(ID);
    const abandoned = handle.engine.library.reload().then(
      () => 'resolved',
      (error: unknown) => error,
    );

    handle.release();
    clients.connect(link);

    expect(await abandoned).toMatchObject({ code: 'ENGINE_CLOSED' });
    expect(sent).toEqual([]);
  });

  it('старая и новая активации делят клиента; он закрывается, когда отпущены обе', async () => {
    const clients = createEngineClients(createLogger());
    const { link, sent } = answeringLink(clients, ID);
    clients.connect(link);
    const old = clients.open(ID);
    const fresh = clients.open(ID);
    expect(fresh.engine).toBe(old.engine);
    await old.engine.library.getInfo();

    old.release();
    old.release();
    expect(sent.filter((message) => message.method === 'engineDetach')).toEqual(
      [],
    );
    fresh.release();

    expect(sent.filter((message) => message.method === 'engineDetach')).toEqual(
      [{ method: 'engineDetach', params: { extensionId: ID } }],
    );
  });

  it('потеря порта: вызов в полёте отклоняется ENGINE_CLOSED, новый порт — новое рукопожатие', async () => {
    const clients = createEngineClients(createLogger());
    const first = recordingLink(); // ответов нет: рукопожатие и вызов повисают
    const { engine } = clients.open(ID);
    clients.connect(first.link);
    const inFlight = engine.library.reload().then(
      () => 'resolved',
      (error: unknown) => error,
    );

    clients.connect(null);

    expect(await inFlight).toMatchObject({ code: 'ENGINE_CLOSED' });
    const second = answeringLink(clients, ID);
    clients.connect(second.link);
    expect(await engine.library.getInfo()).toEqual({
      method: 'library.getInfo',
    });
    expect(second.sent.map((message) => requestOf(message)?.method)).toEqual([
      'engine.hello',
      'library.getInfo',
    ]);
  });

  it('несовместимая версия контракта не роняет хоста: вызов отклоняется, причина в журнале', async () => {
    const logger = createLogger();
    const clients = createEngineClients(logger);
    const { link } = recordingLink();
    const record = link.post;
    link.post = (message) => {
      record(message);
      const request = requestOf(message as EngineTunnelMessage);
      if (request?.method !== 'engine.hello') return;
      queueMicrotask(() =>
        clients.receive(
          frameOf(ID, {
            id: request.id,
            ok: true,
            result: { contractVersion: CONTRACT_VERSION + 1 },
          }),
        ),
      );
    };
    clients.connect(link);
    const { engine } = clients.open(ID);

    await expect(engine.library.reload()).rejects.toMatchObject({
      code: 'ENGINE_CLOSED',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: ID }),
      'engine client did not connect',
    );
  });
});

describe('createEngineTunnels (сторона движка)', () => {
  const sinkOf = () => {
    const attached: { clientId: string; endpoint: MessageEndpoint }[] = [];
    const sink: EngineClientSink = {
      attach: (endpoint, clientId) =>
        void attached.push({ clientId, endpoint }),
    };
    return { sink, attached };
  };

  it('каждое расширение — клиент диспетчера extension:<id>', () => {
    const tunnels = createEngineTunnels(() => {});
    const { sink, attached } = sinkOf();
    tunnels.serve(sink);

    tunnels.receive(frameOf(ID, 'one'));
    tunnels.receive(frameOf(ID, 'two'));
    tunnels.receive(frameOf('acme.other', 'solo'));

    expect(attached.map(({ clientId }) => clientId)).toEqual([
      `extension:${ID}`,
      'extension:acme.other',
    ]);
  });

  it('кадры, пришедшие до диспетчера, доставляются слушателю по порядку при подключении', () => {
    const tunnels = createEngineTunnels(() => {});
    tunnels.receive(frameOf(ID, 'one'));
    tunnels.receive(frameOf(ID, 'two'));
    const delivered: unknown[] = [];

    tunnels.serve({
      attach: (endpoint) =>
        endpoint.onMessage((frame) => void delivered.push(frame)),
    });

    expect(delivered).toEqual(['one', 'two']);
  });

  it('engineDetach до диспетчера снимает накопленные кадры расширения', () => {
    const tunnels = createEngineTunnels(() => {});
    tunnels.receive(frameOf(ID, 'one'));
    tunnels.receive({ method: 'engineDetach', params: { extensionId: ID } });
    const { sink, attached } = sinkOf();

    tunnels.serve(sink);

    expect(attached).toEqual([]);
  });

  it('ответ диспетчера уходит кадром того же расширения; закрытие диспетчером — engineDetach', () => {
    const posted: EngineTunnelMessage[] = [];
    const tunnels = createEngineTunnels((message) => void posted.push(message));
    const { sink, attached } = sinkOf();
    tunnels.serve(sink);
    tunnels.receive(frameOf(ID, 'hello'));

    const endpoint = attached[0]?.endpoint;
    endpoint?.post({ id: '1', ok: true, result: null });
    endpoint?.close();

    expect(posted).toEqual([
      frameOf(ID, { id: '1', ok: true, result: null }),
      { method: 'engineDetach', params: { extensionId: ID } },
    ]);
  });

  it('engineDetach от хоста закрывает клиента диспетчера без ответного engineDetach', () => {
    const posted: EngineTunnelMessage[] = [];
    const tunnels = createEngineTunnels((message) => void posted.push(message));
    const closed = vi.fn();
    tunnels.serve({ attach: (endpoint) => endpoint.onClose(closed) });
    tunnels.receive(frameOf(ID, 'hello'));

    tunnels.receive({ method: 'engineDetach', params: { extensionId: ID } });

    expect(closed).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([]);
  });

  it('reset (порт хоста закрыт) закрывает туннели молча; следующий кадр открывает новый', () => {
    const posted: EngineTunnelMessage[] = [];
    const tunnels = createEngineTunnels((message) => void posted.push(message));
    const closed = vi.fn();
    const attached = vi.fn();
    tunnels.serve({
      attach: (endpoint) => {
        attached();
        endpoint.onClose(closed);
      },
    });
    tunnels.receive(frameOf(ID, 'a'));

    tunnels.reset();
    tunnels.receive(frameOf(ID, 'b'));

    expect(closed).toHaveBeenCalledTimes(1);
    expect(attached).toHaveBeenCalledTimes(2);
    expect(posted).toEqual([]);
  });

  it('serve(null) закрывает туннели и сообщает хосту', () => {
    const posted: EngineTunnelMessage[] = [];
    const tunnels = createEngineTunnels((message) => void posted.push(message));
    tunnels.serve({ attach: () => {} });
    tunnels.receive(frameOf(ID, 'a'));

    tunnels.serve(null);

    expect(posted).toEqual([
      { method: 'engineDetach', params: { extensionId: ID } },
    ]);
  });
});
