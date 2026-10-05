import { EngineError } from '@dolphy-app/engine/app';
import type {
  PlatformNotification,
  PlatformServices,
} from '@dolphy-app/engine/ports';

export type FakePlatform = PlatformServices & {
  /** Хранилище ключей доступно (по умолчанию — да); шифртекст при смене не теряется. */
  setAvailable(available: boolean): void;
  /** Следующая расшифровка отказывает, как после смены связки ключей. */
  breakDecryption(): void;
  /** Сколько раз шифровали и расшифровывали. */
  readonly calls: () => { encrypt: number; decrypt: number };
  /** Системные уведомления поддерживаются (по умолчанию — да); иначе `show` даёт `false`. */
  setNotificationsSupported(supported: boolean): void;
  /** Показанные уведомления по порядку. */
  readonly notifications: () => readonly PlatformNotification[];
};

const PREFIX = 'fake:';

/**
 * Платформа в памяти: шифр обратимый (сдвиг и base64, открытого текста в
 * шифртексте нет), доступность переключается. Уведомления копятся в `notifications()`. Отказы шифра — `SECRETS_UNAVAILABLE`,
 * как у адаптера хоста движка.
 */
export const createFakePlatform = (): FakePlatform => {
  let available = true;
  let broken = false;
  let notificationsSupported = true;
  const shown: PlatformNotification[] = [];
  const calls = { encrypt: 0, decrypt: 0 };
  const unavailable = () =>
    new EngineError('SECRETS_UNAVAILABLE', {
      message: 'System secret store is unavailable',
    });
  return {
    setAvailable: (value) => {
      available = value;
    },
    breakDecryption: () => {
      broken = true;
    },
    calls: () => ({ ...calls }),
    setNotificationsSupported: (supported) => {
      notificationsSupported = supported;
    },
    notifications: () => [...shown],
    notifier: {
      show: async (notification) => {
        if (!notificationsSupported) return false;
        shown.push(notification);
        return true;
      },
    },
    cipher: {
      available: async () => available,
      encrypt: async (plaintext) => {
        if (!available) throw unavailable();
        calls.encrypt += 1;
        return Buffer.from(
          Buffer.from(PREFIX + plaintext).map((byte) => byte ^ 0x5a),
        ).toString('base64');
      },
      decrypt: async (ciphertext) => {
        if (!available || broken) throw unavailable();
        calls.decrypt += 1;
        return Buffer.from(
          Buffer.from(ciphertext, 'base64').map((byte) => byte ^ 0x5a),
        )
          .toString()
          .slice(PREFIX.length);
      },
    },
  };
};
