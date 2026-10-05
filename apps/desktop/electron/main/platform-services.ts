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

/** Часть Electron `Notification`, которой пользуется обработчик. */
export interface NotificationLike {
  on(event: 'click' | 'close', listener: () => void): unknown;
  show(): void;
}

export interface NotificationOptionsLike {
  title: string;
  body: string;
  /** Только macOS: строка под названием. */
  subtitle?: string;
  silent: true;
}

export interface NotificationApiLike {
  isSupported(): boolean;
  create(options: NotificationOptionsLike): NotificationLike;
}

/**
 * `DOLPHY_NOTIFICATION_LOG=<файл>`: вместо вызова ОС в файл пишется строка
 * JSON `{ source, title, body }` на уведомление (e2e); в собранном
 * приложении не действует.
 */
export const notificationLogOf = (
  env: Readonly<Record<string, string | undefined>>,
  packaged: boolean,
): string | undefined => {
  if (packaged) return undefined;
  const path = env.DOLPHY_NOTIFICATION_LOG;
  return path === undefined || path === '' ? undefined : path;
};

export interface PlatformServicesDeps {
  safeStorage: SafeStorageLike;
  /** `app.isReady()`: до готовности приложения хранилище ключей недоступно. */
  isReady(): boolean;
  /** `process.platform`: на Linux режим `basic_text` небезопасен. */
  platform: NodeJS.Platform;
  fake?: FakeSafeStorage;
  logger: MainLogger;
  /** Электрон `Notification`; без него (и без `notificationLog`) уведомления не поддерживаются. */
  notifications?: NotificationApiLike;
  /** Клик по уведомлению: показать окно приложения. */
  showWindow?: () => void;
  /** Подмена показа для e2e: принимает уже собранную запись, ОС не вызывается. */
  notificationLog?: (entry: {
    source: string;
    title: string;
    body: string;
  }) => void;
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
  const { op, plaintext, ciphertext, source, title, body } = message as {
    op?: unknown;
    plaintext?: unknown;
    ciphertext?: unknown;
    source?: unknown;
    title?: unknown;
    body?: unknown;
  };
  const base = { type: 'platform-request', id: message.id } as const;
  if (op === 'cipher.available') return { ...base, op };
  if (op === 'cipher.encrypt' && typeof plaintext === 'string') {
    return { ...base, op, plaintext };
  }
  if (op === 'cipher.decrypt' && typeof ciphertext === 'string') {
    return { ...base, op, ciphertext };
  }
  if (
    op === 'notify' &&
    typeof source === 'string' &&
    typeof title === 'string' &&
    typeof body === 'string'
  ) {
    return { ...base, op, source, title, body };
  }
  return null;
};

/**
 * Обработчик запросов платформы в main: шифровальная машина без состояния и
 * показ системных уведомлений.
 * Зависимости внедряются (как у остальных оболочек), поэтому тестируется с
 * подменой `safeStorage`. В журнал попадают только операция и код отказа:
 * ни открытый текст, ни шифртекст, ни сообщения платформы туда не идут; текст
 * уведомлений в журнал тоже не пишется (он принадлежит расширению).
 */
export const createPlatformServices = ({
  safeStorage,
  isReady,
  platform,
  fake,
  logger,
  notifications,
  showWindow,
  notificationLog,
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

  // ссылка на показанное уведомление живёт до клика или закрытия: иначе сборщик мусора может убрать его раньше клика
  const live = new Set<NotificationLike>();
  const notify = (
    request: Extract<PlatformRequest, { op: 'notify' }>,
  ): boolean => {
    const { source, title, body } = request;
    if (notificationLog !== undefined) {
      notificationLog({ source, title, body });
      return true;
    }
    if (notifications === undefined || !notifications.isSupported()) {
      return false;
    }
    // имя расширения: подзаголовок на macOS, на остальных системах — последней строкой
    const shown =
      platform === 'darwin'
        ? { title, body, subtitle: source }
        : { title, body: body === '' ? source : `${body}\n${source}` };
    const notification = notifications.create({ ...shown, silent: true });
    live.add(notification);
    notification.on('click', () => {
      live.delete(notification);
      showWindow?.();
    });
    notification.on('close', () => void live.delete(notification));
    notification.show();
    return true;
  };

  const run = (request: PlatformRequest): boolean | string => {
    if (request.op === 'notify') return notify(request);
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
