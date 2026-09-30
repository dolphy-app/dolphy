import type { ExtensionSettingsDto } from '@dolphy-app/engine-contract';
import type { ExtensionPolicy } from '@dolphy-app/engine/ports';
import type { DiscoveryResult } from './discover.ts';
import { revocationReason } from './revocation.ts';
import type { RevocationLookup } from './revocation.ts';

/** Все расширения включены и доверены: CLI и сторона рантайма, где политики нет. */
export const createAllTrustedPolicy = (): ExtensionPolicy => ({
  isEnabled: () => true,
  isIsolated: () => false,
  update: () => {},
});

/**
 * Адаптер: результат обнаружения (происхождение расширений) + настройки
 * пользователя → `ExtensionPolicy`. Расширения из поставки не отключаются и
 * не изолируются, даже если id попал в настройки (например, после того как
 * пользователь убрал свою копию с тем же id). Отозванное в каталоге
 * расширение отключено независимо от настроек; отзыв читается при каждом
 * вызове, так что обновлённый индекс действует сразу.
 */
export const createExtensionPolicy = (
  discovery: Pick<DiscoveryResult, 'extensions'>,
  revocationOf?: RevocationLookup,
): ExtensionPolicy => {
  const bundled = new Set(
    discovery.extensions
      .filter(({ origin }) => origin === 'bundled')
      .map(({ id }) => id),
  );
  const revoked = (id: string): boolean => {
    const extension = discovery.extensions.find((item) => item.id === id);
    return (
      extension !== undefined &&
      revocationReason(extension, revocationOf) !== null
    );
  };
  let disabled = new Set<string>();
  let trusted = new Set<string>();
  return {
    isEnabled: (id) => bundled.has(id) || (!disabled.has(id) && !revoked(id)),
    isIsolated: (id) => !bundled.has(id) && !trusted.has(id),
    update(settings: ExtensionSettingsDto) {
      disabled = new Set(settings.disabled);
      trusted = new Set(settings.trusted);
    },
  };
};
