import { en } from './messages/en.ts';
import { ru } from './messages/ru.ts';

export { FALLBACK_LOCALE, LOCALES, resolveLocale } from './locale.ts';
export type { AppLocale } from './locale.ts';
export { russianPluralRule } from './plural.ts';

/** Общие сообщения; у каждого слайса свои — в его `i18n/`. */
export const sharedMessages = { ru, en };
