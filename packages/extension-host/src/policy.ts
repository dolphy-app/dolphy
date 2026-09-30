import type { ExtensionSettingsDto } from '@lms/engine-contract';
import type { ExtensionPolicy } from '@lms/engine/ports';
import type { DiscoveryResult } from './discover.ts';

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
 * пользователь убрал свою копию с тем же id).
 */
export const createExtensionPolicy = (
  discovery: Pick<DiscoveryResult, 'extensions'>,
): ExtensionPolicy => {
  const bundled = new Set(
    discovery.extensions
      .filter(({ origin }) => origin === 'bundled')
      .map(({ id }) => id),
  );
  let disabled = new Set<string>();
  let trusted = new Set<string>();
  return {
    isEnabled: (id) => bundled.has(id) || !disabled.has(id),
    isIsolated: (id) => !bundled.has(id) && !trusted.has(id),
    update(settings: ExtensionSettingsDto) {
      disabled = new Set(settings.disabled);
      trusted = new Set(settings.trusted);
    },
  };
};
