import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { syncCommands } from '@/shared/lib/command-registry.ts';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandRunner } from './runner.ts';

/** Ключ команды расширения в реестре: источник входит в ключ, чужую запись не затереть. */
export const extensionCommandKey = (
  extensionId: string,
  commandId: string,
): string => `extension:${extensionId}:${commandId}`;

/**
 * Держит в реестре команды `palette: true` из вкладов расширений: новые
 * регистрируются, изменённые обновляются, пропавшие (расширение удалено или
 * отключено) снимаются. Выполнение — прежний исполнитель: проверка по живым
 * вкладам, эффекты, сообщения о сбоях. Команды `palette: false` остаются
 * доступны только панелям. Возвращает остановку со снятием всех записей.
 */
export const syncExtensionCommands = (
  registry: CommandRegistry,
  contributions: () => Readonly<ContributionsDto>,
  runner: CommandRunner,
): (() => void) =>
  syncCommands(registry, () =>
    contributions()
      .commands.filter((command) => command.palette)
      .map((command) => {
        const { extensionId, id } = command;
        const category = command.category ?? undefined;
        const description = command.description ?? undefined;
        const keybinding = command.keybinding ?? undefined;
        return {
          descriptor: {
            key: extensionCommandKey(extensionId, id),
            source: 'extension',
            title: command.title,
            category,
            description,
            caption: extensionId,
            keybinding,
            run: async () => {
              await runner.run(extensionId, id, undefined, 'palette');
            },
          },
          revision: JSON.stringify([
            command.title,
            category,
            description,
            keybinding,
          ]),
        };
      }),
  );
