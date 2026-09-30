import type { ExtensionSettingsDto } from '@spirula/engine-contract';
import type { ExtensionPolicy } from '@spirula/engine/ports';

export interface FakeExtensionPolicyOptions {
  /** Id расширений из поставки: всегда включены и не изолированы. */
  bundled?: readonly string[];
  settings?: ExtensionSettingsDto;
}

export type FakeExtensionPolicy = ExtensionPolicy & {
  /** Настройки, переданные в `update`, по порядку. */
  readonly updates: ExtensionSettingsDto[];
};

/** Политика в памяти с той же семантикой, что у адаптера хоста расширений. */
export const createFakeExtensionPolicy = (
  options: FakeExtensionPolicyOptions = {},
): FakeExtensionPolicy => {
  const bundled = new Set(options.bundled ?? []);
  let settings: ExtensionSettingsDto = structuredClone(
    options.settings ?? { disabled: [], trusted: [] },
  );
  const updates: ExtensionSettingsDto[] = [];
  return {
    updates,
    isEnabled: (id) => bundled.has(id) || !settings.disabled.includes(id),
    isIsolated: (id) => !bundled.has(id) && !settings.trusted.includes(id),
    update(next) {
      settings = structuredClone(next);
      updates.push(structuredClone(next));
    },
  };
};
