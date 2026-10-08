/**
 * Text an extension shows to the user. A plain string is shown as is; an
 * object carries `en` (required, the fallback) and optionally `ru`. The
 * functions are pure: the app window, the engine and the tools share them.
 */

/** A user-facing label: a string without a translation, or texts by language. */
export type LocalizedText =
  string | { readonly en: string; readonly ru?: string };

/**
 * The text for `locale`: a string is returned as is; an object gives the
 * text of `locale` when it has one, otherwise `en`.
 */
export const resolveLocalizedText = (
  text: LocalizedText,
  locale: string,
): string => {
  if (typeof text === 'string') return text;
  return (locale === 'ru' ? text.ru : undefined) ?? text.en;
};

/** Every language variant of `text` (for search): the string itself, or `en` and `ru` when present. */
export const localizedTexts = (text: LocalizedText): string[] => {
  if (typeof text === 'string') return [text];
  return text.ru === undefined ? [text.en] : [text.en, text.ru];
};
