import type {
  AppApi as ApiAppApi,
  ClientContext as ApiClientContext,
  Disposable,
  EntryResult,
  ExerciseTypeRegistration,
  InjectionRegistration as ApiInjectionRegistration,
  PanelRegistration as ApiPanelRegistration,
  ServerContext as ApiServerContext,
  ServerEntry as ApiServerEntry,
  SettingValues,
} from '@dolphy-app/extension-api';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import type { Component } from 'vue';

/**
 * What the host gives the server part of an extension: `ServerContext` of the
 * API with `engine` typed as `ExtensionEngine`.
 */
export type ServerContext<S extends SettingValues = SettingValues> =
  ApiServerContext<S, ExtensionEngine>;

/** `export const server` of `src/index.ts`: registers the server contributions; the result, if any, runs when the extension is unloaded. */
export type ServerEntry = ApiServerEntry<ExtensionEngine>;

/**
 * The window capabilities of `useApp()` and `ClientContext.app`: `AppApi` of
 * the API with the component of `mountAt` typed as a Vue component.
 */
export interface AppApi extends Omit<ApiAppApi, 'mountAt'> {
  /** Mounts a Vue component into an element of the window, see `AppApi.mountAt` of the API; the props are passed to the component as is. */
  mountAt(
    target: Element | string,
    component: Component,
    props?: Readonly<Record<string, unknown>>,
  ): Disposable;
}

/** A panel: an app screen drawn by a Vue component of the extension (`client.addPanel`). */
export interface PanelRegistration extends Omit<
  ApiPanelRegistration,
  'component'
> {
  /** Inside it `usePanel()` reaches the props and the commands. */
  component: Component;
}

/** A component drawn in the window at the elements that match `target` (`client.addInjection`). */
export interface InjectionRegistration extends Omit<
  ApiInjectionRegistration,
  'component'
> {
  /** Inside it `useInjection()` reaches the target element and the position. */
  component: Component;
}

/**
 * What the window gives the client part of an extension: `ClientContext` of
 * the API with the components typed as Vue components, `app` typed as
 * `AppApi` and `engine` as `ExtensionEngine`.
 */
export interface ClientContext extends Omit<
  ApiClientContext<ExtensionEngine>,
  'app' | 'addPanel' | 'addInjection' | 'addAnswerView' | 'addMarkdownRenderer'
> {
  /** The same object as `useApp()` in a component. */
  readonly app: AppApi;
  addPanel(reg: PanelRegistration): Disposable;
  addInjection(reg: InjectionRegistration): Disposable;
  /** The component takes the `AnswerViewProps` props and emits `change` (`AnswerChange`) and `submit`. */
  addAnswerView(exerciseTypeId: string, component: Component): Disposable;
  /** The component takes the `MarkdownBlockProps` props. */
  addMarkdownRenderer(language: string, component: Component): Disposable;
}

/** `export const client` of `src/index.ts`: registers the client contributions; the result, if any, runs when the extension is unloaded. */
export type ClientEntry = (
  client: ClientContext,
) => EntryResult | Promise<EntryResult>;

/** `export const server = defineServer((server) => { … })`: registers the server contributions. Returns `entry` as is; it only checks the types. */
/*#__NO_SIDE_EFFECTS__*/
export const defineServer = (entry: ServerEntry): ServerEntry => entry;

/** `export const client = defineClient((client) => { … })`: registers the client contributions. Returns `entry` as is; it only checks the types. */
/*#__NO_SIDE_EFFECTS__*/
export const defineClient = (entry: ClientEntry): ClientEntry => entry;

/** An exercise type registration with `Spec`, `Answer` and `View` inferred from the handlers; pass it to `server.registerExerciseType`. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExerciseType = <Spec, Answer, View>(
  registration: ExerciseTypeRegistration<Spec, Answer, View>,
): ExerciseTypeRegistration<Spec, Answer, View> => registration;
