import { computed, inject } from 'vue';
import type { ComputedRef, InjectionKey } from 'vue';
import type { BindingDefinition } from '@dolphy-app/keybindings';
import type {
  ContributionsDto,
  ExtensionsService,
} from '@dolphy-app/engine-contract';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import type { ExtensionClients } from '@/shared/lib/extension-clients.ts';
import type { ExtensionWhen } from '@/shared/lib/extension-when.ts';
import type { Notices } from './notices.ts';
import type { PanelProps } from './panel-props.ts';
import {
  extensionBindings,
  syncExtensionCommands,
} from './registry-adapter.ts';
import { createCommandRunner } from './runner.ts';
import type { CommandRunner } from './runner.ts';

export interface ExtensionCommands {
  notices: Notices;
  panelProps: PanelProps;
  runner: CommandRunner;
  /** Привязки команд расширений: вход карты привязок; меняются вместе с вкладами. */
  bindings: ComputedRef<readonly BindingDefinition[]>;
  /** Снимает команды расширений из реестра. */
  dispose(): void;
}

export interface ExtensionCommandsDeps {
  /** Реестр окна: команды расширений регистрируются в нём рядом с командами приложения. */
  registry: CommandRegistry;
  engine: Pick<ExtensionsService, 'invokeCommand'>;
  contributions: () => Readonly<ContributionsDto>;
  /** Клиентские части окна: клиентские команды и панели. */
  clients: Pick<ExtensionClients, 'commands' | 'panels'>;
  /** Язык окна (`ru`/`en`); читается реактивно. */
  locale: () => string;
  /** Условия видимости `when` команд расширений. */
  when: ExtensionWhen;
  /** Уведомления окна: общие с `AppApi.notify`. */
  notices: Notices;
  /** Свойства открытых панелей: общие с `AppApi.openPanel`. */
  panelProps: PanelProps;
  openPanel(target: { extensionId: string; panelId: string }): void;
}

export const EXTENSION_COMMANDS_KEY: InjectionKey<ExtensionCommands> =
  Symbol('extension-commands');

/** Исполнитель команд и их регистрация в реестре окна. */
export const createExtensionCommands = (
  deps: ExtensionCommandsDeps,
): ExtensionCommands => {
  const { notices, panelProps } = deps;
  const runner = createCommandRunner(deps);
  const dispose = syncExtensionCommands(
    deps.registry,
    deps.contributions,
    deps.clients,
    runner,
    deps.locale,
    deps.when,
  );
  const bindings = computed(() =>
    extensionBindings(deps.contributions(), deps.clients),
  );
  return { notices, panelProps, runner, bindings, dispose };
};

export const useExtensionCommands = (): ExtensionCommands => {
  const commands = inject(EXTENSION_COMMANDS_KEY);
  if (!commands) throw new Error('extension commands are not provided');
  return commands;
};
