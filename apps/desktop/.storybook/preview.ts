import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '../src/app/styles/global.css';
import { setup } from '@storybook/vue3-vite';
import type { Preview } from '@storybook/vue3-vite';
import { useTheme } from 'vuetify';
import { VApp, VMain } from 'vuetify/components';
import { applyLocale, createDolphyI18n } from '../src/app/providers/i18n.ts';
import { createDolphyVuetify } from '../src/app/providers/vuetify.ts';

// Те же провайдеры, что в `src/app/main.ts`: иначе story отличается от
// приложения (дефолты Vuetify, встроенные темы, plural-правила vue-i18n).
const i18n = createDolphyI18n('ru');

setup((app) => {
  app.use(i18n);
  app.use(createDolphyVuetify(i18n));
});

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Тема Vuetify',
      toolbar: {
        title: 'Тема',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Светлая' },
          { value: 'dark', title: 'Тёмная' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Язык интерфейса',
      toolbar: {
        title: 'Язык',
        icon: 'globe',
        items: [
          { value: 'ru', title: 'Русский' },
          { value: 'en', title: 'English' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light', locale: 'ru' },
  decorators: [
    (story, context) => ({
      // шаблон-строка компилируется в рантайме: автоимпорт плагина Vuetify его не видит
      components: { story, VApp, VMain },
      setup() {
        // смена глобала пересоздаёт декоратор, поэтому читаем его один раз
        useTheme().change(String(context.globals['theme']));
        applyLocale(i18n, context.globals['locale'] === 'en' ? 'en' : 'ru');
      },
      template:
        '<v-app><v-main><div class="pa-6"><story /></div></v-main></v-app>',
    }),
  ],
  parameters: { layout: 'fullscreen' },
};

export default preview;
