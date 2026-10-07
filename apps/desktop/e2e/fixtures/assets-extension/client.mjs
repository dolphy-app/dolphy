// Панель, вид ответа и рендерер markdown с ресурсами расширения: таблица стилей, изображения и шрифт по `import.meta.url`.
import { assetsComponent } from './shared.mjs';

const vue = await globalThis.__dolphy.require('vue');

export const client = (c) => {
  c.addPanel({
    id: 'acme.assets.main',
    title: 'Ресурсы',
    component: assetsComponent(vue),
  });
  c.addAnswerView(
    'acme.assets',
    assetsComponent(vue, ['view', 'value', 'disabled', 'verdict', 'label']),
  );
  c.addMarkdownRenderer('assets', assetsComponent(vue, ['source', 'language']));
};
