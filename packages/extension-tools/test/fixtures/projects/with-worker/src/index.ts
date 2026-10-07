import { defineComponent, h } from 'vue';
import { helper } from './helper.ts';

export const server = async (s) => {
  const external = await import('dolphy-fixture-external');
  s.logger.info({}, helper(external));
};

export const client = (c) => {
  c.addAnswerView(
    'acme.worker',
    defineComponent({ render: () => h('p', 'worker view') }),
  );
};
