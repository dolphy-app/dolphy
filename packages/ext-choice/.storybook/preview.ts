import 'vuetify/styles';
import { setup } from '@storybook/vue3-vite';
import type { Preview } from '@storybook/vue3-vite';
import { h } from 'vue';
import { createVuetify } from 'vuetify';
import { VThemeProvider } from 'vuetify/components/VThemeProvider';
// единственный источник палитры: окно приложения использует те же темы
import {
  DARK_THEME,
  LIGHT_THEME,
} from '../../../apps/desktop/src/shared/lib/builtin-themes.ts';

setup((app) => {
  app.use(
    createVuetify({
      theme: {
        defaultTheme: 'light',
        themes: { light: LIGHT_THEME, dark: DARK_THEME },
      },
    }),
  );
});

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Тема приложения',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (story, context) => ({
      // поверхность карточки упражнения: фон и цвет текста берутся из темы
      render: () =>
        h(
          VThemeProvider,
          {
            theme: String(context.globals['theme']),
            withBackground: true,
            style: { padding: '16px' },
          },
          () => h(story()),
        ),
    }),
  ],
};

export default preview;
