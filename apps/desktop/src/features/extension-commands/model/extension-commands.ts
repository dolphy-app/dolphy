import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type {
  ContributionsDto,
  ExtensionsService,
} from '@dolphy-app/engine-contract';
import { createNotices } from './notices.ts';
import type { Notices } from './notices.ts';
import { createCommandPalette } from './palette.ts';
import type { CommandPalette } from './palette.ts';
import { createPanelProps } from './panel-props.ts';
import type { PanelProps } from './panel-props.ts';
import { createCommandRunner } from './runner.ts';
import type { CommandRunner } from './runner.ts';

export interface ExtensionCommands {
  notices: Notices;
  panelProps: PanelProps;
  runner: CommandRunner;
  palette: CommandPalette;
}

export interface ExtensionCommandsDeps {
  engine: Pick<ExtensionsService, 'invokeCommand'>;
  contributions: () => Readonly<ContributionsDto>;
  openPanel(target: { extensionId: string; panelId: string }): void;
}

export const EXTENSION_COMMANDS_KEY: InjectionKey<ExtensionCommands> =
  Symbol('extension-commands');

/** Палитра, уведомления и исполнитель команд, собранные в одно целое для окна. */
export const createExtensionCommands = (
  deps: ExtensionCommandsDeps,
): ExtensionCommands => {
  const notices = createNotices();
  const panelProps = createPanelProps();
  const runner = createCommandRunner({ ...deps, notices, panelProps });
  const palette = createCommandPalette({
    commands: () => deps.contributions().commands,
    run: async (command) => {
      await runner.run(command.extensionId, command.id, undefined, 'palette');
    },
  });
  return { notices, panelProps, runner, palette };
};

export const useExtensionCommands = (): ExtensionCommands => {
  const commands = inject(EXTENSION_COMMANDS_KEY);
  if (!commands) throw new Error('extension commands are not provided');
  return commands;
};
