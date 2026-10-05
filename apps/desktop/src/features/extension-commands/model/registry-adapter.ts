import type { BindingDefinition } from '@dolphy-app/keybindings';
import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { syncCommands } from '@/shared/lib/command-registry.ts';
import { extensionIconOf } from '@/shared/config/extension-icons.ts';
import { textOfExtension } from '@/shared/lib/extension-text.ts';
import type { CommandRegistry } from '@/shared/lib/command-registry.ts';
import type { CommandRunner } from './runner.ts';

/** Ключ команды расширения в реестре: источник входит в ключ, чужую запись не затереть. */
export const extensionCommandKey = (
  extensionId: string,
  commandId: string,
): string => `extension:${extensionId}:${commandId}`;

const compare = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/**
 * Привязки команд расширений для карты привязок: сначала запись-сокращение
 * `keybinding`, затем `keybindings`; только `palette: true` (их и держит
 * реестр). Порядок задаёт приоритет между расширениями: по `extensionId`, затем
 * по порядку вклада. Привязки не входят в описание команды: их смена
 * обновляет карту без перерегистрации команды.
 */
export const extensionBindings = (
  contributions: Readonly<ContributionsDto>,
): BindingDefinition[] =>
  contributions.commands
    .filter(({ palette }) => palette)
    .map((command, index) => ({ command, index }))
    .sort(
      (left, right) =>
        compare(left.command.extensionId, right.command.extensionId) ||
        left.index - right.index,
    )
    .flatMap(({ command }) => {
      const key = extensionCommandKey(command.extensionId, command.id);
      const shorthand =
        command.keybinding === null
          ? []
          : [{ command: key, key: command.keybinding }];
      return [
        ...shorthand,
        ...command.keybindings.map((binding) => ({ ...binding, command: key })),
      ];
    });

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
            icon: extensionIconOf(command.icon),
            run: async () => {
              await runner.run(extensionId, id, undefined, 'palette');
            },
          },
          revision: JSON.stringify([
            command.title,
            category,
            description,
            command.icon,
          ]),
        };
      }),
  );
