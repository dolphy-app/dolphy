import type { DiscoveryResult, ResolvedExtension } from './discover.ts';

/**
 * Изменяемый снимок обнаружения. Политика, каталог видов, реестр и установщик
 * читают его через `get()` при каждом вызове, а не держат значение: применение
 * изменений расширений заменяет снимок целиком (`replace`), и все они видят
 * новое состояние сразу. Подмена атомарна: читатель получает либо прежний,
 * либо новый снимок целиком.
 */
export interface DiscoveryHolder {
  get(): DiscoveryResult;
  replace(next: DiscoveryResult): void;
}

/** Только чтение: то, что нужно политике, каталогу и реестру. */
export type DiscoverySource = Pick<DiscoveryHolder, 'get'>;

export const createDiscoveryHolder = (
  initial: DiscoveryResult,
): DiscoveryHolder => {
  let current = initial;
  return {
    get: () => current,
    replace(next) {
      current = next;
    },
  };
};

/** Снимок без диагностик и перекрытых расширений: набор, полученный готовым (хост расширений, тесты). */
export const discoveryOf = (
  extensions: readonly ResolvedExtension[],
): DiscoveryResult => ({
  extensions: [...extensions],
  diagnostics: [],
  overridden: [],
});
