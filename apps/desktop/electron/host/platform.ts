import { EngineError } from '@dolphy-app/engine/app';
import type { PlatformServices } from '@dolphy-app/engine/ports';
import {
  PLATFORM_REQUEST_MS,
  isPlatformResponse,
} from '../../shared/platform.ts';
import type {
  PlatformRequest,
  PlatformResponse,
} from '../../shared/platform.ts';

export interface HostPlatformOptions {
  /** Отправка сообщения в main (`process.parentPort.postMessage`). */
  post(message: PlatformRequest): void;
  /** Срок ответа; по умолчанию `PLATFORM_REQUEST_MS`. */
  timeoutMs?: number;
}

export interface HostPlatform {
  /** Порт движка: шифр секретов и уведомления за каналом к main. */
  readonly services: PlatformServices;
  /** Сообщение от main; `true` — это ответ платформы и он обработан. */
  handleMessage(message: unknown): boolean;
  /** Хост завершается: ожидающие запросы отклоняются как `UNAVAILABLE`. */
  close(): void;
}

type PlatformBody = PlatformRequest extends infer R
  ? R extends unknown
    ? Omit<R, 'type' | 'id'>
    : never
  : never;

type Settle = {
  resolve(value: boolean | string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Сообщение отказа не содержит значений: оно может попасть в журнал. */
const unavailable = (reason: string): EngineError =>
  new EngineError('SECRETS_UNAVAILABLE', {
    message: 'System secret store is unavailable',
    details: { reason },
  });

/**
 * Адаптер порта `PlatformServices` для хоста движка: запрос уходит в main,
 * ответ ищется по `id`. Нет ответа за срок, закрытый хост или отказ main —
 * `SECRETS_UNAVAILABLE`.
 */
export const createHostPlatform = ({
  post,
  timeoutMs = PLATFORM_REQUEST_MS,
}: HostPlatformOptions): HostPlatform => {
  let nextId = 0;
  let closed = false;
  const pending = new Map<string, Settle>();

  const request = (body: PlatformBody): Promise<boolean | string> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(unavailable('closed'));
        return;
      }
      nextId += 1;
      const id = `p${nextId}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(unavailable('timeout'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        post({ type: 'platform-request', id, ...body } as PlatformRequest);
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(unavailable('closed'));
      }
    });

  const text = async (body: PlatformBody): Promise<string> => {
    const result = await request(body);
    if (typeof result !== 'string') throw unavailable('invalid-response');
    return result;
  };

  return {
    services: {
      // уведомление необязательно: отказ main, срок и закрытый хост — просто «не показано»
      notifier: {
        show: async ({ source, title, body }) => {
          try {
            return (
              (await request({ op: 'notify', source, title, body })) === true
            );
          } catch {
            return false;
          }
        },
      },
      cipher: {
        available: async () =>
          (await request({ op: 'cipher.available' })) === true,
        encrypt: (plaintext) => text({ op: 'cipher.encrypt', plaintext }),
        decrypt: (ciphertext) => text({ op: 'cipher.decrypt', ciphertext }),
      },
    },
    handleMessage: (message) => {
      if (!isPlatformResponse(message)) return false;
      const response: PlatformResponse = message;
      const entry = pending.get(response.id);
      if (entry === undefined) return true; // поздний ответ после срока
      pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(unavailable(response.code));
      return true;
    },
    close: () => {
      closed = true;
      for (const [id, entry] of [...pending]) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(unavailable('closed'));
      }
    },
  };
};
