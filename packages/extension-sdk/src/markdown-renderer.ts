import type {
  MarkdownRenderContext,
  MarkdownRendererModule,
} from '@spirula-app/extension-api';

/** `export default defineMarkdownRenderer(...)` в модуле рендерера содержимого. */
export const defineMarkdownRenderer = (
  render: (
    source: string,
    container: HTMLElement,
    context: MarkdownRenderContext,
  ) => void | Promise<void>,
): MarkdownRendererModule<HTMLElement> => ({ render });
