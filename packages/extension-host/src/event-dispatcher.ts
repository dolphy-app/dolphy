import type { LearningEvent } from '@dolphy-app/engine-contract';
import type {
  ExtensionHealth,
  ExtensionPolicy,
} from '@dolphy-app/engine/ports';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type { HostChannel } from './channel.ts';
import type { ResolvedExtension } from './discover.ts';
import type { DiscoverySource } from './holder.ts';
import { isFault } from './protocol.ts';

/** Сколько событий ждёт доставки одного расширения; при переполнении отбрасываются самые старые. */
export const EVENT_QUEUE_LIMIT = 100;

/**
 * Срок доставки одного события, сверх которого движок его не ждёт; сам
 * обработчик хост ограничивает двумя секундами (`EVENT_HANDLER_MS`).
 */
export const EVENT_DELIVERY_MS = 10_000;

export interface EventDispatcherOptions {
  channel: HostChannel;
  /** Набор расширений движка: читается при каждом событии и перед каждой отправкой. */
  discovery: DiscoverySource;
  /** Отключённое расширение событий не получает. */
  policy: ExtensionPolicy;
  logger: ExtensionLogger;
  queueLimit?: number;
  deliveryMs?: number;
  /** Сюда идут сбои обработчиков и просроченная доставка; без него не учитываются. */
  health?: Pick<ExtensionHealth, 'recordFailure'>;
}

export interface EventDispatcher {
  /** Ставит событие в очередь каждого подходящего расширения; не бросает и не ждёт расширения. */
  dispatch(event: LearningEvent): void;
}

interface Queue {
  items: LearningEvent[];
  draining: boolean;
}

/**
 * Доставка событий обучения расширениям (R6). Приёмник движка отдаёт все
 * события; здесь остаются только те, что объявлены расширением с разрешением
 * `learning.events`. Очередь у каждого расширения своя: доставка по порядку,
 * не более одного раза (событие не повторяется ни после сбоя, ни после
 * перезапуска хоста), слабый обработчик не задерживает другие расширения.
 * Сбой, таймаут и отсутствие хоста событие только теряют — перезапуск хоста
 * не взводится.
 */
export const createEventDispatcher = (
  options: EventDispatcherOptions,
): EventDispatcher => {
  const { channel, discovery, policy, logger, health } = options;
  const queueLimit = options.queueLimit ?? EVENT_QUEUE_LIMIT;
  const deliveryMs = options.deliveryMs ?? EVENT_DELIVERY_MS;
  const queues = new Map<string, Queue>();

  /** Расширение по-прежнему должно получать это событие: есть, включено, подписалось. */
  const subscriber = (
    extensionId: string,
    name: LearningEvent['name'],
  ): ResolvedExtension | undefined => {
    const extension = discovery
      .get()
      .extensions.find(({ id }) => id === extensionId);
    return extension !== undefined &&
      policy.isEnabled(extension.id) &&
      extension.events.includes(name)
      ? extension
      : undefined;
  };

  const drain = async (extensionId: string, queue: Queue): Promise<void> => {
    queue.draining = true;
    try {
      for (
        let event = queue.items.shift();
        event;
        event = queue.items.shift()
      ) {
        // отключение, удаление и обновление расширения, как и потеря хоста, отбрасывают накопленное
        if (subscriber(extensionId, event.name) === undefined) {
          queue.items.length = 0;
          return;
        }
        if (!channel.connected()) {
          queue.items.length = 0;
          logger.debug({ extensionId }, 'extension host is down, events lost');
          return;
        }
        const outcome = await channel.call(
          'deliverEvent',
          {
            extensionId,
            name: event.name,
            payload: event.payload,
          },
          deliveryMs,
          { restart: false },
        );
        if (outcome.kind === 'response' && !outcome.response.ok) {
          if (isFault(outcome.response.error.cause)) {
            health?.recordFailure(
              extensionId,
              outcome.response.error.cause,
              outcome.response.error.message,
            );
          }
          logger.warn(
            {
              extensionId,
              event: event.name,
              cause: outcome.response.error.cause,
              message: outcome.response.error.message,
            },
            'extension event handler failed',
          );
        } else if (outcome.kind === 'timeout') {
          health?.recordFailure(
            extensionId,
            'timeout',
            'extension event delivery timed out',
          );
          logger.warn(
            { extensionId, event: event.name },
            'extension event delivery timed out',
          );
        }
      }
    } finally {
      queue.draining = false;
      if (queue.items.length === 0) queues.delete(extensionId);
    }
  };

  const enqueue = (extensionId: string, event: LearningEvent): void => {
    let queue = queues.get(extensionId);
    if (queue === undefined) {
      queue = { items: [], draining: false };
      queues.set(extensionId, queue);
    }
    queue.items.push(event);
    if (queue.items.length > queueLimit) {
      const dropped = queue.items.shift();
      logger.warn(
        { extensionId, event: dropped?.name, limit: queueLimit },
        'extension event queue overflow, the oldest event is dropped',
      );
    }
    if (!queue.draining) {
      void drain(extensionId, queue).catch((error: unknown) =>
        logger.error({ extensionId, error }, 'event delivery failed'),
      );
    }
  };

  return {
    dispatch(event) {
      try {
        if (!channel.connected()) return;
        for (const { id } of discovery.get().extensions) {
          if (subscriber(id, event.name) !== undefined) enqueue(id, event);
        }
      } catch (error) {
        logger.error({ error }, 'event dispatch failed');
      }
    },
  };
};
