/**
 * Шифр секретов расширений: оболочка приложения отдаёт системное хранилище
 * ключей (Electron `safeStorage` в main). Без состояния: шифртекст хранит
 * движок (`ExtensionDataStore.secrets`).
 *
 * Шифртекст — строка base64. `encrypt` и `decrypt` отклоняются
 * `EngineError('SECRETS_UNAVAILABLE')`, если хранилища нет, оно небезопасно
 * или не расшифровало значение (связка ключей сменилась); каждый вызов
 * ограничен сроком ответа оболочки.
 */
export interface SecretCipher {
  /** Хранилище ключей есть и ему можно доверять (на Linux — не `basic_text`, и приложение готово). */
  available(): Promise<boolean>;
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

/** Системное уведомление, уже проверенное движком: чистый текст в пределах длин. */
export interface PlatformNotification {
  /** Название расширения: уведомление называет, кто его показал. */
  readonly source: string;
  readonly title: string;
  readonly body: string;
}

/**
 * Системные уведомления оболочки (Electron `Notification` в main). Лимиты,
 * длины и переключатель проверяет движок, оболочка только показывает.
 */
export interface Notifier {
  /**
   * `true` — уведомление передано системе; `false` — система уведомления не
   * поддерживает или оболочка не ответила (не бросает: уведомление
   * необязательно).
   */
  show(notification: PlatformNotification): Promise<boolean>;
}

/**
 * Возможности платформы, которых у движка нет: они живут в main Electron.
 * По умолчанию (CLI, тесты) — `createUnavailablePlatform()`: хранилища ключей
 * нет, уведомления не поддерживаются.
 */
export interface PlatformServices {
  readonly cipher: SecretCipher;
  readonly notifier: Notifier;
}
