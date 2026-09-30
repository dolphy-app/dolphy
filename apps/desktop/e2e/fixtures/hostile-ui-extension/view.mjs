// «Враждебный» элемент ответа: пробует выбраться из окна и выводит по строке на пробу
// (`<проба>: blocked|reachable`), а также высокий блок для проверки высоты рамки.
const probes = [
  ['parent.dolphy', () => window.parent.dolphy],
  ['top.document', () => window.top.document],
  ['localStorage', () => window.localStorage.length],
  ['document.cookie', () => document.cookie],
  ['fetch', () => fetch('https://example.com')],
];

const attempt = async (run) => {
  try {
    await run();
    return 'reachable';
  } catch {
    return 'blocked';
  }
};

class AcmeHostileUiAnswer extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    this.input = document.createElement('input');
    this.input.type = 'text';
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
    const tall = document.createElement('div');
    tall.dataset.tall = '';
    tall.style.height = '400px';
    root.append(this.input, tall);
    for (const [name, run] of probes) {
      const line = document.createElement('div');
      line.dataset.probe = name;
      line.textContent = `${name}: pending`;
      root.append(line);
      attempt(run).then((state) => {
        line.textContent = `${name}: ${state}`;
      });
    }
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

if (!customElements.get('acme-hostile-ui-answer')) {
  customElements.define('acme-hostile-ui-answer', AcmeHostileUiAnswer);
}
