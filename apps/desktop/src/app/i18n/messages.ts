import { en as vuetifyEn, ru as vuetifyRu } from 'vuetify/locale';
import { dailyPlanMessages } from '@/pages/daily-plan';
import { sessionMessages } from '@/pages/session';
import { settingsMessages } from '@/pages/settings';
import { sharedMessages } from '@/shared/i18n';
import { en as appEn } from './en.ts';
import { ru as appRu } from './ru.ts';

/** Схема ключей: каталог `ru` — источник истины, `en` обязан ему соответствовать. */
export const appMessages = {
  ru: {
    ...sharedMessages.ru,
    ...appRu,
    ...dailyPlanMessages.ru,
    ...sessionMessages.ru,
    ...settingsMessages.ru,
  },
  en: {
    ...sharedMessages.en,
    ...appEn,
    ...dailyPlanMessages.en,
    ...sessionMessages.en,
    ...settingsMessages.en,
  },
};

export type MessageSchema = typeof appMessages.ru;

/** Каталог для vue-i18n: свои сообщения плюс `$vuetify` для встроенных строк Vuetify. */
export const messages = {
  ru: { ...appMessages.ru, $vuetify: vuetifyRu },
  en: { ...appMessages.en, $vuetify: vuetifyEn },
};

/** Именованные форматы дат: одинаковые параметры, язык подставляет vue-i18n. */
const fullDate: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

export const datetimeFormats = {
  ru: { fullDate },
  en: { fullDate },
};
