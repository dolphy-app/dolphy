import { createI18n } from 'vue-i18n';
import type { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n';
import { FALLBACK_LOCALE, russianPluralRule } from '@/shared/i18n';
import type { AppLocale } from '@/shared/i18n';
import { datetimeFormats, messages } from '../i18n/messages.ts';

/** Экземпляр в том виде, который принимает адаптер локали Vuetify. */
export type SpirulaI18n = Parameters<typeof createVueI18nAdapter>[0]['i18n'];

/** Язык интерфейса выбирает вызывающий (из БД движка или из системы). */
export const createSpirulaI18n = (locale: AppLocale): SpirulaI18n => {
  document.documentElement.lang = locale;
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: FALLBACK_LOCALE,
    messages,
    datetimeFormats,
    pluralRules: { ru: russianPluralRule },
  });
  // ключи `t()` проверяет глобальная схема (`i18n/vue-i18n.d.ts`), а адаптер
  // Vuetify ждёт экземпляр без привязки к списку языков
  return i18n as unknown as SpirulaI18n;
};
