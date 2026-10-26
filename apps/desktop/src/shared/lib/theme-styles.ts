import { watch } from 'vue';
import type { Ref, WatchStopHandle } from 'vue';
import type { ClientTheme } from './extension-client-registrations.ts';

/** Атрибут единственного элемента `<style>` с токенами и стилями выбранной темы. */
export const THEME_STYLE_ATTRIBUTE = 'data-dolphy-theme';

/**
 * Текст таблицы стилей темы: токены как переменные корня, затем `css` автора
 * как есть, чтобы он мог ими пользоваться, а `@font-face`, `@keyframes` и
 * `:root` вели себя так, как автор написал. Токен всегда доступен как
 * `--dolphy-<ключ>`; шрифт ещё и как `--v-font-body`: на нём построены
 * `$body-font-family` и заголовки Vuetify.
 */
export const themeStyleText = (
  theme: Pick<ClientTheme, 'tokens' | 'css'>,
): string => {
  const variables = Object.entries(theme.tokens)
    .map(([key, value]) =>
      key === 'font-family'
        ? `--dolphy-font-family:${value};--v-font-body:${value};`
        : `--dolphy-${key}:${value};`,
    )
    .join('');
  return `${variables === '' ? '' : `:root{${variables}}`}${theme.css}`;
};

/**
 * Держит в `<head>` стили выбранной темы расширения: токены и `css`. Стили
 * есть, только пока тема выбрана; выбор другой темы, исчезновение темы
 * (расширение выключено или удалено) и тема без токенов и `css` убирают
 * элемент. Сохранённый id не меняется. Синхронно, как `bindExtensionThemes`:
 * кадр с чужими стилями не мигает.
 */
export const bindThemeStyles = (
  saved: Readonly<Ref<string>>,
  themes: () => readonly ClientTheme[],
  doc: Document = document,
): WatchStopHandle => {
  let element: HTMLStyleElement | null = null;
  const release = () => {
    element?.remove();
    element = null;
  };
  const stop = watch(
    [saved, themes],
    ([id, contributed]) => {
      const active = contributed.find((theme) => theme.id === id);
      const text = active === undefined ? '' : themeStyleText(active);
      if (text === '') {
        release();
        return;
      }
      if (element === null) {
        element = doc.createElement('style');
        element.setAttribute(THEME_STYLE_ATTRIBUTE, '');
        doc.head.append(element);
      }
      element.textContent = text;
    },
    { immediate: true, flush: 'sync' },
  );
  return () => {
    stop();
    release();
  };
};
