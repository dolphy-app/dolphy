import { CatalogFormatError } from './errors.ts';
import type { CatalogVersion } from './schema.ts';

/** File name of the catalog index, the only one. */
export const FULL_INDEX_FILE = 'index.v2.json';

/**
 * Address of the index: `index.v2.json` in the same directory as the catalog address.
 * The catalog identity (`catalogUrl`) stays that address; nothing is read from it itself.
 */
export const fullIndexUrl = (catalogUrl: string): URL =>
  new URL(FULL_INDEX_FILE, catalogUrl);

/**
 * Адрес файла версии: `baseUrl` и `path` — относительно адреса каталога.
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
