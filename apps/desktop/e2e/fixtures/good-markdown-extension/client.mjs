// Рендерер, который выводит видимую строку: проверяет вывод блока в дереве окна.
const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Block = defineComponent({
  props: ['source', 'language'],
  setup: (props) => () => h('p', `good block: ${props.source.trim()}`),
});

export const client = (c) => {
  c.addMarkdownRenderer('good', Block);
};
