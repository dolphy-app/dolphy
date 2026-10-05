import type {
  ContributionsDto,
  WidgetContributionDto,
} from '@dolphy-app/engine-contract';
import { declaredCommands } from '@/shared/lib/declared-commands.ts';

export interface ResolvedWidget {
  widget: WidgetContributionDto;
  /** Ключ рамки: новая `revision` (обновление, правка в режиме разработчика) пересоздаёт её. */
  key: string;
  /** Команды этого расширения, в том числе скрытые из палитры (`palette: false`). */
  commands: ReadonlySet<string>;
}

/** Ключ рамки виджета. */
export const widgetKeyOf = (widget: WidgetContributionDto): string =>
  `${widget.extensionId}:${widget.id}:${widget.revision}`;

/**
 * Виджеты места `slot` включённых расширений в порядке вкладов; пусто — блока
 * нет. Расширение отключено или удалено — его виджетов в наборе уже нет.
 */
export const widgetsOf = (
  contributions: Readonly<ContributionsDto>,
  slot: WidgetContributionDto['slot'],
): ResolvedWidget[] =>
  contributions.widgets
    .filter((widget) => widget.slot === slot)
    .map((widget) => ({
      widget,
      key: widgetKeyOf(widget),
      commands: declaredCommands(contributions, widget.extensionId),
    }));
