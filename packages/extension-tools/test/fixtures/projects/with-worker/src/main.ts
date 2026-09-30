import type { ExtensionModule } from '@lms/extension-api';
import { helper } from './helper.ts';

const extension: ExtensionModule = {
  activate: async (context) => {
    const external = await import('lms-fixture-external');
    context.logger.info({}, helper(external));
  },
};

export default extension;
