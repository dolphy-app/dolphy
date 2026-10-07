import type { Component } from 'vue';

/** An entry of `views[<exercise type id>]` in `src/index.ts`: a Vue component with the `AnswerViewProps` props that emits `change` (`AnswerChange`) and `submit`. */
/*#__NO_SIDE_EFFECTS__*/
export const defineAnswerView = (component: Component): Component => component;

/** An entry of `panels[<panel id>]` in `src/index.ts` (`contributes.panels`): a Vue component the app draws in the panel. Inside it `usePanel()` reaches the props and the commands. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionPanel = (component: Component): Component =>
  component;

/** An entry of `widgets[<widget id>]` in `src/index.ts` (`contributes.widgets`): a Vue component the app draws in the slot. Inside it `useWidget()` reaches the commands. */
/*#__NO_SIDE_EFFECTS__*/
export const defineExtensionWidget = (component: Component): Component =>
  component;

/** An entry of `markdown[<language>]` in `src/index.ts` (`contributes.markdownRenderers`): a Vue component with the `MarkdownBlockProps` props. */
/*#__NO_SIDE_EFFECTS__*/
export const defineMarkdownRenderer = (component: Component): Component =>
  component;
