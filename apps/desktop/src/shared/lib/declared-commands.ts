import type { ContributionsDto } from '@dolphy-app/engine-contract';

/**
 * Команды расширения по текущим вкладам, в том числе скрытые из палитры
 * (`palette: false`): ровно то, что рамка его панели или виджета вправе вызвать.
 */
export const declaredCommands = (
  contributions: Readonly<Pick<ContributionsDto, 'commands'>>,
  extensionId: string,
): ReadonlySet<string> =>
  new Set(
    contributions.commands
      .filter((command) => command.extensionId === extensionId)
      .map((command) => command.id),
  );
