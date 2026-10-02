import type {
  CommandResultDto,
  ContributionsDto,
  ExtensionsService,
} from '@dolphy-app/engine-contract';
import type { JsonValue } from '@dolphy-app/extension-api';
import { describeCommandFailure } from '../lib/failure.ts';
import type { CommandFailure } from '../lib/failure.ts';
import type { Notices } from './notices.ts';
import { panelKey } from './panel-props.ts';
import type { PanelProps } from './panel-props.ts';

/** Кто вызвал: палитре сбой показывается уведомлением, панель получает отказ. */
export type CommandSource = 'palette' | 'panel';

export interface CommandRunnerDeps {
  engine: Pick<ExtensionsService, 'invokeCommand'>;
  /** Текущие вклады: команда и панель проверяются по ним в момент выполнения. */
  contributions: () => Readonly<ContributionsDto>;
  notices: Notices;
  panelProps: PanelProps;
  /** Переход на страницу панели (маршрут знает приложение). */
  openPanel(target: { extensionId: string; panelId: string }): void;
}

export interface CommandRunner {
  /**
   * Выполняет команду и эффекты её результата одинаково для палитры и панели:
   * `notify` — уведомление, `openPanel` — переход со свойствами, `data` —
   * значение вызывающему. Сбой: палитре — уведомление и `undefined`, панели —
   * отклонённый промис с текстом сбоя.
   */
  run(
    extensionId: string,
    commandId: string,
    args: JsonValue | undefined,
    source: CommandSource,
  ): Promise<JsonValue | undefined>;
}

/** Отказ вызова команды, который панель получает как `Error`. */
export class CommandRejected extends Error {
  readonly failure: CommandFailure;

  constructor(failure: CommandFailure) {
    super(failure.message);
    this.name = 'CommandRejected';
    this.failure = failure;
  }
}

const CHANGED: CommandFailure = { kind: 'changed', message: '' };

export const createCommandRunner = (deps: CommandRunnerDeps): CommandRunner => {
  const isDeclared = (extensionId: string, commandId: string): boolean =>
    deps
      .contributions()
      .commands.some(
        (command) =>
          command.extensionId === extensionId && command.id === commandId,
      );

  const openDeclaredPanel = (
    extensionId: string,
    panelId: string,
    props: JsonValue | undefined,
  ) => {
    const exists = deps
      .contributions()
      .panels.some(
        (panel) => panel.extensionId === extensionId && panel.id === panelId,
      );
    if (!exists) {
      deps.notices.push({ kind: 'failure', failure: CHANGED });
      return;
    }
    deps.panelProps.set(panelKey(extensionId, panelId), props);
    deps.openPanel({ extensionId, panelId });
  };

  const applyEffect = (
    extensionId: string,
    result: CommandResultDto,
  ): JsonValue | undefined => {
    if (result.kind === 'notify') {
      deps.notices.push({ kind: 'notify', text: result.text });
    } else if (result.kind === 'openPanel') {
      openDeclaredPanel(extensionId, result.panelId, result.props);
    }
    return result.kind === 'data' ? result.value : undefined;
  };

  const execute = async (
    extensionId: string,
    commandId: string,
    args: JsonValue | undefined,
  ): Promise<JsonValue | undefined> => {
    if (!isDeclared(extensionId, commandId)) throw new CommandRejected(CHANGED);
    try {
      const result = await deps.engine.invokeCommand(
        extensionId,
        commandId,
        args,
      );
      return applyEffect(extensionId, result);
    } catch (error) {
      throw new CommandRejected(describeCommandFailure(error));
    }
  };

  return {
    run: (extensionId, commandId, args, source) =>
      execute(extensionId, commandId, args).catch((error: unknown) => {
        if (!(error instanceof CommandRejected) || source === 'panel') {
          throw error;
        }
        deps.notices.push({ kind: 'failure', failure: error.failure });
        return undefined;
      }),
  };
};
