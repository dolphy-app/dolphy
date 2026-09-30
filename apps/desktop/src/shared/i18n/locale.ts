import type { LocaleMode } from '@lms/engine-contract';

export const LOCALES = ['ru', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];

/** Язык, на который переходим, если системный не поддерживается. */
export const FALLBACK_LOCALE: AppLocale = 'en';

/**
 * Режим из настроек → язык интерфейса. `system` берёт основной подтег языка
 * системы (`ru-RU` → `ru`); неподдерживаемый язык — `FALLBACK_LOCALE`.
 */
export const resolveLocale = (
  mode: LocaleMode,
  systemLanguage: string,
): AppLocale => {
  if (mode !== 'system') return mode;
  const [primary] = systemLanguage.toLowerCase().split('-');
  return LOCALES.find((locale) => locale === primary) ?? FALLBACK_LOCALE;
};
