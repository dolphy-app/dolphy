import 'vuetify/styles';
import type { Preview } from '@storybook/html-vite';
import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
// единственный источник палитры: рамка ответа в приложении получает
// переменные именно этих тем (`--v-theme-*`, см. frame-theme.ts приложения)
import {
  DARK_THEME,
  LIGHT_THEME,
} from '../../../apps/desktop/src/shared/lib/builtin-themes.ts';

// плагин ставится ради таблицы стилей темы (`.v-theme--light`/`--dark` с
// переменными `--v-theme-*`); Vue-компоненты истории не используют
createApp({}).use(
  createVuetify({
    theme: {
      defaultTheme: 'light',
      themes: { light: LIGHT_THEME, dark: DARK_THEME },
    },
  }),
);

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
    (story, context) => {
      const theme = String(context.globals['theme']);
      const frame = document.createElement('div');
      frame.className = `v-theme--${theme}`;
      // поверхность карточки упражнения; цвет, шрифт и `color-scheme` повторяют
      // страницу рамки ответа (frame-runtime.js, extension-assets.ts)
      frame.style.cssText =
        `color-scheme: ${theme}; box-sizing: border-box; padding: 16px;` +
        'background: rgb(var(--v-theme-surface));' +
        'color: rgb(var(--v-theme-on-surface));' +
        "font: 16px/1.5 Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif;";
      const content = story();
      if (typeof content === 'string') frame.innerHTML = content;
      else frame.append(content);
      return frame;
    },
  ],
};

export default preview;
