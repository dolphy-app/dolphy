import { defineAnswerView, defineExtension } from '@dolphy-app/extension-sdk';
import { helper } from './helper.ts';

export const host = defineExtension({
  async activate(context) {
    const external = await import('dolphy-fixture-external');
    context.logger.info({}, helper(external));
  },
});

export const views = {
  'acme.worker': defineAnswerView((api) => {
    api.root.textContent = 'worker view';
    return { update() {} };
  }),
};
