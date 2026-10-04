import type { ExtensionReloader } from '@dolphy-app/engine/ports';

export type FakeExtensionReloader = ExtensionReloader & {
  /** Сколько раз `reload()` вызывали (начатые перезагрузки, включая ещё не завершённые). */
  readonly calls: () => number;
};

/**
 * Перезагрузка расширений в памяти: по умолчанию мгновенно успешна. `reload`
 * подменяет поведение (задержка, отказ, запись порядка вызовов).
 */
export const createFakeExtensionReloader = (
  reload: () => void | Promise<void> = () => {},
): FakeExtensionReloader => {
  let calls = 0;
  return {
    calls: () => calls,
    async reload() {
      calls += 1;
      await reload();
    },
  };
};
