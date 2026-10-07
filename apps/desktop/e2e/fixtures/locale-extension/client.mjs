const { defineComponent, h } = await globalThis.__dolphy.require('vue');

const Answer = defineComponent({
  props: ['view', 'value', 'disabled', 'verdict', 'label'],
  emits: ['change', 'submit'],
  render: () => h('div', { 'data-testid': 'acme-locale-answer' }),
});

const Panel = defineComponent({ render: () => h('p', 'locale panel') });

const Block = defineComponent({
  props: ['source', 'language'],
  setup: (props) => () => h('p', props.source.trim()),
});

export const client = (c) => {
  c.addAnswerView('acme.locale', Answer);
  c.addMarkdownRenderer('locale', Block);
  c.addPanel({
    id: 'acme.locale.panel',
    title: { en: 'Locale panel', ru: 'Панель перевода' },
    component: Panel,
  });
  c.addTheme({
    id: 'acme.locale.moss',
    label: { en: 'Moss', ru: 'Мох' },
    dark: true,
    colors: {
      background: '#202418',
      surface: '#2A3020',
      primary: '#C8E06A',
      'on-primary': '#202418',
    },
  });
};
