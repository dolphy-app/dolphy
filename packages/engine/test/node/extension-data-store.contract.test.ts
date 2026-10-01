import { createMemoryExtensionDataStore } from '../../src/node/memory-extension-data-store.ts';
import { describeExtensionDataStoreContract } from './extension-data-store.contract.ts';

describeExtensionDataStoreContract('memory', async () =>
  createMemoryExtensionDataStore(),
);
