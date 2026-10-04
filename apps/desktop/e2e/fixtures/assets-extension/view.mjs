// Элемент ввода с ресурсами расширения: таблица в тени (и в документе для шрифта).
import { mountAssets } from './shared.mjs';

class AcmeAssetsAnswer extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.root.append(this.input);
    this.input.addEventListener('input', () => {
      this.dispatchEvent(
        new CustomEvent('dolphy-answer-change', {
          detail: {
            value: this.input.value,
            complete: this.input.value.length > 0,
          },
          bubbles: true,
          composed: true,
        }),
      );
    });
    void mountAssets(document, this.root, [this.root, document.head]);
  }

  connectedCallback() {
    const label = this.getAttribute('aria-label');
    if (label) this.input.setAttribute('aria-label', label);
  }

  set disabled(value) {
    this.input.disabled = Boolean(value);
  }

  get disabled() {
    return this.input.disabled;
  }
}

if (!customElements.get('acme-assets-answer')) {
  customElements.define('acme-assets-answer', AcmeAssetsAnswer);
}
