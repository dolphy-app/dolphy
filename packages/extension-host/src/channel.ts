import type { ExtensionHostServices } from '@dolphy-app/engine/app';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import { hostFailureOf } from './engine-link.ts';
import type { ResolvedExtension } from './discover.ts';
import { hostRequestSchema } from './protocol.ts';
import type {
  ExtMessage,
  ExtResponse,
  HostRequest,
  HostResponse,
  SettingChangedNotice,
} from './protocol.ts';

export interface HostChannelOptions {
  logger: ExtensionLogger;
  /** Вызывается, когда вызов не уложился в дедлайн: синхронный цикл в расширении не прервать, хост надо перезапустить. */
  restart?: () => void;
  /** Сколько ждать первый `attach`. */
  connectTimeoutMs?: number;
  /**
   * Набор расширений, который канал отправляет хосту первым сообщением после
   * каждого `attach`, до любых вызовов: перезапущенный хост расширений
   * (и новый порт после перезапуска любой стороны) сразу получает текущий
   * набор движка.
   */
  currentExtensions?: () => readonly ResolvedExtension[];
}

export type ChannelOutcome =
  | { kind: 'response'; response: ExtResponse }
  | { kind: 'closed' }
  | { kind: 'timeout' }
  | { kind: 'no-host' };

export type ChannelMethod = ExtMessage['method'];

export type ChannelParams<M extends ChannelMethod> = Extract<
  ExtMessage,
  { method: M }
>['params'];

/** Поведение одного вызова сверх метода и параметров. */
export interface CallOptions {
  /** false — по истечении дедлайна хост не перезапускается (события и прочий best-effort трафик); по умолчанию true. */
  restart?: boolean;
}

/**
 * Общий транспорт клиентов хоста расширений: endpoint, ожидание подключения,
 * ожидающие запросы с дедлайнами, закрытие. Клиенты сводят `ChannelOutcome`
 * к своим портам. Канал двусторонний: хост тоже может обращаться к движку
 * (`serve`).
 */
export interface HostChannel {
  /** Закрывает предыдущий endpoint; ожидающие запросы завершаются как при закрытии. */
  attach(endpoint: MessageEndpoint): void;
  /** Хост подключён сейчас; `call` в противном случае ждёт подключения. */
  connected(): boolean;
  call<M extends ChannelMethod>(
    method: M,
    params: ChannelParams<M>,
    deadlineMs: number,
    options?: CallOptions,
  ): Promise<ChannelOutcome>;
  /** Сообщение без ответа; хост не подключён — теряется (хост при активации читает актуальное состояние сам). */
  notify(notice: SettingChangedNotice): void;
  /**
   * Сервисы движка, которыми канал отвечает на запросы хоста (`storage.*`,
   * `settings.all`); `null` — запросы отклоняются с `UNAVAILABLE`. Движок
   * создаётся после канала, поэтому сервисы подключаются отдельным вызовом.
   */
  serve(services: ExtensionHostServices | null): void;
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

const isHostRequest = (
  value: unknown,
): value is { id: string; method: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { method?: unknown }).method === 'string';

const callService = (
  services: ExtensionHostServices,
  request: HostRequest,
): Promise<unknown> => {
  const { extensionId } = request.params;
  switch (request.method) {
    case 'storage.get':
      return services.storage.get(extensionId, request.params.key);
    case 'storage.set':
      return services.storage.set(
        extensionId,
        request.params.key,
        request.params.value,
      );
    case 'storage.delete':
      return services.storage.delete(extensionId, request.params.key);
    case 'storage.keys':
      return services.storage.keys(extensionId);
    default:
      return services.settings.all(extensionId);
  }
};

export const createHostChannel = (options: HostChannelOptions): HostChannel => {
  const { logger } = options;
  const connectTimeoutMs = options.connectTimeoutMs ?? 10_000;

  let nextId = 0;
  let endpoint: MessageEndpoint | null = null;
  let closed = false;
  let services: ExtensionHostServices | null = null;
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

  /** Отвечает на запрос хоста сервисами движка; отказ сервиса уходит хосту, а не роняет канал. */
  const serveHostRequest = async (
    target: MessageEndpoint,
    message: { id: string },
  ): Promise<void> => {
    const reply = (response: HostResponse): void => {
      if (endpoint === target) target.post(response);
    };
    const parsed = hostRequestSchema.safeParse(message);
    if (!parsed.success) {
      logger.warn({}, 'invalid extension host request ignored');
      reply({
        id: message.id,
        ok: false,
        error: {
          code: 'INVALID_ARGUMENT',
          message: 'invalid extension host request',
        },
      });
      return;
    }
    const request = parsed.data as HostRequest;
    if (services === null) {
      reply({
        id: request.id,
        ok: false,
        error: {
          code: 'UNAVAILABLE',
          message: 'extension state is not available',
        },
      });
      return;
    }
    try {
      reply({
        id: request.id,
        ok: true,
        result: await callService(services, request),
      });
    } catch (error) {
      reply({ id: request.id, ok: false, error: hostFailureOf(error) });
    }
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
    connected: () => endpoint !== null,

    attach(next) {
      closeEndpoint();
      endpoint = next;
      if (options.currentExtensions !== undefined) {
        // ответ не нужен: у приветствия нет ожидающего вызова, `onMessage` его пропустит
        next.post({
          id: `attach-${nextId++}`,
          method: 'replaceExtensions',
          params: { extensions: [...options.currentExtensions()] },
        } satisfies ExtMessage);
      }
      next.onMessage((message) => {
        if (endpoint !== next) return;
        if (isHostRequest(message)) {
          void serveHostRequest(next, message);
          return;
        }
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

    notify(notice) {
      endpoint?.post(notice);
    },

    serve(next) {
      services = next;
    },

    async call(method, params, deadlineMs, callOptions = {}) {
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
          if (callOptions.restart !== false) options.restart?.();
        }, deadlineMs);
        pending.set(id, { settle });
        target.post({ id, method, params } as ExtMessage);
      });
    },

    async close() {
      closed = true;
      closeEndpoint();
      for (const waiter of [...connectWaiters]) waiter(null);
    },
  };
};
