import type { AnswerElementProps } from '@spirula-app/extension-api';

class HelloAnswer extends HTMLElement implements Partial<AnswerElementProps> {
  disabled = false;
}

if (!customElements.get('acme-hello-answer')) {
  customElements.define('acme-hello-answer', HelloAnswer);
}
