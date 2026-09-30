import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import type { ThemeMode } from '@lms/engine-contract';
import { useI18n } from 'vue-i18n';
import { createVuetify } from 'vuetify';
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n';
import type { ThemeDefinition } from 'vuetify';
import type { LmsI18n } from './i18n.ts';

// индиго — фокус и обучение, бирюзовый — новое и освоенное,
// янтарный — закрепление основ; нейтральные поверхности с холодным оттенком
const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#F5F6FB',
    surface: '#FFFFFF',
    'surface-variant': '#ECEEF8',
    'on-surface-variant': '#5B6280',
    primary: '#4F46E5',
    'on-primary': '#FFFFFF',
    secondary: '#0D9488',
    'on-secondary': '#FFFFFF',
    error: '#DC2626',
    warning: '#D97706',
    success: '#16A34A',
    info: '#0284C7',
    // градиент акцентной карточки «плана дня»: белый текст ≥ 4.5:1
    'hero-start': '#4F46E5',
    'hero-end': '#7C3AED',
  },
  // подписи полей и вторичный текст: 0.60 давал 4.21:1 на фоне `background`
  variables: {
    'border-color': '#1E1B4B',
    'border-opacity': 0.1,
    'medium-emphasis-opacity': 0.72,
  },
};

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0E1020',
    surface: '#171A2F',
    'surface-variant': '#242845',
    'on-surface-variant': '#A5ACCB',
    primary: '#8B93FF',
    'on-primary': '#0E1020',
    secondary: '#2DD4BF',
    'on-secondary': '#0E1020',
    error: '#F87171',
    warning: '#FBBF24',
    success: '#4ADE80',
    info: '#38BDF8',
    'hero-start': '#4338CA',
    'hero-end': '#6D28D9',
  },
  variables: { 'border-color': '#E0E3FF', 'border-opacity': 0.12 },
};

// components/directives не перечисляем: их подключает vite-plugin-vuetify
// в vite.config (после @vitejs/plugin-vue); режим темы хранится в БД движка,
// встроенные строки Vuetify берутся из каталога vue-i18n (`$vuetify`)
export const createLmsVuetify = (theme: ThemeMode, i18n: LmsI18n) =>
  createVuetify({
    locale: { adapter: createVueI18nAdapter({ i18n, useI18n }) },
    theme: { defaultTheme: theme, themes: { light, dark } },
    defaults: {
      VBtn: { class: 'text-none font-weight-medium', rounded: 'lg' },
      VCard: { variant: 'flat', border: true, rounded: 'lg' },
      VChip: { rounded: 'md' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VTextarea: { variant: 'outlined' },
    },
  });
