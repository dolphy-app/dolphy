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

/**
 * Возможности платформы, которых у движка нет: они живут в main Electron.
 * По умолчанию (CLI, тесты) — `createUnavailablePlatform()`: хранилища ключей
 * нет.
 */
export interface PlatformServices {
  readonly cipher: SecretCipher;
}
