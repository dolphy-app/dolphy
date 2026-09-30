import type { MessageEndpoint } from '@lms/engine-contract';
import type { ExtensionLogger } from '@lms/extension-api';
import type { ExtRequest, ExtResponse } from './protocol.ts';

export interface HostChannelOptions {
  logger: ExtensionLogger;
  /** Вызывается, когда вызов не уложился в дедлайн: синхронный цикл в расширении не прервать, хост надо перезапустить. */
  restart?: () => void;
  /** Сколько ждать первый `attach`. */
  connectTimeoutMs?: number;
}

export type ChannelOutcome =
  | { kind: 'response'; response: ExtResponse }
  | { kind: 'closed' }
  | { kind: 'timeout' }
  | { kind: 'no-host' };

export type ChannelMethod = ExtRequest['method'];

export type ChannelParams<M extends ChannelMethod> = Extract<
  ExtRequest,
  { method: M }
>['params'];

/**
 * Общий транспорт клиентов хоста расширений: endpoint, ожидание подключения,
 * ожидающие запросы с дедлайнами, закрытие. Клиенты сводят `ChannelOutcome`
 * к своим портам.
 */
export interface HostChannel {
  /** Закрывает предыдущий endpoint; ожидающие запросы завершаются как при закрытии. */
  attach(endpoint: MessageEndpoint): void;
  call<M extends ChannelMethod>(
    method: M,
    params: ChannelParams<M>,
    deadlineMs: number,
  ): Promise<ChannelOutcome>;
  close(): Promise<void>;
}

interface Pending {
  settle(outcome: ChannelOutcome): void;
}

const isResponse = (value: unknown): value is ExtResponse =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { ok?: unknown }).ok === 'boolean';

export const createHostChannel = (options: HostChannelOptions): HostChannel => {
  const { logger } = options;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;

  let nextId = 0;
  let endpoint: MessageEndpoint | null = null;
  let closed = false;
  const pending = new Map<string, Pending>();
  const connectWaiters = new Set<(endpoint: MessageEndpoint | null) => void>();

  const dropEndpoint = (dropped: MessageEndpoint): void => {
    if (endpoint !== dropped) return;
    endpoint = null;
    for (const entry of [...pending.values()]) entry.settle({ kind: 'closed' });
  };

  const closeEndpoint = (): void => {
    const current = endpoint;
    if (current === null) return;
    current.close();
    dropEndpoint(current);
  };

  const awaitEndpoint = (): Promise<MessageEndpoint | null> => {
    if (endpoint !== null) return Promise.resolve(endpoint);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const slot: { timer?: ReturnType<typeof setTimeout> } = {};
      const done = (value: MessageEndpoint | null): void => {
        clearTimeout(slot.timer);
        connectWaiters.delete(done);
        resolve(value);
      };
      slot.timer = setTimeout(() => done(null), connectTimeoutMs);
      connectWaiters.add(done);
    });
  };

  return {
    attach(next) {
      closeEndpoint();
      endpoint = next;
      next.onMessage((message) => {
        if (endpoint !== next) return;
        if (!isResponse(message)) {
          logger.warn({}, 'invalid extension host response ignored');
          return;
        }
        pending
          .get(message.id)
          ?.settle({ kind: 'response', response: message });
      });
      next.onClose(() => dropEndpoint(next));
      for (const waiter of [...connectWaiters]) waiter(next);
    },

    async call(method, params, deadlineMs) {
      const target = await awaitEndpoint();
      if (target === null) return { kind: 'no-host' };
      const id = String(nextId++);
      return new Promise<ChannelOutcome>((resolve) => {
        const slot: { timer?: ReturnType<typeof setTimeout> } = {};
        const settle = (outcome: ChannelOutcome): void => {
          clearTimeout(slot.timer);
          pending.delete(id);
          resolve(outcome);
        };
        slot.timer = setTimeout(() => {
          settle({ kind: 'timeout' });
          options.restart?.();
        }, deadlineMs);
        pending.set(id, { settle });
        target.post({ id, method, params } as ExtRequest);
      });
    },

    async close() {
      closed = true;
      closeEndpoint();
      for (const waiter of [...connectWaiters]) waiter(null);
    },
  };
};
