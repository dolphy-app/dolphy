import type { ContributionsDto } from '@dolphy-app/engine-contract';
import { declaredCommands } from '@/shared/lib/declared-commands.ts';
import type { ClientPanel } from '@/shared/lib/extension-clients.ts';

export interface ResolvedPanel {
  panel: ClientPanel;
  /** Серверные команды этого расширения, в том числе скрытые из палитры (`palette: false`). */
  commands: ReadonlySet<string>;
}

/**
 * Панель из реестра окна и допустимые для неё серверные команды; `null` —
 * панели нет (расширение отключено, удалено, ещё не загрузилось или не
 * загрузилось).
 */
export const resolvePanel = (
  panels: readonly ClientPanel[],
  contributions: Readonly<Pick<ContributionsDto, 'commands'>>,
  extensionId: string,
  panelId: string,
): ResolvedPanel | null => {
  const panel = panels.find(
    (item) => item.extensionId === extensionId && item.id === panelId,
  );
  if (panel === undefined) return null;
  return { panel, commands: declaredCommands(contributions, extensionId) };
};
