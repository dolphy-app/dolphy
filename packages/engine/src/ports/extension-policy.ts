import type { ExtensionSettingsDto } from '@dolphy-app/engine-contract';

/**
 * Политика расширений: включены ли они и исполняются ли в изоляции. Решает по
 * происхождению расширения и настройке пользователя; состояние меняет `update`.
 */
export interface ExtensionPolicy {
  /** Не отключено пользователем; неизвестный id — включён. */
  isEnabled(id: string): boolean;
  /** Не из поставки и не доверено; неизвестный id — изолирован. */
  isIsolated(id: string): boolean;
  /**
   * Расписания расширения не выключены переключателем в строке (`schedulesOff`);
   * расширения из поставки и неизвестный id — включены. Отключённость самого
   * расширения проверяет `isEnabled`.
   */
  areSchedulesOn(id: string): boolean;
  /** Безопасный режим действует (флаг запуска или настройка): расширения не из поставки отключены. */
  safeMode(): boolean;
  update(settings: ExtensionSettingsDto): void;
}
