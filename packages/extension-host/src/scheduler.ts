import { EXTENSION_SCHEDULE_LIMITS } from '@dolphy-app/extension-api';
import type { ExtensionLogger } from '@dolphy-app/extension-api';
import type {
  ExtensionHealth,
  ExtensionPolicy,
} from '@dolphy-app/engine/ports';
import type { HostChannel } from './channel.ts';
import type { DiscoverySource } from './holder.ts';
import { isFault } from './protocol.ts';
import type { ResolvedSchedule } from './points/types.ts';

/**
 * Срок доставки одного срабатывания: ленивая активация, запуск ограниченного
 * процесса и обработчик (10 с). Больше раннера ограниченного процесса (12 с).
 */
export const SCHEDULE_DELIVERY_MS = 14_000;

const validAt = (
  moment: Date,
  hours: number,
  minutes: number,
): number | null =>
  moment.getHours() === hours && moment.getMinutes() === minutes
    ? moment.getTime()
    : null;

/**
 * Последний момент расписания `schedule` в `(cursor, now]`, не старше
 * `lateMs` от `now`; `null` — срабатывать нечему. Время — местное: `daily` в
 * `at`, `hourly` в начале часа. Местного времени, которого нет в этот день
 * (переход на летнее время), нет и срабатывания; повторяющийся час
 * срабатывает один раз (по первому вхождению).
 */
export const latestOccurrence = (
  schedule: Pick<ResolvedSchedule, 'every' | 'at'>,
  cursor: number,
  now: number,
  lateMs: number,
): number | null => {
  const earliest = Math.max(cursor, now - lateMs);
  const within = (moment: number | null): moment is number =>
    moment !== null &&
    moment <= now &&
    moment > cursor &&
    moment >= now - lateMs;
  if (schedule.every === 'hourly') {
    const base = new Date(now);
    const top =
      now -
      (base.getMinutes() * 60 + base.getSeconds()) * 1000 -
      base.getMilliseconds();
    const moment = new Date(top);
    return moment.getMinutes() === 0 && moment.getSeconds() === 0 && within(top)
      ? top
      : null;
  }
  const [hours = 0, minutes = 0] = (schedule.at ?? '').split(':').map(Number);
  // окно короче суток, но может пересекать полночь: смотрим сутки начала и конца
  const days = [new Date(earliest), new Date(now)];
  const found = days
    .map((day) =>
      validAt(
        new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          hours,
          minutes,
          0,
          0,
        ),
        hours,
        minutes,
      ),
    )
    .filter(within);
  return found.length === 0 ? null : Math.max(...found);
};

export interface SchedulerOptions {
  channel: HostChannel;
  /** Набор расширений движка: читается на каждом тике. */
  discovery: DiscoverySource;
  /** Отключённое расширение и расширение с выключенным переключателем «Расписание» не срабатывает; `isIsolated` — режим на каждую отправку. */
  policy: ExtensionPolicy;
  logger: ExtensionLogger;
  /** Часы планировщика, epoch ms; по умолчанию `Date.now`. */
  now?: () => number;
  /** Период проверки; по умолчанию `EXTENSION_SCHEDULE_LIMITS.tickMs`. */
  tickMs?: number;
  /** Срок доставки; по умолчанию `SCHEDULE_DELIVERY_MS`. */
  deliveryMs?: number;
  /** Сюда идут сбои обработчиков и просроченная доставка; без него не учитываются. */
  health?: Pick<ExtensionHealth, 'recordFailure'>;
}

export interface Scheduler {
  /**
   * Проверка за время с прошлой: запускает срабатывания, которые подошли, и
   * ждёт их доставки. Не бросает. Периодически её зовёт таймер планировщика.
   */
  tick(): Promise<void>;
  /** Останавливает таймер; доставка, уже идущая, не прерывается. */
  dispose(): void;
}

/**
 * Планировщик расписаний расширений (R12). Раз в `tickMs` смотрит, какие
 * срабатывания пришлись на время после прошлой проверки, и отправляет
 * `fireSchedule` (ленивая активация, как у событий). В памяти хранится только
 * курсор прошлой проверки: пока приложение закрыто или спит, ничего не
 * копится, а срабатывание, обнаруженное позже `lateMs`, пропускается и не
 * воспроизводится. Расширения и политика читаются на каждом тике, поэтому
 * отключение, безопасный режим и удаление действуют сразу. Расписание, чей
 * прошлый вызов ещё не вернулся, срабатывания не получает.
 */
export const createScheduler = (options: SchedulerOptions): Scheduler => {
  const { channel, discovery, policy, logger, health } = options;
  const now = options.now ?? Date.now;
  const deliveryMs = options.deliveryMs ?? SCHEDULE_DELIVERY_MS;
  const tickMs = options.tickMs ?? EXTENSION_SCHEDULE_LIMITS.tickMs;
  const lateMs = EXTENSION_SCHEDULE_LIMITS.lateMs;
  let cursor = now();
  /** `расширение/расписание` с идущей доставкой. */
  const inFlight = new Set<string>();
  /** Последний доставленный момент каждого расписания: тот же момент дважды не срабатывает. */
  const lastMoment = new Map<string, number>();

  const deliver = async (
    extensionId: string,
    scheduleId: string,
    moment: number,
  ): Promise<void> => {
    const outcome = await channel.call(
      'fireSchedule',
      { extensionId, scheduleId, isolated: policy.isIsolated(extensionId) },
      deliveryMs,
      { restart: false },
    );
    if (outcome.kind === 'response' && !outcome.response.ok) {
      const { cause, message } = outcome.response.error;
      if (isFault(cause)) health?.recordFailure(extensionId, cause, message);
      logger.warn(
        { extensionId, scheduleId, moment, cause, message },
        'extension schedule handler failed',
      );
    } else if (outcome.kind === 'timeout') {
      health?.recordFailure(
        extensionId,
        'timeout',
        'extension schedule delivery timed out',
      );
      logger.warn(
        { extensionId, scheduleId, moment },
        'extension schedule delivery timed out',
      );
    }
  };

  const tick = async (): Promise<void> => {
    try {
      const current = now();
      const previous = cursor;
      cursor = current;
      if (!channel.connected()) return;
      const deliveries: Promise<void>[] = [];
      for (const extension of discovery.get().extensions) {
        if (
          extension.schedules.length === 0 ||
          !policy.isEnabled(extension.id) ||
          !policy.areSchedulesOn(extension.id)
        ) {
          continue;
        }
        for (const schedule of extension.schedules) {
          const moment = latestOccurrence(schedule, previous, current, lateMs);
          if (moment === null) continue;
          const key = `${extension.id}/${schedule.id}`;
          if (lastMoment.get(key) === moment) continue;
          if (inFlight.has(key)) {
            logger.warn(
              { extensionId: extension.id, scheduleId: schedule.id, moment },
              'schedule handler is still running, the firing is skipped',
            );
            continue;
          }
          lastMoment.set(key, moment);
          inFlight.add(key);
          deliveries.push(
            deliver(extension.id, schedule.id, moment)
              .catch((error: unknown) =>
                logger.error(
                  { extensionId: extension.id, scheduleId: schedule.id, error },
                  'schedule delivery failed',
                ),
              )
              .finally(() => inFlight.delete(key)),
          );
        }
      }
      await Promise.all(deliveries);
    } catch (error) {
      logger.error({ error }, 'schedule check failed');
    }
  };

  const timer = setInterval(() => void tick(), tickMs);
  timer.unref();
  return { tick, dispose: () => clearInterval(timer) };
};
