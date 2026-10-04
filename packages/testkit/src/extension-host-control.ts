import type { ExtensionHostControl } from '@dolphy-app/engine/ports';

export type FakeExtensionHostControl = ExtensionHostControl & {
  /** Сколько раз просили перезапустить хост. */
  readonly restarts: () => number;
};

/** Управление хостом расширений в памяти: считает просьбы о перезапуске. */
export const createFakeExtensionHostControl = (): FakeExtensionHostControl => {
  let restarts = 0;
  return {
    restarts: () => restarts,
    restart() {
      restarts += 1;
    },
  };
};
