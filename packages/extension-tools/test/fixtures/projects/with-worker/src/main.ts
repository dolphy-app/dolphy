import type { ExtensionModule } from '@spirula/extension-api';
import { helper } from './helper.ts';

const extension: ExtensionModule = {
  activate: async (context) => {
    const external = await import('spirula-fixture-external');
    context.logger.info({}, helper(external));
  },
};

export default extension;
