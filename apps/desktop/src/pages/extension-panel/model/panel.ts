import type {
  ContributionsDto,
  PanelContributionDto,
} from '@dolphy-app/engine-contract';

export interface ResolvedPanel {
  panel: PanelContributionDto;
  /** Команды этого расширения, в том числе скрытые из палитры (`palette: false`). */
  commands: ReadonlySet<string>;
}

/**
 * Панель и допустимые для неё команды по текущим вкладам; `null` — панели нет
 * (расширение отключено, удалено или ещё не загружено).
 */
export const resolvePanel = (
  contributions: Readonly<ContributionsDto>,
  extensionId: string,
  panelId: string,
): ResolvedPanel | null => {
  const panel = contributions.panels.find(
    (item) => item.extensionId === extensionId && item.id === panelId,
  );
  if (panel === undefined) return null;
  return {
    panel,
    commands: new Set(
      contributions.commands
        .filter((command) => command.extensionId === extensionId)
        .map((command) => command.id),
    ),
  };
};

/** Ключ рамки: новая `revision` (обновление, правка в режиме разработчика) пересоздаёт её. */
export const frameKeyOf = (panel: PanelContributionDto): string =>
  `${panel.extensionId}:${panel.id}:${panel.revision}`;
