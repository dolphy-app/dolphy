// Панель с ресурсами расширения: таблица стилей, изображения и шрифт по `import.meta.url`.
import { assetsComponent } from './shared.mjs';

const vue = await globalThis.__dolphy.require('vue');

export default { panels: { 'acme.assets.main': assetsComponent(vue) } };
