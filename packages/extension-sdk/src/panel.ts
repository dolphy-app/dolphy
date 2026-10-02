import type { PanelModule } from '@dolphy-app/extension-api';
import type { ResolvedIds } from './ids.ts';

/** An entry of `panels[<panel id>]` in `src/index.ts` (`contributes.panels`); `ctx.call` accepts the declared command ids. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionPanel = (
  module: PanelModule<HTMLElement, ResolvedIds['commands']>,
): PanelModule<HTMLElement, ResolvedIds['commands']> => module;
