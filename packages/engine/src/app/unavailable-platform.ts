import type { PlatformServices } from '../ports/index.ts';
import { EngineError } from './errors.ts';

const unavailable = (): never => {
  throw new EngineError('SECRETS_UNAVAILABLE', {
    message: 'No system secret store is available',
    details: { reason: 'no-platform' },
  });
};

/** Платформа без возможностей (CLI, тесты): хранилища ключей и уведомлений нет. */
export const createUnavailablePlatform = (): PlatformServices => ({
  cipher: {
    available: async () => false,
    encrypt: async () => unavailable(),
    decrypt: async () => unavailable(),
  },
  notifier: { show: async () => false },
});
