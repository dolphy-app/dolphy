import {
  CONTRACT_VERSION,
  RPC_METHODS,
  type EngineErrorCode,
  type EngineErrorDto,
  type EngineEvent,
  type LearningEngine,
  type MessageEndpoint,
  type RpcMethodName,
  type RpcRequest,
  type RpcResponse,
} from '@dolphy-app/engine-contract';

/** Ошибка вызова движка по RPC; несёт код, `retryable` и `details` хоста. */
export class EngineCallError extends Error {
  readonly code: EngineErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor({ code, message, retryable, details }: EngineErrorDto) {
    super(message);
    this.name = 'EngineCallError';
    this.code = code;
    this.retryable = retryable;
    if (details) this.details = details;
  }
}

export interface EngineClient {
  /** Подключает (или переподключает) порт: рукопожатие, подписка, повтор. */
  attach(endpoint: MessageEndpoint): Promise<void>;
  /** Фасад `LearningEngine`, построенный из таблицы `RPC_METHODS`. */
  readonly engine: LearningEngine;
}

interface PendingCall {
  id: string;
  method: string;
  args: unknown[];
  replayable: boolean;
  /** Сколько раз запрос ушёл в порт; повтор разрешён, пока их меньше двух. */
  sends: number;
  sent: boolean;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

const closedError = (): EngineCallError =>
  new EngineCallError({
    code: 'ENGINE_CLOSED',
    message: 'Engine is closed',
    retryable: true,
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRpcMethod = (name: string): name is RpcMethodName =>
  Object.hasOwn(RPC_METHODS, name);

const childOf = (
  node: Record<string, unknown>,
  key: string,
): Record<string, unknown> => {
  const existing = node[key];
  if (isRecord(existing)) return existing;
  const created: Record<string, unknown> = {};
  node[key] = created;
  return created;
};

type EventListener = (event: EngineEvent) => void;

export const createEngineClient = (): EngineClient => {
  const pending = new Map<string, PendingCall>();
  const listeners = new Set<EventListener>();
  let endpoint: MessageEndpoint | null = null;
  let disposed = false;
  let nextId = 0;

  const post = (call: PendingCall, target: MessageEndpoint): void => {
    call.sent = true;
    call.sends += 1;
    const request: RpcRequest = {
      id: call.id,
      method: call.method,
      params: call.args,
    };
    target.post(request);
  };

  const request = (
    method: string,
    args: unknown[],
    control = false,
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (disposed) {
        reject(closedError());
        return;
      }
      const replayable =
        !control && isRpcMethod(method) && RPC_METHODS[method].idempotent;
      const call: PendingCall = {
        id: String(nextId++),
        method,
        args,
        replayable,
        sends: 0,
        sent: false,
        resolve,
        reject,
      };
      if (endpoint) {
        pending.set(call.id, call);
        try {
          post(call, endpoint);
        } catch (error) {
          pending.delete(call.id); // DataCloneError и т. п.: вызов не ушёл
          reject(error);
        }
      } else if (replayable) {
        pending.set(call.id, call); // уйдёт после attach
      } else {
        reject(closedError());
      }
    });

  const notify = (event: EngineEvent): void => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // ошибка слушателя не должна ломать остальных; всплывает как uncaught
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  };

  const onMessage = (message: unknown): void => {
    if (!isRecord(message)) return;
    if ('event' in message) {
      notify(message['event'] as EngineEvent);
      return;
    }
    const response = message as unknown as RpcResponse;
    const call = pending.get(response.id);
    if (!call) return;
    pending.delete(response.id);
    if (response.ok) call.resolve(response.result);
    else call.reject(new EngineCallError(response.error));
  };

  const onClosed = (): void => {
    endpoint = null;
    for (const [id, call] of pending) {
      if (call.replayable && call.sends < 2) {
        call.sent = false; // один повтор после переподключения
        continue;
      }
      pending.delete(id);
      call.reject(closedError());
    }
  };

  const control = (method: string, args: unknown[] = []): Promise<unknown> =>
    request(method, args, true);

  const attach = async (next: MessageEndpoint): Promise<void> => {
    if (disposed) throw closedError();
    if (endpoint) {
      const previous = endpoint;
      onClosed();
      previous.close();
    }
    endpoint = next;
    next.onMessage((message) => {
      if (endpoint === next) onMessage(message);
    });
    next.onClose(() => {
      if (endpoint === next) onClosed();
    });
    try {
      const hello = await control('engine.hello', [
        { contractVersion: CONTRACT_VERSION },
      ]);
      const hostVersion = isRecord(hello) ? hello['contractVersion'] : null;
      if (hostVersion !== CONTRACT_VERSION) {
        throw new EngineCallError({
          code: 'INCOMPATIBLE_CONTRACT',
          message: 'Incompatible contract version',
          retryable: false,
          details: { host: hostVersion, client: CONTRACT_VERSION },
        });
      }
      if (listeners.size > 0) await control('events.subscribe');
    } catch (error) {
      if (endpoint === next) {
        onClosed();
        next.close();
      }
      throw error;
    }
    for (const call of pending.values()) {
      if (call.sent || endpoint !== next) continue;
      post(call, next);
    }
  };

  const subscribeRemote = (method: string): void => {
    // обрыв порта уже отражён в onClosed, а attach подпишет заново
    control(method).catch(() => null);
  };

  const subscribe = (listener: EventListener): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1 && endpoint) subscribeRemote('events.subscribe');
    return () => {
      if (!listeners.delete(listener)) return;
      if (listeners.size === 0 && endpoint) {
        subscribeRemote('events.unsubscribe');
      }
    };
  };

  /** Закрывает только свой порт, не движок: `close()` из renderer не гасит хост. */
  const close = async (): Promise<void> => {
    disposed = true;
    const current = endpoint;
    endpoint = null;
    for (const [id, call] of pending) {
      pending.delete(id);
      call.reject(closedError());
    }
    current?.close();
  };

  const tree: Record<string, unknown> = {};
  for (const name of Object.keys(RPC_METHODS)) {
    const segments = name.split('.');
    const leaf = segments.pop();
    if (leaf === undefined) continue;
    let node = tree;
    for (const segment of segments) node = childOf(node, segment);
    node[leaf] = (...args: unknown[]) => request(name, args);
  }
  tree['subscribe'] = subscribe;
  tree['close'] = close;

  return { attach, engine: tree as unknown as LearningEngine };
};
