// @vitest-environment happy-dom
import { computed, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createKeybindingDispatcher,
  createKeybindingsService,
} from '@/features/keybindings';
import { createExtensionCommands } from '@/features/extension-commands/model/extension-commands.ts';
import { NO_CONTRIBUTIONS } from '@/shared/api/engine/contributions.ts';
import { createCommandRegistry } from '@/shared/lib/command-registry.ts';
import { createContextKeys } from '@/shared/lib/context-keys.ts';
import { createExtensionWhen } from '@/shared/lib/extension-when.ts';
import { createFakeUser } from './support/keybindings-fakes.ts';

let stop: () => void = () => undefined;
afterEach(() => stop());

const press = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );

describe('when and shortcuts of extension commands', () => {
  it('a false when stops the shortcut and a true one lets it run, following the route without re-registering', () => {
    const route = shallowRef<string>('daily-plan');
    const registry = createCommandRegistry();
    const invokeCommand = vi.fn(async () => ({ kind: 'none' as const }));
    const contributions = {
      ...NO_CONTRIBUTIONS,
      commands: [
        {
          id: 'acme.cmd.run',
          extensionId: 'acme.cmd',
          title: 'Run',
          description: null,
          category: null,
          keybindings: [
            {
              key: 'Mod+Shift+G',
              mac: null,
              windows: null,
              linux: null,
              when: null,
            },
          ],
          palette: true,
          when: "route == 'courses'",
          icon: 'puzzle',
        },
      ],
    };
    const extensionCommands = createExtensionCommands({
      registry,
      engine: { invokeCommand },
      contributions: () => contributions,
      clients: { commands: computed(() => []), panels: computed(() => []) },
      locale: () => 'en',
      when: createExtensionWhen({
        route: () => route.value,
        courseActive: () => false,
        locale: () => 'en',
        dark: () => false,
      }),
      openPanel: vi.fn(),
    });
    const keybindings = createKeybindingsService({
      registry,
      user: createFakeUser(),
      extensionBindings: () => extensionCommands.bindings.value,
      platform: 'windows',
    });
    const dispatcher = createKeybindingDispatcher({
      registry,
      keybindings,
      contextKeys: createContextKeys('windows', document),
    });
    stop = dispatcher.install(document);
    const shortcut = { key: 'G', ctrlKey: true, shiftKey: true };

    press(shortcut);
    expect(invokeCommand).not.toHaveBeenCalled();

    route.value = 'courses';
    press(shortcut);
    expect(invokeCommand).toHaveBeenCalledOnce();

    route.value = 'session';
    press(shortcut);
    expect(invokeCommand).toHaveBeenCalledOnce();
  });
});
