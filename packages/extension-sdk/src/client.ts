import {
  INJECTION_HANDLE_KEY,
  PANEL_HANDLE_KEY,
} from '@dolphy-app/extension-api';
import type { InjectionHandle, PanelHandle } from '@dolphy-app/extension-api';
import { inject } from 'vue';

/**
 * The handle of the panel the component is drawn for: its id, the reactive
 * `props` it was opened with, the reactive `context` and `call` for the
 * commands of this extension. Only inside a panel component of the app.
 */
export const usePanel = <
  Commands extends string = string,
>(): PanelHandle<Commands> => {
  const handle = inject<PanelHandle<Commands> | null>(PANEL_HANDLE_KEY, null);
  if (handle === null) {
    throw new Error(
      'usePanel() works inside a panel component that the app draws, there is no panel here',
    );
  }
  return handle;
};

/**
 * The handle of the injected component: the `target` element it is drawn at
 * and the `position` relative to it. Only inside a component that
 * `client.addInjection` registered.
 */
export const useInjection = (): InjectionHandle => {
  const handle = inject<InjectionHandle | null>(INJECTION_HANDLE_KEY, null);
  if (handle === null) {
    throw new Error(
      'useInjection() works inside an injected component that the app draws, there is no injection here',
    );
  }
  return handle;
};
