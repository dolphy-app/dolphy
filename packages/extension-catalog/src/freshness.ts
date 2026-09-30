import { CatalogFormatError } from './errors.ts';
import type { CatalogIndex } from './schema.ts';

/**
 * Защита от отката индекса: CDN или перехватчик отдаёт старый индекс без
 * свежих записей `revoked`. Новый индекс не может быть старее кэшированного;
 * равный `generatedAt` допустим (тот же индекс). Бросает `CatalogFormatError`.
 */
export const assertNotRolledBack = (
  cached: Pick<CatalogIndex, 'generatedAt'> | null,
  fresh: Pick<CatalogIndex, 'generatedAt'>,
): void => {
  if (cached === null) return;
  if (Date.parse(fresh.generatedAt) < Date.parse(cached.generatedAt)) {
    throw new CatalogFormatError([
      `index is older than the cached one (${fresh.generatedAt} < ${cached.generatedAt})`,
    ]);
  }
};
