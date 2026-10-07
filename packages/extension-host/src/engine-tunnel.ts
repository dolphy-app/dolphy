import { createEngineClient } from '@dolphy-app/engine-rpc/client';
import type { EngineClient } from '@dolphy-app/engine-rpc/client';
import type {
  ExtensionEngine,
  MessageEndpoint,
} from '@dolphy-app/engine-contract';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { EngineTunnelMessage } from './protocol.ts';

// Туннель кадров `engine-rpc` расширения внутри канала хоста: клиент в хосте
// расширений и диспетчер в движке говорят на обычном протоколе движка, а кадры
// едут сообщениями `engineFrame` по тому же порту, что и вызовы расширений.
// Один туннель на расширение; диспетчер видит его клиентом `extension:<id>`.

/** Конец туннеля как `MessageEndpoint` для клиента или диспетчера `engine-rpc`. */
interface TunnelEndpoint extends MessageEndpoint {
  /** Кадр от другой стороны. */
  deliver(frame: unknown): void;
  /** Другая сторона закрыла туннель: слушатели закрытия вызываются, `detach` не отправляется. */
  shut(): void;
}

/** `send` отправляет кадр другой стороне, `detach` сообщает ей о закрытии с нашей стороны. */
const createTunnelEndpoint = (
  send: (frame: unknown) => void,
  detach: () => void,
): TunnelEndpoint => {
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<() => void>();
  let closed = false;

  const finish = (): void => {
    closed = true;
    for (const listener of [...closeListeners]) listener();
  };

  return {
    post(frame) {
      if (!closed) send(frame);
    },
    onMessage(listener) {
      messageListeners.add(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
    },
    close() {
      if (closed) return;
      detach();
      finish();
    },
    deliver(frame) {
      if (closed) return;
      for (const listener of [...messageListeners]) listener(frame);
    },
    shut() {
      if (!closed) finish();
    },
  };
};

/** Диспетчер движка: принимает клиентов (`Dispatcher` из `@dolphy-app/engine-rpc/host`). */
export interface EngineClientSink {
  attach(endpoint: MessageEndpoint, clientId: string): void;
}

/** Сторона движка: кадры хоста становятся клиентами `extension:<id>` диспетчера. */
export interface EngineTunnels {
  /**
   * Подключает диспетчер: кадры, пришедшие раньше (расширение вызвало движок
   * в `server()`, пока движок открывался), доставляются теперь. `null` —
   * закрывает все туннели.
   */
  serve(sink: EngineClientSink | null): void;
  receive(message: EngineTunnelMessage): void;
  /** Порт хоста закрыт или заменён: ответов отправить некому, туннели закрываются молча. */
  reset(): void;
}

export const createEngineTunnels = (
  post: (message: EngineTunnelMessage) => void,
): EngineTunnels => {
  let sink: EngineClientSink | null = null;
  const tunnels = new Map<string, TunnelEndpoint>();
  // кадры расширений, пришедшие до диспетчера; снимаются при `engineDetach`
  const backlog = new Map<string, unknown[]>();

  const open = (
    attachTo: EngineClientSink,
    extensionId: string,
  ): TunnelEndpoint => {
    const endpoint = createTunnelEndpoint(
      (frame) =>
        post({ method: 'engineFrame', params: { extensionId, frame } }),
      () => post({ method: 'engineDetach', params: { extensionId } }),
    );
    tunnels.set(extensionId, endpoint);
    endpoint.onClose(() => {
      if (tunnels.get(extensionId) === endpoint) tunnels.delete(extensionId);
    });
    attachTo.attach(endpoint, `extension:${extensionId}`);
    return endpoint;
  };

  return {
    serve(next) {
      sink = next;
      if (next === null) {
        for (const endpoint of [...tunnels.values()]) endpoint.close();
        backlog.clear();
        return;
      }
      for (const [extensionId, frames] of [...backlog]) {
        backlog.delete(extensionId);
        const endpoint = open(next, extensionId);
        for (const frame of frames) endpoint.deliver(frame);
      }
    },

    receive(message) {
      const { extensionId } = message.params;
      if (message.method === 'engineDetach') {
        backlog.delete(extensionId);
        tunnels.get(extensionId)?.shut();
        return;
      }
      const { frame } = message.params;
      const existing = tunnels.get(extensionId);
      if (existing !== undefined) {
        existing.deliver(frame);
      } else if (sink === null) {
        const frames = backlog.get(extensionId) ?? [];
        frames.push(frame);
        backlog.set(extensionId, frames);
      } else {
        open(sink, extensionId).deliver(frame);
      }
    },

    reset() {
      for (const endpoint of [...tunnels.values()]) endpoint.shut();
      tunnels.clear();
      backlog.clear();
    },
  };
};

/** Клиент движка одного расширения; `release` отпускает его (повторный вызов ничего не делает). */
export interface EngineHandle {
  readonly engine: ExtensionEngine;
  release(): void;
}

/** Сторона хоста расширений: по клиенту движка на расширение, поверх одного порта. */
export interface EngineClients {
  /**
   * Клиент движка расширения. Пока расширение загружено (или его регистрация
   * идёт), клиент один и тот же: старая и новая активации делят его.
   * Вызовы ждут порта и диспетчера движка, не падая с отказом доступности.
   */
  open(extensionId: string): EngineHandle;
  receive(message: EngineTunnelMessage): void;
  /**
   * Порт к движку: `null` — порт потерян. Замена порта закрывает старые
   * туннели (вызовы в полёте отклоняются `ENGINE_CLOSED`), клиенты
   * подключаются заново и подписки восстанавливаются.
   */
  connect(link: MessageEndpoint | null): void;
  closeAll(): void;
}

interface HostEntry {
  readonly id: string;
  readonly client: EngineClient;
  readonly handle: ExtensionEngine;
  readonly dispose: () => Promise<void>;
  holders: number;
  endpoint: TunnelEndpoint;
}

const MAX_MESSAGE = 500;

export const createEngineClients = (logger: ExtensionLogger): EngineClients => {
  const entries = new Map<string, HostEntry>();
  let link: MessageEndpoint | null = null;
  // сообщения, отправленные, пока порта нет: уходят при первом подключении
  const queue: EngineTunnelMessage[] = [];

  const post = (message: EngineTunnelMessage): void => {
    if (link !== null) {
      link.post(message);
      return;
    }
    if (message.method === 'engineDetach') {
      // движок о туннеле ещё не знает: незачем его ждать и сообщать
      const { extensionId } = message.params;
      for (let index = queue.length - 1; index >= 0; index--) {
        if (queue[index]?.params.extensionId === extensionId) {
          queue.splice(index, 1);
        }
      }
      return;
    }
    queue.push(message);
  };

  const tunnelOf = (extensionId: string): TunnelEndpoint =>
    createTunnelEndpoint(
      (frame) =>
        post({ method: 'engineFrame', params: { extensionId, frame } }),
      () => post({ method: 'engineDetach', params: { extensionId } }),
    );

  const connectClient = ({ id, client, endpoint }: HostEntry): void => {
    client.attach(endpoint).catch((error: unknown) => {
      logger.warn(
        {
          extensionId: id,
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            MAX_MESSAGE,
          ),
        },
        'engine client did not connect',
      );
    });
  };

  const create = (id: string): HostEntry => {
    const client = createEngineClient();
    // `close` закрывает клиент у хоста; расширению отдаётся клиент без него
    const { close, ...handle } = client.engine;
    const entry: HostEntry = {
      id,
      client,
      handle,
      dispose: close,
      holders: 0,
      endpoint: tunnelOf(id),
    };
    entries.set(id, entry);
    connectClient(entry);
    return entry;
  };

  const drop = (entry: HostEntry): void => {
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
    void entry.dispose();
  };

  return {
    open(extensionId) {
      const entry = entries.get(extensionId) ?? create(extensionId);
      entry.holders++;
      let released = false;
      return {
        engine: entry.handle,
        release() {
          if (released) return;
          released = true;
          entry.holders--;
          if (entry.holders === 0) drop(entry);
        },
      };
    },

    receive(message) {
      const entry = entries.get(message.params.extensionId);
      if (entry === undefined) return;
      if (message.method === 'engineDetach') entry.endpoint.shut();
      else entry.endpoint.deliver(message.params.frame);
    },

    connect(next) {
      const previous = link;
      if (previous === next) return;
      link = next;
      if (previous !== null) {
        queue.length = 0;
        for (const entry of entries.values()) {
          entry.endpoint.shut();
          entry.endpoint = tunnelOf(entry.id);
          connectClient(entry);
        }
      }
      if (next !== null) {
        for (const message of queue.splice(0)) next.post(message);
      }
    },

    closeAll() {
      for (const entry of [...entries.values()]) drop(entry);
    },
  };
};
