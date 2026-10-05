import { shallowRef } from 'vue';
import { vi } from 'vitest';
import type { BindingDefinition, Platform } from '@dolphy-app/keybindings';
import type {
  KeybindingEntryDto,
  KeybindingsPatch,
} from '@dolphy-app/engine-contract';
import { createKeybindingsService } from '@/features/keybindings';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandDescriptor } from '@/shared/lib/command-registry.ts';

export type UserSet = Record<string, KeybindingEntryDto[]>;

/** Хранилище пользователя без движка: патч применяется как в движке (`null` — сброс); `reject` имитирует отказ. */
export const createFakeUser = (initial: UserSet = {}) => {
  const stored = shallowRef<UserSet>(initial);
  const state: { reject: Error | null } = { reject: null };
  const save = vi.fn(async (patch: KeybindingsPatch): Promise<void> => {
    if (state.reject !== null) throw state.reject;
    const next = { ...stored.value };
    for (const [key, entries] of Object.entries(patch)) {
      if (entries === null) delete next[key];
      else next[key] = entries;
    }
    stored.value = next;
  });
  return { stored, save, state };
};

export const appCommand = (
  key: string,
  override: Partial<CommandDescriptor> = {},
): CommandDescriptor => ({
  key,
  source: 'app',
  title: key,
  run: () => undefined,
  ...override,
});

export const extensionCommand = (
  key: string,
  override: Partial<CommandDescriptor> = {},
): CommandDescriptor => appCommand(key, { source: 'extension', ...override });

export interface KeybindingsSetup {
  commands?: CommandDescriptor[];
  extensions?: BindingDefinition[];
  user?: UserSet;
  platform?: Platform;
}

/** Реестр, поддельное хранилище и сервис привязок; `extensions` можно менять через `setExtensions`. */
export const setupKeybindings = ({
  commands = [],
  extensions = [],
  user = {},
  platform = 'windows',
}: KeybindingsSetup = {}) => {
  const registry = createCommandRegistry();
  for (const descriptor of commands) registry.register(descriptor);
  const fakeUser = createFakeUser(user);
  const extensionBindings =
    shallowRef<readonly BindingDefinition[]>(extensions);
  const keybindings = createKeybindingsService({
    registry,
    user: fakeUser,
    extensionBindings: () => extensionBindings.value,
    platform,
  });
  return {
    registry,
    keybindings,
    user: fakeUser,
    setExtensions: (next: readonly BindingDefinition[]) => {
      extensionBindings.value = next;
    },
  };
};
