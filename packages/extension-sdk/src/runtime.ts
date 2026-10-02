import type {
  MarkdownRendererModule,
  PanelModule,
} from '@dolphy-app/extension-api';

export { registerAnswerView } from './answer-element.ts';

type PanelEntry = PanelModule<HTMLElement>;
type MarkdownEntry = MarkdownRendererModule<HTMLElement>;

/** Модуль панели, который выбирает запись `panels` по `ctx.panelId` (для файла, общего нескольким панелям). */
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

/** Модуль рендерера, который выбирает запись `markdown` по языку блока. */
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
