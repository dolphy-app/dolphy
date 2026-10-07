import { RPC_METHODS } from '@dolphy-app/engine-contract';
import type { EngineEvent, LearningEngine } from '@dolphy-app/engine-contract';

export type FakeMethod = (...args: never[]) => Promise<unknown>;

type Leaf = (...args: never[]) => unknown;

interface Tree {
  [key: string]: Tree | Leaf;
}

export interface FakeEngine {
  readonly engine: LearningEngine;
  /** Имена вызванных методов по порядку. */
  readonly calls: string[];
  emit(event: EngineEvent): void;
  listenerCount(): number;
  /** Завершается после следующих `count` вызовов `subscribe` (по умолчанию одного). */
  subscribed(count?: number): Promise<void>;
}

const childOf = (node: Tree, segment: string): Tree => {
  const existing = node[segment];
  if (typeof existing === 'function') {
    throw new Error(`'${segment}' is a method and a namespace at once`);
  }
  if (existing !== undefined) return existing;
  const created: Tree = {};
  node[segment] = created;
  return created;
};

/** Полное дерево методов из `RPC_METHODS`; ответ — `{ method, args }`, `overrides` заменяют методы. */
export const createFakeEngine = (
  overrides: Record<string, FakeMethod> = {},
): FakeEngine => {
  const calls: string[] = [];
  const listeners = new Set<(event: EngineEvent) => void>();
  const waiters: { left: number; resolve: () => void }[] = [];
  const tree: Tree = {};

  for (const name of Object.keys(RPC_METHODS)) {
    const segments = name.split('.');
    const leaf = segments.pop() ?? name;
    let node = tree;
    for (const segment of segments) node = childOf(node, segment);
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
    for (const waiter of [...waiters]) {
      waiter.left--;
      if (waiter.left > 0) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
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
    subscribed: (count = 1) =>
      new Promise<void>((resolve) => {
        waiters.push({ left: count, resolve });
      }),
  };
};
