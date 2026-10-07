import { defineMarkdownRenderer } from '@dolphy-app/extension-sdk';
import { defineComponent, h } from 'vue';

export const markdown = {
  chart: defineMarkdownRenderer(
    defineComponent({
      props: { source: { type: String, required: true } },
      setup: (props) => () => h('pre', props.source),
    }),
  ),
};
