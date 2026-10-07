const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Block = defineComponent({
  props: ['source', 'language'],
  setup: (props) => () => h('p', props.source.trim()),
});

export default { markdown: { locale: Block } };
