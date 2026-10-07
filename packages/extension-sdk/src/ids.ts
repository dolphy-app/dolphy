import type {
  ExtensionContext as ApiExtensionContext,
  ExtensionIdSet,
  MarkdownRendererModule,
  PanelContext as ApiPanelContext,
  PanelModule,
} from '@dolphy-app/extension-api';
import type { Component } from 'vue';
import type { AnswerView } from './answer-view.ts';

/**
 * The ids declared in `extension.json`. Empty here: `dolphy-ext types` (and
 * every `dolphy-ext build`) writes `.dolphy/ids.d.ts`, which augments this
 * interface with one key per kind of id:
 *
 * ```ts
 * declare module '@dolphy-app/extension-sdk' {
 *   interface ExtensionIds {
 *     exerciseTypes: 'acme.echo';
 *     commands: 'acme.a' | 'acme.b';
 *     settings: { 'acme.goal': number };
 *     // …
 *   }
 * }
 * ```
 *
 * While the interface is empty (no generated file) every id is a plain
 * `string` and `defineExtension` does not require any record.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the generated declarations augment it
export interface ExtensionIds {}

type Declared<K extends keyof ExtensionIdSet> = K extends keyof ExtensionIds
  ? ExtensionIds[K] extends ExtensionIdSet[K]
    ? ExtensionIds[K]
    : ExtensionIdSet[K]
  : ExtensionIdSet[K];

/** `ExtensionIds` with the plain-string fallback for the kinds it does not declare. */
export type ResolvedIds = { [K in keyof ExtensionIdSet]: Declared<K> };

/** Whether the generated declarations are part of the program. */
export type HasGeneratedIds = [keyof ExtensionIds] extends [never]
  ? false
  : true;

/**
 * `ExtensionContext` of this extension: `settings`, `events`, `commands` and
 * the `register…` methods accept the declared ids only.
 */
export type ExtensionContext = ApiExtensionContext<ResolvedIds>;

/** Context of a panel module; `call` accepts the declared command ids only. */
export type PanelContext = ApiPanelContext<ResolvedIds['commands']>;

/**
 * A record that holds exactly the declared ids: a missing and an extra key are
 * both compile errors. With no generated declarations any keys are accepted;
 * with none declared of this kind no key is accepted.
 */
export type Exact<Id extends string, Value> = [HasGeneratedIds] extends [false]
  ? { readonly [key: string]: Value }
  : [Id] extends [never]
    ? { readonly [key: string]: never }
    : { readonly [K in Id]: Value };

/** `export const views = { … } satisfies ExtensionViews`: one `defineAnswerView` per declared exercise type. */
export type ExtensionViews = Exact<ResolvedIds['exerciseTypes'], AnswerView>;

/** `export const panels = { … } satisfies ExtensionPanels`: one `defineExtensionPanel` per declared panel. */
export type ExtensionPanels = Exact<
  ResolvedIds['panels'],
  PanelModule<HTMLElement, ResolvedIds['commands']>
>;

/** `export const widgets = { … } satisfies ExtensionWidgets`: one `defineExtensionWidget` per declared widget. */
export type ExtensionWidgets = Exact<ResolvedIds['widgets'], Component>;

/** `export const markdown = { … } satisfies ExtensionMarkdown`: one `defineMarkdownRenderer` per declared language. */
export type ExtensionMarkdown = Exact<
  ResolvedIds['markdownLanguages'],
  MarkdownRendererModule<HTMLElement>
>;
