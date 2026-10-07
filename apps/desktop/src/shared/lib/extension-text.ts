import { useI18n } from 'vue-i18n';
import { resolveLocalizedText } from '@dolphy-app/extension-api';
import type { LocalizedText } from '@dolphy-app/extension-api';

/** Подписи расширения на текущем языке окна. */
export interface ExtensionText {
  /** Подпись вклада: строка как есть или текст языка окна (запасной — `en`). */
  of(text: LocalizedText): string;
  /** Название расширения: `name` манифеста или id. */
  nameOf(info: { id: string; name: string | null }): string;
}

/**
 * Читает язык окна реактивно, поэтому вычисляемые значения пересчитываются
 * при его смене без запросов к движку.
 */
export const useExtensionText = (): ExtensionText => {
  const { locale } = useI18n();
  return {
    of: (text) => resolveLocalizedText(text, locale.value),
    nameOf: (info) => info.name ?? info.id,
  };
};
