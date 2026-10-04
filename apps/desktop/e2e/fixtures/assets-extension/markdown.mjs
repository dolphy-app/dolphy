// Рендерер блока с ресурсами расширения.
import { mountAssets } from './shared.mjs';

export default {
  async render(_source, container) {
    await mountAssets(container.ownerDocument, container);
  },
};
