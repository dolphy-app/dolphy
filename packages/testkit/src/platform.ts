import { EngineError } from '@dolphy-app/engine/app';
import type { PlatformServices } from '@dolphy-app/engine/ports';

export type FakePlatform = PlatformServices & {
  /** Хранилище ключей доступно (по умолчанию — да); шифртекст при смене не теряется. */
  setAvailable(available: boolean): void;
  /** Следующая расшифровка отказывает, как после смены связки ключей. */
  breakDecryption(): void;
  /** Сколько раз шифровали и расшифровывали. */
  readonly calls: () => { encrypt: number; decrypt: number };
};

const PREFIX = 'fake:';

/**
 * Платформа в памяти: шифр обратимый (сдвиг и base64, открытого текста в
 * шифртексте нет), доступность переключается. Отказы — `SECRETS_UNAVAILABLE`,
 * как у адаптера хоста движка.
 */
export const createFakePlatform = (): FakePlatform => {
  let available = true;
  let broken = false;
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
