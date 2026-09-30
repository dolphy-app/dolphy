import type { ExtensionSettingsDto } from '@lms/engine-contract';

/**
 * Политика расширений: включены ли они и исполняются ли в изоляции. Решает по
 * происхождению расширения и настройке пользователя; состояние меняет `update`.
 */
export interface ExtensionPolicy {
  /** Не отключено пользователем; неизвестный id — включён. */
  isEnabled(id: string): boolean;
  /** Не из поставки и не доверено; неизвестный id — изолирован. */
  isIsolated(id: string): boolean;
  update(settings: ExtensionSettingsDto): void;
}
