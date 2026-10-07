// Рендерер, который всегда падает: проверяет, что приложение остаётся рабочим.
const { defineComponent } = await globalThis.__dolphy.require('vue');

const Block = defineComponent({
  props: ['source', 'language'],
  render() {
    throw new Error('boom');
  },
});

export const client = (c) => {
  c.addMarkdownRenderer('boom', Block);
};
