import { useI18n } from 'vue-i18n';
import { resolveLocalizedText } from '@dolphy-app/extension-api';
import type { LocalizedText } from '@dolphy-app/extension-api';

/** Подписи расширения на текущем языке окна. */
export interface ExtensionText {
  /** Подпись вклада или манифеста: строка как есть или текст языка окна (запасной — `en`). */
  of(text: LocalizedText): string;
  /** То же для необязательной подписи (`description` манифеста); `null` — подписи нет. */
  ofOptional(text: LocalizedText | null): string | null;
  /** Название расширения: `name` манифеста на языке окна или id. */
  nameOf(info: { id: string; name: LocalizedText | null }): string;
}

/**
 * Читает язык окна реактивно, поэтому вычисляемые значения пересчитываются
 * при его смене без запросов к движку.
 */
export const useExtensionText = (): ExtensionText => {
  const { locale } = useI18n();
  const of = (text: LocalizedText) => resolveLocalizedText(text, locale.value);
  return {
    of,
    ofOptional: (text) => (text === null ? null : of(text)),
    nameOf: (info) => (info.name === null ? info.id : of(info.name)),
  };
};
