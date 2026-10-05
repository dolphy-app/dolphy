import { watch } from 'vue';
import type { Ref, WatchStopHandle } from 'vue';
import { syntaxCssVars, syntaxPalette } from './syntax-palette.ts';

/** Что нужно от темы Vuetify (`vuetify.theme`): текущие цвета и тёмная ли она. */
export interface SyntaxThemeSource {
  readonly current: Readonly<
    Ref<{ colors: Readonly<Record<string, unknown>>; dark: boolean }>
  >;
}

/**
 * Публикует цвета подсветки кода как `--sh-*` на корне документа и обновляет
 * их при смене темы (в том числе системной при смене режима ОС). На корне, а
 * не на блоке Markdown: переменные наследуются и в теневой DOM, поэтому ими же
 * красит код редактор ответа `dolphy.js`. Синхронно, как `bindExtensionThemes`:
 * промежуточный кадр со старыми цветами не мигает.
 */
export const bindSyntaxPalette = (
  theme: SyntaxThemeSource,
  root: HTMLElement = document.documentElement,
): WatchStopHandle =>
  watch(
    () => theme.current.value,
    ({ colors, dark }) => {
      for (const [name, value] of Object.entries(
        syntaxCssVars(syntaxPalette(colors, dark)),
      )) {
        root.style.setProperty(name, value);
      }
    },
    { immediate: true, flush: 'sync' },
  );
