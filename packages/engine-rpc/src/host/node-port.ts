import type { MessageEndpoint } from '@spirula/engine-contract';

/** Структурный тип `MessagePortMain` (Electron) и `MessagePort` из `node:worker_threads` в Node-стиле. */
export interface NodePortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

/** Адаптер `MessagePortMain` (хост-процесс) к `MessageEndpoint`. */
export const fromNodePort = (port: NodePortLike): MessageEndpoint => {
  const closeListeners = new Set<() => void>();
  let closed = false;
  let started = false;

  const notifyClosed = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of [...closeListeners]) listener();
  };
  port.on('close', notifyClosed);

  return {
    post: (message) => {
      if (!closed) port.postMessage(message);
    },
    onMessage: (listener) => {
      port.on('message', (event) => listener(event.data));
      if (!started) {
        started = true;
        port.start(); // после подписки: сообщения не теряются
      }
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
