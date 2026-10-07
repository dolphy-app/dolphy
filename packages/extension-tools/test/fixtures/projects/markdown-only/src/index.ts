import { defineComponent, h } from 'vue';

const chart = defineComponent({
  props: { source: { type: String, required: true } },
  setup: (props) => () => h('pre', props.source),
});

export const client = (c) => {
  c.addMarkdownRenderer('chart', chart);
};
