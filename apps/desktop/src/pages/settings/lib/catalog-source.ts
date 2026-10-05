import type {
  CatalogUrlRejection,
  ExtensionInstallDto,
} from '@dolphy-app/engine-contract';

/** Причины отказа движка, у которых есть текст (`settings.extensions.catalog.advanced.errors.<reason>`). */
export const CATALOG_URL_REJECTIONS: readonly CatalogUrlRejection[] = [
  'not-url',
  'scheme',
  'credentials',
  'fragment',
  'not-json',
  'too-long',
  'env',
];

/** Причина из `details.reason` ошибки `INVALID_ARGUMENT`; `null` — не причина отказа адреса. */
export const catalogUrlRejection = (
  details: Record<string, unknown> | undefined,
): CatalogUrlRejection | null => {
  const reason = details?.['reason'];
  return CATALOG_URL_REJECTIONS.find((item) => item === reason) ?? null;
};

/**
 * Расширение установлено из каталога, который не действует сейчас: адрес в
 * `.dolphy-install.json` отличается от действующего. Пока действующий адрес
 * неизвестен (`null`) — нет.
 */
export const isFromAnotherCatalog = (
  installed: Pick<ExtensionInstallDto, 'catalogUrl'> | null,
  currentUrl: string | null,
): boolean =>
  installed !== null &&
  currentUrl !== null &&
  installed.catalogUrl !== currentUrl;
