import type {
  MarkdownRenderContext,
  MarkdownRendererModule,
} from '@dolphy-app/extension-api';

/** Entry `markdown[<language>]` in `src/index.ts` (`contributes.markdownRenderers`). */
/*#__NO_SIDE_EFFECTS__*/
export const defineMarkdownRenderer = (
  render: (
    source: string,
    container: HTMLElement,
    context: MarkdownRenderContext,
  ) => void | Promise<void>,
): MarkdownRendererModule<HTMLElement> => ({ render });
