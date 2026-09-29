import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import { createVuetify } from 'vuetify';

// components/directives не перечисляем: их подключает vite-plugin-vuetify
// в vite.config (после @vitejs/plugin-vue)
export const createLmsVuetify = () => createVuetify({});
