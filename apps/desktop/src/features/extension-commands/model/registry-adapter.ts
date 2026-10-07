import type { BindingDefinition } from '@dolphy-app/keybindings';
import type {
  ContributionsDto,
  LocalizedTextDto,
} from '@dolphy-app/engine-contract';
import { resolveLocalizedText } from '@dolphy-app/extension-api';
import type { RegisteredKeybinding } from '@dolphy-app/extension-api';
import { syncCommands } from '@/shared/lib/command-registry.ts';
import { extensionIconOf } from '@/shared/config/extension-icons.ts';
import type { ExtensionClients } from '@/shared/lib/extension-clients.ts';
import type { ExtensionWhen } from '@/shared/lib/extension-when.ts';
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

/** Команда палитры расширения: серверная (через движок) или клиентская (в окне). */
interface PaletteCommand {
  extensionId: string;
  id: string;
  title: LocalizedTextDto;
  description: LocalizedTextDto | null;
  category: LocalizedTextDto | null;
  icon: string;
  when: string | null;
  keybindings: readonly RegisteredKeybinding[];
  run(): Promise<void>;
}

type ServerContributions = Pick<ContributionsDto, 'commands'>;

/**
 * Команды `palette: true` обоих источников: серверные, затем клиентские; по
 * `extensionId` (порядок приоритета между расширениями), внутри расширения —
 * по порядку вклада. Повтор ключа отбрасывается: серверная команда главнее.
 */
const paletteCommands = (
  contributions: Readonly<ServerContributions>,
  clients: Pick<ExtensionClients, 'commands'>,
  runner: Pick<CommandRunner, 'run' | 'runClient'> | null,
): PaletteCommand[] => {
  const server = contributions.commands
    .filter(({ palette }) => palette)
    .map((command): PaletteCommand => ({
      ...command,
      run: async () => {
        await runner?.run(
          command.extensionId,
          command.id,
          undefined,
          'palette',
        );
      },
    }));
  const client = clients.commands.value
    .filter(({ palette }) => palette)
    .map((command): PaletteCommand => ({
      ...command,
      run: async () => {
        await runner?.runClient(command);
      },
    }));
  const seen = new Set<string>();
  return [...server, ...client]
    .filter((command) => {
      const key = extensionCommandKey(command.extensionId, command.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .toSorted((left, right) => compare(left.extensionId, right.extensionId));
};

/**
 * Привязки команд расширений для карты привязок: `keybindings` серверных и
 * клиентских команд `palette: true` (их и держит реестр). Порядок задаёт
 * приоритет между расширениями: по `extensionId`, затем по порядку вклада.
 * Привязки не входят в описание команды: их смена обновляет карту без
 * перерегистрации команды.
 */
export const extensionBindings = (
  contributions: Readonly<ServerContributions>,
  clients: Pick<ExtensionClients, 'commands'>,
): BindingDefinition[] =>
  paletteCommands(contributions, clients, null).flatMap((command) => {
    const key = extensionCommandKey(command.extensionId, command.id);
    return command.keybindings.map((binding) => ({ ...binding, command: key }));
  });

/**
 * Держит в реестре команды `palette: true` из вкладов расширений, серверные и
 * клиентские: новые регистрируются, изменённые обновляются, пропавшие
 * (расширение удалено или отключено) снимаются. Серверная команда
 * выполняется прежним исполнителем (проверка по живым вкладам, эффекты,
 * сообщения о сбоях), клиентская — вызовом `run` в окне. Команды
 * `palette: false` остаются доступны только панелям. Подписи выбирает по языку
 * `locale`: смена языка меняет их без повторной регистрации. Пока `when`
 * команды ложно, она недоступна (`enabled`): её нет в палитре и сочетание её
 * не выполняет, а панели расширения по-прежнему вызывают серверную команду
 * через мост. Возвращает остановку со снятием всех записей.
 */
export const syncExtensionCommands = (
  registry: CommandRegistry,
  contributions: () => Readonly<ServerContributions>,
  clients: Pick<ExtensionClients, 'commands'>,
  runner: Pick<CommandRunner, 'run' | 'runClient'>,
  locale: () => string,
  when: ExtensionWhen,
): (() => void) =>
  syncCommands(registry, () =>
    paletteCommands(contributions(), clients, runner).map((command) => {
      const { extensionId, id, category, description } = command;
      const text = (value: LocalizedTextDto) =>
        resolveLocalizedText(value, locale());
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
          // условие читает реактивные ключи окна: смена маршрута, курса, языка и темы пересчитывает список
          enabled: () => when.matches(command.when),
          run: command.run,
        },
        revision: JSON.stringify([
          command.title,
          category,
          description,
          command.icon,
          command.when,
        ]),
      };
    }),
  );
