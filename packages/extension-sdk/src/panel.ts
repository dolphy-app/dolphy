import type { PanelModule } from '@dolphy-app/extension-api';

/** Запись `panels[<id панели>]` в `src/index.ts` (`contributes.panels`). */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionPanel = (
  module: PanelModule<HTMLElement>,
): PanelModule<HTMLElement> => module;
