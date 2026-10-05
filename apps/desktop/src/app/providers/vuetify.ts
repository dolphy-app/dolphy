import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { useI18n } from 'vue-i18n';
import { createVuetify } from 'vuetify';
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n';
import { DARK_THEME, LIGHT_THEME } from '@/shared/lib/builtin-themes.ts';
import type { DolphyI18n } from './i18n.ts';

// components/directives не перечисляем: их подключает vite-plugin-vuetify
// в vite.config (после @vitejs/plugin-vue); режим темы хранится в БД движка
// и применяется `bindExtensionThemes` (темы расширений живут в реестре
// Vuetify и меняются на лету), встроенные строки Vuetify берутся из каталога
// vue-i18n (`$vuetify`)
export const createDolphyVuetify = (i18n: DolphyI18n) =>
  createVuetify({
    locale: { adapter: createVueI18nAdapter({ i18n, useI18n }) },
    theme: {
      defaultTheme: 'system',
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
    },
    defaults: {
      VBtn: { class: 'text-none font-weight-medium', rounded: 'lg' },
      VCard: { variant: 'flat', border: true, rounded: 'lg' },
      VChip: { rounded: 'md' },
      // снекбар в правом нижнем углу: по центру он перекрывал действия карточек и строки списка
      VSnackbar: { location: 'bottom end' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VTextarea: { variant: 'outlined' },
    },
  });
