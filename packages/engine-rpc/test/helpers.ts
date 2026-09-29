import { RPC_METHODS } from '@lms/engine-contract';
import type {
  EngineEvent,
  LearningEngine,
  MessageEndpoint,
  RpcRequest,
  RpcResponse,
} from '@lms/engine-contract';

export type Method = (...args: never[]) => Promise<unknown>;

export interface FakeEngine {
  readonly engine: LearningEngine;
  /** Имена вызванных методов по порядку. */
  readonly calls: string[];
  emit(event: EngineEvent): void;
  listenerCount(): number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Полное дерево методов из `RPC_METHODS`; `overrides` заменяют конкретные методы. */
export const createFakeEngine = (
  overrides: Record<string, Method> = {},
): FakeEngine => {
  const calls: string[] = [];
  const listeners = new Set<(event: EngineEvent) => void>();
  const tree: Record<string, unknown> = {};

  for (const name of Object.keys(RPC_METHODS)) {
    const segments = name.split('.');
    const leaf = segments.pop() ?? name;
    let node = tree;
    for (const segment of segments) {
      const next = node[segment];
      if (isRecord(next)) node = next;
      else {
        const created: Record<string, unknown> = {};
        node[segment] = created;
        node = created;
      }
    }
    const override = overrides[name] as
      ((...args: unknown[]) => Promise<unknown>) | undefined;
    node[leaf] = async (...args: unknown[]) => {
      calls.push(name);
      if (override) return override(...args);
      if (name === 'diagnostics') return { engineVersion: 'fake-1' };
      return { method: name, args };
    };
  }
  tree['subscribe'] = (listener: (event: EngineEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  tree['close'] = async () => undefined;

  return {
    engine: tree as unknown as LearningEngine,
    calls,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
  };
};

export const tick = (ms = 0): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

/** Сырой клиент: шлёт `RpcRequest` и собирает всё, что пришло. */
export const createRawClient = (endpoint: MessageEndpoint) => {
  const inbox: unknown[] = [];
  const waiting = new Map<string, (response: RpcResponse) => void>();
  endpoint.onMessage((message) => {
    inbox.push(message);
    if (isRecord(message) && typeof message['id'] === 'string') {
      waiting.get(message['id'])?.(message as unknown as RpcResponse);
    }
  });
  let counter = 0;
  const call = (method: string, params?: unknown): Promise<RpcResponse> =>
    new Promise((resolve) => {
      const id = `raw-${counter++}`;
      waiting.set(id, resolve);
      const request: RpcRequest =
        params === undefined ? { id, method } : { id, method, params };
      endpoint.post(request);
    });
  return { call, inbox };
};
