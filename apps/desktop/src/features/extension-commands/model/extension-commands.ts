import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type {
  ContributionsDto,
  ExtensionsService,
} from '@dolphy-app/engine-contract';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import { createNotices } from './notices.ts';
import type { Notices } from './notices.ts';
import { createPanelProps } from './panel-props.ts';
import type { PanelProps } from './panel-props.ts';
import { syncExtensionCommands } from './registry-adapter.ts';
import { createCommandRunner } from './runner.ts';
import type { CommandRunner } from './runner.ts';

export interface ExtensionCommands {
  notices: Notices;
  panelProps: PanelProps;
  runner: CommandRunner;
  /** Снимает команды расширений из реестра. */
  dispose(): void;
}

export interface ExtensionCommandsDeps {
  /** Реестр окна: команды расширений регистрируются в нём рядом с командами приложения. */
  registry: CommandRegistry;
  engine: Pick<ExtensionsService, 'invokeCommand'>;
  contributions: () => Readonly<ContributionsDto>;
  /** Язык окна (`ru`/`en`); читается реактивно. */
  locale: () => string;
  openPanel(target: { extensionId: string; panelId: string }): void;
}

export const EXTENSION_COMMANDS_KEY: InjectionKey<ExtensionCommands> =
  Symbol('extension-commands');

/** Уведомления, исполнитель команд и их регистрация в реестре окна. */
export const createExtensionCommands = (
  deps: ExtensionCommandsDeps,
): ExtensionCommands => {
  const notices = createNotices();
  const panelProps = createPanelProps();
  const runner = createCommandRunner({ ...deps, notices, panelProps });
  const dispose = syncExtensionCommands(
    deps.registry,
    deps.contributions,
    runner,
    deps.locale,
  );
  return { notices, panelProps, runner, dispose };
};

export const useExtensionCommands = (): ExtensionCommands => {
  const commands = inject(EXTENSION_COMMANDS_KEY);
  if (!commands) throw new Error('extension commands are not provided');
  return commands;
};
