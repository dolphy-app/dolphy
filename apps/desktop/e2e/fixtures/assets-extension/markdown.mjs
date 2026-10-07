// Рендерер блока с ресурсами расширения.
import { assetsComponent } from './shared.mjs';

const vue = await globalThis.__dolphy.require('vue');

export default {
  markdown: { assets: assetsComponent(vue, ['source', 'language']) },
};
