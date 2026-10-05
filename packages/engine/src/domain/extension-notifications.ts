/**
 * Системные уведомления расширений: пределы, очистка текста и скользящие
 * окна частоты. Проверяет движок, а не оболочка и не процесс расширения.
 */

/** Совпадает с `EXTENSION_NOTIFICATION_LIMITS` пакета `extension-api` (движок от него не зависит). */
export const EXTENSION_NOTIFICATION_LIMITS = Object.freeze({
  /** Длина названия в символах (кодовых точках). */
  titleLength: 80,
  /** Длина текста в символах (кодовых точках). */
  bodyLength: 300,
  /** Уведомлений в скользящую минуту на расширение. */
  perMinute: 3,
  /** Уведомлений в скользящий час на расширение. */
  perHour: 30,
});

export type NotificationWindow = 'minute' | 'hour';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Управляющие символы C0/C1 (кроме перевода строки), разделители строк и абзацев, символы направления текста. */
const CONTROL =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/**
 * Чистый текст уведомления: управляющие символы и символы направления
 * удалены, переводы строки приведены к `\n` (в названии заменены пробелом),
 * края обрезаны.
 */
export const sanitizeNotificationText = (
  text: string,
  { multiline }: { multiline: boolean },
): string => {
  const unified = text.replace(/\r\n?/gu, '\n').replace(/\t/gu, ' ');
  const flat = multiline ? unified : unified.replace(/\n/gu, ' ');
  return flat.replace(CONTROL, '').trim();
};

/** Длина в символах (кодовых точках), как её видит автор. */
export const textLength = (text: string): number => {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
};

export interface NotificationRateLimiter {
  /**
   * Учитывает показ в момент `now`; `null` — можно, иначе окно, в котором
   * предел исчерпан (показ не учитывается).
   */
  take(extensionId: string, now: number): NotificationWindow | null;
}

/**
 * Скользящие окна в памяти: минута и час на расширение. Состояние живёт,
 * пока жив движок: уведомления работают, только пока приложение запущено.
 */
export const createNotificationRateLimiter = (): NotificationRateLimiter => {
  const shown = new Map<string, number[]>();
  return {
    take: (extensionId, now) => {
      const recent = (shown.get(extensionId) ?? []).filter(
        (at) => now - at < HOUR_MS,
      );
      const lastMinute = recent.filter((at) => now - at < MINUTE_MS).length;
      let exhausted: NotificationWindow | null = null;
      if (lastMinute >= EXTENSION_NOTIFICATION_LIMITS.perMinute) {
        exhausted = 'minute';
      } else if (recent.length >= EXTENSION_NOTIFICATION_LIMITS.perHour) {
        exhausted = 'hour';
      }
      if (exhausted === null) recent.push(now);
      if (recent.length === 0) shown.delete(extensionId);
      else shown.set(extensionId, recent);
      return exhausted;
    },
  };
};
