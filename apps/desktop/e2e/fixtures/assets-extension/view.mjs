// Вид ответа с ресурсами расширения: отчёт о таблице стилей, изображениях и шрифте.
import { assetsComponent } from './shared.mjs';

const vue = await globalThis.__dolphy.require('vue');

export default {
  views: {
    'acme.assets': assetsComponent(vue, [
      'view',
      'value',
      'disabled',
      'verdict',
      'label',
    ]),
  },
};
