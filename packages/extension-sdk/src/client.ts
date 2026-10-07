import { PANEL_HANDLE_KEY, WIDGET_HANDLE_KEY } from '@dolphy-app/extension-api';
import type { PanelHandle, WidgetHandle } from '@dolphy-app/extension-api';
import { inject } from 'vue';
import type { ResolvedIds } from './ids.ts';

/**
 * The handle of the widget the component is drawn for: its id, the reactive
 * `context` and `call` for the commands of this extension. Only inside a
 * widget component of the app.
 */
export const useWidget = <
  Commands extends string = ResolvedIds['commands'],
>(): WidgetHandle<Commands> => {
  const handle = inject<WidgetHandle<Commands> | null>(WIDGET_HANDLE_KEY, null);
  if (handle === null) {
    throw new Error(
      'useWidget() works inside a widget component that the app draws, there is no widget here',
    );
  }
  return handle;
};

/**
 * The handle of the panel the component is drawn for: its id, the reactive
 * `props` it was opened with, the reactive `context` and `call` for the
 * commands of this extension. Only inside a panel component of the app.
 */
export const usePanel = <
  Commands extends string = ResolvedIds['commands'],
>(): PanelHandle<Commands> => {
  const handle = inject<PanelHandle<Commands> | null>(PANEL_HANDLE_KEY, null);
  if (handle === null) {
    throw new Error(
      'usePanel() works inside a panel component that the app draws, there is no panel here',
    );
  }
  return handle;
};
