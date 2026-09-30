import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import type { ThemeContributionDto } from '@spirula/engine-contract';
import { useI18n } from 'vue-i18n';
import { createVuetify } from 'vuetify';
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n';
import { DARK_THEME, LIGHT_THEME } from '@/shared/lib/builtin-themes.ts';
import {
  baseThemeOf,
  resolveThemeName,
  toVuetifyTheme,
  vuetifyThemeName,
} from '@/shared/lib/extension-themes.ts';
import type { SpirulaI18n } from './i18n.ts';

// components/directives не перечисляем: их подключает vite-plugin-vuetify
// в vite.config (после @vitejs/plugin-vue); режим темы хранится в БД движка,
// встроенные строки Vuetify берутся из каталога vue-i18n (`$vuetify`)
export const createSpirulaVuetify = (
  theme: string,
  i18n: SpirulaI18n,
  contributed: readonly ThemeContributionDto[] = [],
) =>
  createVuetify({
    locale: { adapter: createVueI18nAdapter({ i18n, useI18n }) },
    theme: {
      defaultTheme: resolveThemeName(theme, contributed),
      themes: {
        light: LIGHT_THEME,
        dark: DARK_THEME,
        ...Object.fromEntries(
          contributed.map((item) => [
            vuetifyThemeName(item.id),
            toVuetifyTheme(item, baseThemeOf(item)),
          ]),
        ),
      },
    },
    defaults: {
      VBtn: { class: 'text-none font-weight-medium', rounded: 'lg' },
      VCard: { variant: 'flat', border: true, rounded: 'lg' },
      VChip: { rounded: 'md' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VTextarea: { variant: 'outlined' },
    },
  });
