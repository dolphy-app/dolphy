import { computed } from 'vue';
import { useTheme } from 'vuetify';
import { syntaxCssVars, syntaxPalette } from './syntax-palette.ts';

/**
 * `--sh-*` для корня Markdown по текущей теме Vuetify (встроенной, системной
 * или темы расширения): пересчитывается при смене темы и ОС.
 */
export const useSyntaxStyle = () => {
  const theme = useTheme();
  return computed(() => {
    const { colors, dark } = theme.current.value;
    return syntaxCssVars(syntaxPalette(colors, dark));
  });
};
