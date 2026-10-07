import type { PanelModule } from '@dolphy-app/extension-api';
import type { Component } from 'vue';
import type { ResolvedIds } from './ids.ts';

/** An entry of `panels[<panel id>]` in `src/index.ts` (`contributes.panels`); `ctx.call` accepts the declared command ids. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionPanel = (
  module: PanelModule<HTMLElement, ResolvedIds['commands']>,
): PanelModule<HTMLElement, ResolvedIds['commands']> => module;

/** An entry of `widgets[<widget id>]` in `src/index.ts` (`contributes.widgets`): a Vue component the app draws in the slot. Inside it `useWidget()` reaches the commands. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionWidget = (component: Component): Component =>
  component;
