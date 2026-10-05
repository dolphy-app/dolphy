import type { PanelModule, WidgetModule } from '@dolphy-app/extension-api';
import type { ResolvedIds } from './ids.ts';

/** An entry of `panels[<panel id>]` in `src/index.ts` (`contributes.panels`); `ctx.call` accepts the declared command ids. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionPanel = (
  module: PanelModule<HTMLElement, ResolvedIds['commands']>,
): PanelModule<HTMLElement, ResolvedIds['commands']> => module;

/** An entry of `widgets[<widget id>]` in `src/index.ts` (`contributes.widgets`); `ctx.call` accepts the declared command ids. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionWidget = (
  module: WidgetModule<HTMLElement, ResolvedIds['commands']>,
): WidgetModule<HTMLElement, ResolvedIds['commands']> => module;
