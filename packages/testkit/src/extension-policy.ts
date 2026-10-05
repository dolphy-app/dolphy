import type { ExtensionSettingsDto } from '@dolphy-app/engine-contract';
import type { ExtensionPolicy } from '@dolphy-app/engine/ports';

export interface FakeExtensionPolicyOptions {
  /** Id расширений из поставки: всегда включены и не изолированы. */
  bundled?: readonly string[];
  settings?: ExtensionSettingsDto;
  /** id → причина отзыва в каталоге: такое расширение отключено независимо от настроек. */
  revoked?: Readonly<Record<string, string>>;
  /** Безопасный режим задан запуском приложения: настройкой `safeMode` не снимается. */
  forceSafeMode?: boolean;
}

export type FakeExtensionPolicy = ExtensionPolicy & {
  /** Настройки, переданные в `update`, по порядку. */
  readonly updates: ExtensionSettingsDto[];
  /** Отозвать (причина) или вернуть (`null`) расширение. */
  setRevoked(id: string, reason: string | null): void;
};

/** Политика в памяти с той же семантикой, что у адаптера хоста расширений. */
export const createFakeExtensionPolicy = (
  options: FakeExtensionPolicyOptions = {},
): FakeExtensionPolicy => {
  const bundled = new Set(options.bundled ?? []);
  let settings: ExtensionSettingsDto = structuredClone(
    options.settings ?? {
      disabled: [],
      trusted: [],
      checkUpdates: true,
      safeMode: false,
      notificationsOff: [],
      schedulesOff: [],
    },
  );
  const updates: ExtensionSettingsDto[] = [];
  const revoked = new Set(Object.keys(options.revoked ?? {}));
  const safeMode = (): boolean =>
    options.forceSafeMode === true || settings.safeMode;
  return {
    updates,
    setRevoked: (id, reason) => {
      if (reason === null) revoked.delete(id);
      else revoked.add(id);
    },
    isEnabled: (id) =>
      bundled.has(id) ||
      (!safeMode() && !settings.disabled.includes(id) && !revoked.has(id)),
    isIsolated: (id) => !bundled.has(id) && !settings.trusted.includes(id),
    areSchedulesOn: (id) =>
      bundled.has(id) || !settings.schedulesOff.includes(id),
    safeMode,
    update(next) {
      settings = structuredClone(next);
      updates.push(structuredClone(next));
    },
  };
};
