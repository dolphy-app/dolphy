import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { syncCommands } from '@/shared/lib/command-registry.ts';
import { textOfExtension } from '@/shared/lib/extension-text.ts';
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
 * доступны только панелям. Подписи (`%ключ%`) подставляет `locale`: смена
 * языка меняет их без повторной регистрации. Возвращает остановку со снятием всех записей.
 */
export const syncExtensionCommands = (
  registry: CommandRegistry,
  contributions: () => Readonly<ContributionsDto>,
  runner: CommandRunner,
  locale: () => string,
): (() => void) =>
  syncCommands(registry, () =>
    contributions()
      .commands.filter((command) => command.palette)
      .map((command) => {
        const { extensionId, id } = command;
        const { category, description } = command;
        const keybinding = command.keybinding ?? undefined;
        // `%ключ%` подставляется при каждом чтении: язык и таблицы следуют за окном без повторной регистрации
        const text = (value: string) =>
          textOfExtension(value, extensionId, contributions(), locale());
        return {
          descriptor: {
            key: extensionCommandKey(extensionId, id),
            source: 'extension',
            title: () => text(command.title),
            category: () => (category === null ? undefined : text(category)),
            description: () =>
              description === null ? undefined : text(description),
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
