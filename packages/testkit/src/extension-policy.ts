import type { ExtensionSettingsDto } from '@spirula-app/engine-contract';
import type { ExtensionPolicy } from '@spirula-app/engine/ports';

export interface FakeExtensionPolicyOptions {
  /** Id расширений из поставки: всегда включены и не изолированы. */
  bundled?: readonly string[];
  settings?: ExtensionSettingsDto;
  /** id → причина отзыва в каталоге: такое расширение отключено независимо от настроек. */
  revoked?: Readonly<Record<string, string>>;
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
    options.settings ?? { disabled: [], trusted: [], checkUpdates: true },
  );
  const updates: ExtensionSettingsDto[] = [];
  const revoked = new Set(Object.keys(options.revoked ?? {}));
  return {
    updates,
    setRevoked: (id, reason) => {
      if (reason === null) revoked.delete(id);
      else revoked.add(id);
    },
    isEnabled: (id) =>
      bundled.has(id) || (!settings.disabled.includes(id) && !revoked.has(id)),
    isIsolated: (id) => !bundled.has(id) && !settings.trusted.includes(id),
    update(next) {
      settings = structuredClone(next);
      updates.push(structuredClone(next));
    },
  };
};
