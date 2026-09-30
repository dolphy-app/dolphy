// Элемент ввода ответа стороннего расширения: тот же контракт событий, что у dolphy-choice-answer.
class AcmePermittedAnswer extends HTMLElement {
  constructor() {
    super();
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.attachShadow({ mode: 'open' }).append(this.input);
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

if (!customElements.get('acme-permitted-answer')) {
  customElements.define('acme-permitted-answer', AcmePermittedAnswer);
}
