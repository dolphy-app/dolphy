import type { ExtensionSettingsDto } from '@dolphy-app/engine-contract';
import type { ExtensionPolicy } from '@dolphy-app/engine/ports';
import {
  dependencyCycles,
  dependencyIssues as issuesOf,
} from './dependencies.ts';
import type { DependencyCycles } from './dependencies.ts';
import type { ResolvedExtension } from './discover.ts';
import type { DiscoverySource } from './holder.ts';
import { revocationReason } from './revocation.ts';
import type { RevocationLookup } from './revocation.ts';

/** Все расширения включены и доверены: CLI и сторона рантайма, где политики нет. */
export const createAllTrustedPolicy = (): ExtensionPolicy => ({
  isEnabled: () => true,
  dependencyIssues: () => [],
  isIsolated: () => false,
  areSchedulesOn: () => true,
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
 * изменения расширений и обновлённый индекс действуют сразу. Расширение с
 * невыполненными зависимостями (`dependencyIssues`) не включено: зависимость
 * должна присутствовать, быть включённой и загруженной и подходить по версии;
 * включение и отключение зависимости сразу меняет её зависимых.
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
  let schedulesOff = new Set<string>();
  let persistedSafeMode = false;
  const safeMode = (): boolean => forceSafeMode || persistedSafeMode;
  /** Не выключено пользователем, безопасным режимом и отзывом; зависимости не в счёт. */
  const isOn = (id: string): boolean =>
    bundled(id) || (!safeMode() && !disabled.has(id) && !revoked(id));
  // циклы зависят только от набора, а снимок неизменяем: считаем один раз на снимок
  const cyclesOf = new WeakMap<
    readonly ResolvedExtension[],
    DependencyCycles
  >();
  const dependencyIssues: ExtensionPolicy['dependencyIssues'] = (id) => {
    const extension = found(id);
    if (extension === undefined || !isOn(id)) return [];
    const { extensions } = discovery.get();
    let cycles = cyclesOf.get(extensions);
    if (cycles === undefined) {
      cycles = dependencyCycles(extensions);
      cyclesOf.set(extensions, cycles);
    }
    return issuesOf(extension, {
      nodes: extensions,
      isOn: (node) => isOn(node.id),
      cycles,
    });
  };
  return {
    isEnabled: (id) => isOn(id) && dependencyIssues(id).length === 0,
    dependencyIssues,
    isIsolated: (id) => !bundled(id) && !trusted.has(id),
    areSchedulesOn: (id) => bundled(id) || !schedulesOff.has(id),
    safeMode,
    update(settings: ExtensionSettingsDto) {
      disabled = new Set(settings.disabled);
      trusted = new Set(settings.trusted);
      schedulesOff = new Set(settings.schedulesOff);
      persistedSafeMode = settings.safeMode;
    },
  };
};
