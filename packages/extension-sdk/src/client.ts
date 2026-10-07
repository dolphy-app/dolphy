import {
  APP_KEY,
  ENGINE_KEY,
  EXTENSION_ID_KEY,
  INJECTION_HANDLE_KEY,
  PANEL_HANDLE_KEY,
} from '@dolphy-app/extension-api';
import type {
  InjectionHandle,
  PanelHandle,
  RpcContract,
} from '@dolphy-app/extension-api';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import { callRpc } from './rpc.ts';
import { inject } from 'vue';
import type { AppApi } from './define-entry.ts';

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

/**
 * What the window lets an extension do: open a course, a lesson, an exercise,
 * a panel or settings, show a toast, read the theme and the language, run a
 * palette command, mount a component into an element. `theme` and `locale`
 * are reactive. Only inside a component that the app draws.
 */
export const useApp = (): AppApi => {
  const app = inject<AppApi | null>(APP_KEY, null);
  if (app === null) {
    throw new Error(
      'useApp() works inside a component that the app draws, there is no app here',
    );
  }
  return app;
};

/**
 * The engine client of the window: every method of the engine contract,
 * writing ones included, and `subscribe` for the engine events. Only inside a
 * component that the app draws.
 */
export const useEngine = (): ExtensionEngine => {
  const engine = inject<ExtensionEngine | null>(ENGINE_KEY, null);
  if (engine === null) {
    throw new Error(
      'useEngine() works inside a component that the app draws, there is no engine here',
    );
  }
  return engine;
};

/**
 * Binds the contract to the server part of this extension: the returned
 * function validates the input with `contract.input`, calls the handler of
 * `server.handle` and validates the answer with `contract.output`. A schema
 * violation, an error of the handler and an unavailable server reject the
 * promise with an `Error` that carries the message. Call it in `setup`: it
 * reads the extension id and the engine from the component's context. Only
 * inside a component of an extension that the app draws.
 */
export const useRpc = <Input, Output>(
  contract: RpcContract<Input, Output>,
): ((input: Input) => Promise<Output>) => {
  const extensionId = inject<string | null>(EXTENSION_ID_KEY, null);
  if (extensionId === null) {
    throw new Error(
      'useRpc() works inside a component of an extension that the app draws, there is no extension here',
    );
  }
  const engine = useEngine();
  return (input) => callRpc({ engine, extensionId }, contract, input);
};
