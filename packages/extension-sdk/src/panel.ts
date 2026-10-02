import type { PanelModule } from '@dolphy-app/extension-api';

/** `export default defineExtensionPanel({ mount })` в модуле панели (`contributes.panels`). */
export const defineExtensionPanel = (
  module: PanelModule<HTMLElement>,
): PanelModule<HTMLElement> => module;
