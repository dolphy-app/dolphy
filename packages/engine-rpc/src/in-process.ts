import type { MessageEndpoint } from '@spirula-app/engine-contract';

interface Side {
  messageListeners: Set<(message: unknown) => void>;
  closeListeners: Set<() => void>;
}

const createSide = (): Side => ({
  messageListeners: new Set(),
  closeListeners: new Set(),
});

/**
 * Пара связанных конечных точек для тестов и веб-варианта. Сообщения
 * копируются `structuredClone` и доставляются асинхронно, как в Electron:
 * функции в DTO дают `DataCloneError` уже в тесте.
 */
export const createInProcessPair = (): [MessageEndpoint, MessageEndpoint] => {
  const sides: [Side, Side] = [createSide(), createSide()];
  let closed = false;

  const endpointOf = (self: 0 | 1): MessageEndpoint => {
    const own = sides[self];
    const peer = sides[self === 0 ? 1 : 0];
    return {
      post: (message) => {
        if (closed) return;
        const copy = structuredClone(message);
        queueMicrotask(() => {
          if (closed) return;
          for (const listener of [...peer.messageListeners]) listener(copy);
        });
      },
      onMessage: (listener) => {
        own.messageListeners.add(listener);
      },
      onClose: (listener) => {
        own.closeListeners.add(listener);
      },
      close: () => {
        if (closed) return;
        closed = true;
        for (const side of sides) {
          for (const listener of [...side.closeListeners]) listener();
        }
      },
    };
  };

  return [endpointOf(0), endpointOf(1)];
};
