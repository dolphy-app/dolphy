import type {
  PlatformFailureCode,
  PlatformRequest,
  PlatformResponse,
} from '../../shared/platform.ts';
import type { MainLogger } from './logger.ts';

/** Часть Electron `safeStorage`, которой пользуется обработчик. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Только Linux, после готовности приложения. */
  getSelectedStorageBackend?(): string;
}

/**
 * Подмена хранилища ключей для e2e и смоука (`DOLPHY_FAKE_SAFE_STORAGE`):
 * настоящая связка ключей в CI недоступна, а на macOS спрашивает пароль.
 * `cipher` — обратимый, но не открытый текст; `unavailable` — хранилища нет.
 */
export type FakeSafeStorage = 'cipher' | 'unavailable';

/** `DOLPHY_FAKE_SAFE_STORAGE`: `1` — обратимый шифр, `unavailable` — хранилища нет; в собранном приложении не действует. */
export const fakeSafeStorageOf = (
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): FakeSafeStorage | undefined => {
  const value = packaged ? undefined : env.DOLPHY_FAKE_SAFE_STORAGE;
  if (value === '1') return 'cipher';
  return value === 'unavailable' ? 'unavailable' : undefined;
};

export interface PlatformServicesDeps {
  safeStorage: SafeStorageLike;
  /** `app.isReady()`: до готовности приложения хранилище ключей недоступно. */
  isReady(): boolean;
  /** `process.platform`: на Linux режим `basic_text` небезопасен. */
  platform: NodeJS.Platform;
  fake?: FakeSafeStorage;
  logger: MainLogger;
}

export interface PlatformServicesHandler {
  /** Ответ на `platform-request`; не запрос платформы — `null`. */
  handle(message: unknown): Promise<PlatformResponse | null>;
}

const FAKE_MASK = 0x5a;
const FAKE_PREFIX = 'fake:';

/** Обратимый шифр подмены: байты со сдвигом маски, чтобы в `engine.db` не лежал открытый текст. */
const fakeEncrypt = (plain: string): string =>
  Buffer.from(
    Buffer.from(FAKE_PREFIX + plain).map((byte) => byte ^ FAKE_MASK),
  ).toString('base64');

const fakeDecrypt = (cipher: string): string => {
  const text = Buffer.from(
    Buffer.from(cipher, 'base64').map((byte) => byte ^ FAKE_MASK),
  ).toString();
  if (!text.startsWith(FAKE_PREFIX)) throw new Error('not decryptable');
  return text.slice(FAKE_PREFIX.length);
};

const isRequest = (message: unknown): message is { id: string } =>
  typeof message === 'object' &&
  message !== null &&
  (message as { type?: unknown }).type === 'platform-request' &&
  typeof (message as { id?: unknown }).id === 'string';

/** Форма запроса по операции; значения проверяются только на тип. */
const shapeOf = (message: { id: string }): PlatformRequest | null => {
  const { op, plaintext, ciphertext } = message as {
    op?: unknown;
    plaintext?: unknown;
    ciphertext?: unknown;
  };
  const base = { type: 'platform-request', id: message.id } as const;
  if (op === 'cipher.available') return { ...base, op };
  if (op === 'cipher.encrypt' && typeof plaintext === 'string') {
    return { ...base, op, plaintext };
  }
  if (op === 'cipher.decrypt' && typeof ciphertext === 'string') {
    return { ...base, op, ciphertext };
  }
  return null;
};

/**
 * Обработчик запросов платформы в main: шифровальная машина без состояния.
 * Зависимости внедряются (как у остальных оболочек), поэтому тестируется с
 * подменой `safeStorage`. В журнал попадают только операция и код отказа:
 * ни открытый текст, ни шифртекст, ни сообщения платформы туда не идут.
 */
export const createPlatformServices = ({
  safeStorage,
  isReady,
  platform,
  fake,
  logger,
}: PlatformServicesDeps): PlatformServicesHandler => {
  const available = (): boolean => {
    if (!isReady()) return false;
    if (fake !== undefined) return fake === 'cipher';
    if (!safeStorage.isEncryptionAvailable()) return false;
    // на Linux без менеджера секретов Chromium шифрует фиксированным паролем: это не защита
    return !(
      platform === 'linux' &&
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    );
  };

  const run = (request: PlatformRequest): boolean | string => {
    if (request.op === 'cipher.available') return available();
    if (!available()) throw new Error('unavailable');
    if (request.op === 'cipher.encrypt') {
      return fake !== undefined
        ? fakeEncrypt(request.plaintext)
        : safeStorage.encryptString(request.plaintext).toString('base64');
    }
    return fake !== undefined
      ? fakeDecrypt(request.ciphertext)
      : safeStorage.decryptString(Buffer.from(request.ciphertext, 'base64'));
  };

  const failure = (
    id: string,
    code: PlatformFailureCode,
  ): PlatformResponse => ({
    type: 'platform-response',
    id,
    ok: false,
    code,
  });

  return {
    handle: async (message) => {
      if (!isRequest(message)) return null;
      const request = shapeOf(message);
      if (request === null) {
        logger.warn({}, 'invalid platform request');
        return failure(message.id, 'INVALID');
      }
      try {
        return {
          type: 'platform-response',
          id: request.id,
          ok: true,
          result: run(request),
        };
      } catch {
        // сообщение исключения не логируется: оно может нести данные запроса
        logger.warn({ op: request.op }, 'platform request failed');
        return failure(request.id, 'UNAVAILABLE');
      }
    },
  };
};
