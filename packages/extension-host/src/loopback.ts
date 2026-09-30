import type { MessageEndpoint } from '@dolphy-app/engine-contract';

interface Side {
  listeners: ((message: unknown) => void)[];
  closeListeners: (() => void)[];
}

/** Пара связанных endpoint'ов в памяти; сообщения клонируются, как в IPC. */
export const createEndpointPair = (): [MessageEndpoint, MessageEndpoint] => {
  const sides: [Side, Side] = [
    { listeners: [], closeListeners: [] },
    { listeners: [], closeListeners: [] },
  ];
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const side of sides)
      for (const listener of side.closeListeners) listener();
  };
  const make = (self: Side, peer: Side): MessageEndpoint => ({
    post(message) {
      if (closed) return;
      const copy = structuredClone(message);
      queueMicrotask(() => {
        if (closed) return;
        for (const listener of peer.listeners) listener(copy);
      });
    },
    onMessage: (listener) => void self.listeners.push(listener),
    onClose: (listener) => void self.closeListeners.push(listener),
    close,
  });
  return [make(sides[0], sides[1]), make(sides[1], sides[0])];
};
