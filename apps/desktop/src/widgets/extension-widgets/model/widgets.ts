import type {
  ContributionsDto,
  WidgetContributionDto,
} from '@dolphy-app/engine-contract';
import { declaredCommands } from '@/shared/lib/declared-commands.ts';
import type { ExtensionWhen } from '@/shared/lib/extension-when.ts';

export interface ResolvedWidget {
  widget: WidgetContributionDto;
  /** Ключ карточки: новая `revision` (обновление, правка в режиме разработчика) пересоздаёт компонент. */
  key: string;
  /** Команды этого расширения, в том числе скрытые из палитры (`palette: false`). */
  commands: ReadonlySet<string>;
}

/** Ключ карточки виджета. */
export const widgetKeyOf = (widget: WidgetContributionDto): string =>
  `${widget.extensionId}:${widget.id}:${widget.revision}`;

/**
 * Виджеты места `slot` включённых расширений в порядке вкладов; пусто — блока
 * нет. Расширение отключено или удалено — его виджетов в наборе уже нет.
 * Виджет с ложным `when` не рисуется: компонент не создаётся, пока условие не
 * станет истинным.
 */
export const widgetsOf = (
  contributions: Readonly<ContributionsDto>,
  slot: WidgetContributionDto['slot'],
  when: Pick<ExtensionWhen, 'matches'>,
): ResolvedWidget[] =>
  contributions.widgets
    .filter((widget) => widget.slot === slot && when.matches(widget.when))
    .map((widget) => ({
      widget,
      key: widgetKeyOf(widget),
      commands: declaredCommands(contributions, widget.extensionId),
    }));
