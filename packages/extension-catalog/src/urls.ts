import { CatalogFormatError } from './errors.ts';
import type { CatalogVersion } from './schema.ts';

/** File name of the first-format index: the catalog identity (`catalogUrl`) points at it. */
export const INDEX_FILE = 'index.json';
/** File name of the full index, published next to `index.json`. */
export const FULL_INDEX_FILE = 'index.v2.json';

/**
 * Address of the full index: `index.v2.json` in the same directory as the catalog address.
 * The catalog identity stays the address of `index.json`.
 */
export const fullIndexUrl = (indexUrl: string): URL =>
  new URL(FULL_INDEX_FILE, indexUrl);

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
