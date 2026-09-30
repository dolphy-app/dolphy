import type { AnswerElementProps } from '@lms/extension-api';

class WorkerAnswer extends HTMLElement implements Partial<AnswerElementProps> {
  disabled = false;
}

if (!customElements.get('acme-worker-answer')) {
  customElements.define('acme-worker-answer', WorkerAnswer);
}
