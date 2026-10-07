const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Panel = defineComponent({ render: () => h('p', 'locale panel') });

export default { panels: { 'acme.locale.panel': Panel } };
