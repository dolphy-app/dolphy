import type { ExtensionModule } from '@dolphy-app/extension-api';
import { helper } from './helper.ts';

const extension: ExtensionModule = {
  activate: async (context) => {
    const external = await import('dolphy-fixture-external');
    context.logger.info({}, helper(external));
  },
};

export default extension;
