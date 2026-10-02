// Панель с ресурсами расширения: таблица стилей, изображения и шрифт по `import.meta.url`.
import { mountAssets } from './shared.mjs';

export default {
  async mount(container) {
    await mountAssets(container.ownerDocument, container);
  },
};
