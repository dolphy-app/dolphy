import { MOUNTABLE } from '@dolphy-app/extension-api';
import type {
  AnswerViewProps,
  AppApi as ApiAppApi,
  ClientContext as ApiClientContext,
  Disposable,
  EntryResult,
  ExerciseTypeRegistration,
  InjectionHandle,
  InjectionProps,
  InjectionRegistration as ApiInjectionRegistration,
  MarkdownBlockProps,
  MountContext as ApiMountContext,
  PanelHandle,
  PanelProps,
  PanelRegistration as ApiPanelRegistration,
  ServerContext as ApiServerContext,
  ServerEntry as ApiServerEntry,
  SettingValues,
  Unmount,
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

/**
 * What a `Mountable` gets: `MountContext` of the API with `engine` typed as
 * `ExtensionEngine` and `app` as `AppApi`. `Handle` is `PanelHandle` in a
 * panel, `InjectionHandle` in an injection, `undefined` elsewhere.
 */
export interface MountContext<Props = unknown, Handle = undefined> extends Omit<
  ApiMountContext<Props, ExtensionEngine, Handle>,
  'app'
> {
  readonly app: AppApi;
}

/**
 * A component of any framework: `mount` draws into `el` and returns the
 * cleanup (see `Mountable` of the API). Build it with `defineMountable`.
 */
export interface Mountable<Props = unknown, Handle = undefined> {
  readonly [MOUNTABLE]: true;
  mount(
    el: HTMLElement,
    ctx: MountContext<Props, Handle>,
  ): Unmount | Promise<Unmount>;
}

/** A panel: an app screen drawn by a Vue component or a `Mountable` of the extension (`client.addPanel`). */
export interface PanelRegistration extends Omit<
  ApiPanelRegistration,
  'component'
> {
  /** Inside a Vue component `usePanel()` reaches the props and the commands, in a `Mountable` `ctx.handle` does. */
  component: Component | Mountable<PanelProps, PanelHandle>;
}

/** A component drawn in the window at the elements that match `target` (`client.addInjection`). */
export interface InjectionRegistration extends Omit<
  ApiInjectionRegistration,
  'component'
> {
  /** Inside a Vue component `useInjection()` reaches the target element and the position, in a `Mountable` `ctx.handle` does. */
  component: Component | Mountable<InjectionProps, InjectionHandle>;
}

/**
 * What the window gives the client part of an extension: `ClientContext` of
 * the API with the components typed as Vue components or `Mountable`s, `app`
 * typed as `AppApi` and `engine` as `ExtensionEngine`.
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
  addAnswerView(
    exerciseTypeId: string,
    component: Component | Mountable<AnswerViewProps>,
  ): Disposable;
  /** The component takes the `MarkdownBlockProps` props. */
  addMarkdownRenderer(
    language: string,
    component: Component | Mountable<MarkdownBlockProps>,
  ): Disposable;
}

/**
 * `export const panel = defineMountable<PanelProps, PanelHandle>((el, ctx) => { … return () => … })`:
 * a component of any framework. `mount` draws into `el` and returns the
 * cleanup that the app calls when it removes the element. Returns an object
 * that carries the brand `isMountable` recognises.
 */
/*#__NO_SIDE_EFFECTS__*/
export const defineMountable = <Props = unknown, Handle = undefined>(
  mount: Mountable<Props, Handle>['mount'],
): Mountable<Props, Handle> => ({ [MOUNTABLE]: true, mount });

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
