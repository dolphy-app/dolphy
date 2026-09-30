import { CatalogFormatError } from './errors.ts';
import type { CatalogVersion } from './schema.ts';

/**
 * Адрес файла версии: `baseUrl` и `path` — относительно адреса `index.json`.
 * Результат всегда на origin индекса (R5); `baseUrl` и `path` уже проверены
 * схемой, повторная проверка origin страхует от ошибки разбора.
 */
export const versionFileUrl = (
  indexUrl: string,
  version: Pick<CatalogVersion, 'baseUrl'>,
  path: string,
): URL => {
  const index = new URL(indexUrl);
  const url = new URL(`${version.baseUrl}${path}`, index);
  if (url.origin !== index.origin) {
    throw new CatalogFormatError([`'${path}' is outside the catalog origin`]);
  }
  return url;
};
