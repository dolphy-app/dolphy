import type { MessageEndpoint } from '@lms/engine-contract';

/** Структурный тип DOM `MessagePort` (в `lib` пакета нет DOM). */
export interface DomPortLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  addEventListener(type: 'close', listener: () => void): void;
  start(): void;
  close(): void;
}

/** Адаптер DOM `MessagePort` (renderer) к `MessageEndpoint`. */
export const fromDomPort = (port: DomPortLike): MessageEndpoint => {
  const closeListeners = new Set<() => void>();
  let closed = false;

  const notifyClosed = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of [...closeListeners]) listener();
  };
  port.addEventListener('close', notifyClosed);

  return {
    post: (message) => {
      if (!closed) port.postMessage(message);
    },
    onMessage: (listener) => {
      port.onmessage = (event) => listener(event.data);
      port.start();
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    close: () => {
      if (closed) return;
      port.close();
      notifyClosed();
    },
  };
};
