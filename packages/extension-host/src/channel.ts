import type { ExtensionHostServices } from '@dolphy-app/engine/app';
import type { MessageEndpoint } from '@dolphy-app/engine-contract';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import { hostFailureOf } from './engine-link.ts';
import type { ExtensionCandidate } from './discover.ts';
import {
  hostRequestSchema,
  replaceExtensionsResultSchema,
} from './protocol.ts';
import type {
  ExtMessage,
  ExtResponse,
  HealthReport,
  HostRequest,
  HostResponse,
  ReplaceExtensionsResult,
  SettingChangedNotice,
} from './protocol.ts';

/** Срок ответа на `replaceExtensions`: регистрация расширений идёт параллельно, каждой до 10 с. */
export const REPLACE_DEADLINE_MS = 15_000;

export interface HostChannelOptions {
  logger: ExtensionLogger;
  /** Вызывается, когда вызов не уложился в дедлайн: синхронный цикл в расширении не прервать, хост надо перезапустить. */
  restart?: () => void;
  /** Сколько ждать первый `attach`. */
  connectTimeoutMs?: number;
  /** Текущие кандидаты: канал отправляет их хосту первым сообщением после каждого `attach`. */
  currentExtensions: () => readonly ExtensionCandidate[];
  /** Итог регистрации после `attach`: перезапущенный хост расширений сразу отдаёт движку свои вклады. */
  onRegistrations: (result: ReplaceExtensionsResult) => void;
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
  /**
   * Отправляет хосту кандидатов, ждёт регистрации (до `REPLACE_DEADLINE_MS`)
   * и возвращает итог по каждому расширению. Нет хоста, закрытие или срок —
   * ошибка.
   */
  replaceExtensions(
    candidates: readonly ExtensionCandidate[],
  ): Promise<ReplaceExtensionsResult>;
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

/** Сообщение хоста о здоровье; ответ `null`: у `undefined` через IPC теряется ключ `result`. */
const reportHealth = (
  services: ExtensionHostServices,
  report: HealthReport,
): null => {
  switch (report.kind) {
    case 'activated':
      services.health.activated(report.extensionId, report.durationMs);
      break;
    case 'failed':
      services.health.failed(report.extensionId, report.reason, report.message);
      break;
    case 'suppressed':
      services.health.suppressed(report.extensionId, report.until);
      break;
    default:
      services.health.reset(report.extensionId);
  }
  return null;
};

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
    case 'stats.streak':
      return services.stats.streak(extensionId, request.params.courseId);
    case 'stats.daily':
      return services.stats.daily(
        extensionId,
        request.params.from,
        request.params.to,
        request.params.courseId,
      );
    case 'secrets.get':
      return services.secrets.get(extensionId, request.params.key);
    case 'secrets.set':
      return services.secrets.set(
        extensionId,
        request.params.key,
        request.params.value,
      );
    case 'secrets.delete':
      return services.secrets.delete(extensionId, request.params.key);
    case 'notifications.show':
      return services.notifications.show(
        extensionId,
        request.params.title,
        request.params.body,
      );
    case 'health.report':
      return Promise.resolve(reportHealth(services, request.params));
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

  /** Отправляет запрос `target` и ждёт ответа не дольше дедлайна. */
  const send = <M extends ChannelMethod>(
    target: MessageEndpoint,
    method: M,
    params: ChannelParams<M>,
    deadlineMs: number,
    callOptions: CallOptions,
  ): Promise<ChannelOutcome> => {
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
  };

  /** Набор кандидатов хосту; итог регистрации каждого расширения. Нет ответа — ошибка. */
  const replaceVia = async (
    target: MessageEndpoint,
    candidates: readonly ExtensionCandidate[],
  ): Promise<ReplaceExtensionsResult> => {
    const outcome = await send(
      target,
      'replaceExtensions',
      { extensions: [...candidates] },
      REPLACE_DEADLINE_MS,
      {},
    );
    if (outcome.kind !== 'response' || !outcome.response.ok) {
      throw new Error(
        outcome.kind === 'response'
          ? 'extension host refused the extension set'
          : `extension host did not answer replaceExtensions (${outcome.kind})`,
      );
    }
    const parsed = replaceExtensionsResultSchema.safeParse(
      outcome.response.result,
    );
    if (!parsed.success) {
      throw new Error('extension host sent an invalid registration result');
    }
    return parsed.data as ReplaceExtensionsResult;
  };

  return {
    connected: () => endpoint !== null,

    attach(next) {
      closeEndpoint();
      endpoint = next;
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
      // перезапущенный хост (и новый порт после перезапуска любой стороны) сразу получает текущий набор
      replaceVia(next, options.currentExtensions()).then(
        options.onRegistrations,
        (error: unknown) => {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'extension registrations were not received',
          );
        },
      );
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
      return send(target, method, params, deadlineMs, callOptions);
    },

    async replaceExtensions(candidates) {
      const target = await awaitEndpoint();
      if (target === null) throw new Error('extension host is not connected');
      return replaceVia(target, candidates);
    },

    async close() {
      closed = true;
      closeEndpoint();
      for (const waiter of [...connectWaiters]) waiter(null);
    },
  };
};
