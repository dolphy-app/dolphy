import type {
  MarkdownRendererModule,
  PanelModule,
  WidgetModule,
} from '@dolphy-app/extension-api';

export { registerAnswerView } from './answer-element.ts';

type PanelEntry = PanelModule<HTMLElement>;
type WidgetEntry = WidgetModule<HTMLElement>;
type MarkdownEntry = MarkdownRendererModule<HTMLElement>;

/** Panel module that selects the `panels` entry by `ctx.panelId` (for a file shared by several panels). */
export const dispatchPanels = (
  panels: Readonly<Record<string, PanelEntry>>,
): PanelEntry => ({
  mount(container, context) {
    const panel = panels[context.panelId];
    if (panel === undefined) {
      throw new Error(`panel '${context.panelId}' is not exported`);
    }
    return panel.mount(container, context);
  },
});

/** Widget module that selects the `widgets` entry by `ctx.widgetId` (for a file shared by several widgets). */
export const dispatchWidgets = (
  widgets: Readonly<Record<string, WidgetEntry>>,
): WidgetEntry => ({
  mount(container, context) {
    const widget = widgets[context.widgetId];
    if (widget === undefined) {
      throw new Error(`widget '${context.widgetId}' is not exported`);
    }
    return widget.mount(container, context);
  },
});

/** Renderer module that selects the `markdown` entry by block language. */
export const dispatchMarkdown = (
  renderers: Readonly<Record<string, MarkdownEntry>>,
): MarkdownEntry => ({
  render(source, container, context) {
    const renderer = renderers[context.language];
    if (renderer === undefined) {
      throw new Error(
        `markdown renderer '${context.language}' is not exported`,
      );
    }
    return renderer.render(source, container, context);
  },
});
