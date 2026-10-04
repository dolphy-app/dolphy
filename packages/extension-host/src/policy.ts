import type { ExtensionSettingsDto } from '@dolphy-app/engine-contract';
import type { ExtensionPolicy } from '@dolphy-app/engine/ports';
import type { DiscoverySource } from './holder.ts';
import { revocationReason } from './revocation.ts';
import type { RevocationLookup } from './revocation.ts';

/** Все расширения включены и доверены: CLI и сторона рантайма, где политики нет. */
export const createAllTrustedPolicy = (): ExtensionPolicy => ({
  isEnabled: () => true,
  isIsolated: () => false,
  safeMode: () => false,
  update: () => {},
});

/**
 * Адаптер: снимок обнаружения (происхождение расширений) + настройки
 * пользователя → `ExtensionPolicy`. Расширения из поставки не отключаются и
 * не изолируются, даже если id попал в настройки (например, после того как
 * пользователь убрал свою копию с тем же id). Отозванное в каталоге
 * расширение отключено независимо от настроек. В безопасном режиме (запуск
 * с `forceSafeMode` или настройка `safeMode`) отключено всё, что не из
 * поставки. Снимок и отзыв читаются при каждом вызове, так что применённые
 * изменения расширений и обновлённый индекс действуют сразу.
 */
export const createExtensionPolicy = (
  discovery: DiscoverySource,
  revocationOf?: RevocationLookup,
  /** Безопасный режим задан запуском приложения: настройкой не снимается. */
  forceSafeMode = false,
): ExtensionPolicy => {
  const found = (id: string) =>
    discovery.get().extensions.find((item) => item.id === id);
  const bundled = (id: string): boolean => found(id)?.origin === 'bundled';
  const revoked = (id: string): boolean => {
    const extension = found(id);
    return (
      extension !== undefined &&
      revocationReason(extension, revocationOf) !== null
    );
  };
  let disabled = new Set<string>();
  let trusted = new Set<string>();
  let persistedSafeMode = false;
  const safeMode = (): boolean => forceSafeMode || persistedSafeMode;
  return {
    isEnabled: (id) =>
      bundled(id) || (!safeMode() && !disabled.has(id) && !revoked(id)),
    isIsolated: (id) => !bundled(id) && !trusted.has(id),
    safeMode,
    update(settings: ExtensionSettingsDto) {
      disabled = new Set(settings.disabled);
      trusted = new Set(settings.trusted);
      persistedSafeMode = settings.safeMode;
    },
  };
};
