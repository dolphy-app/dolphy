import { createMemoryEventStore } from '../../src/node/index.ts';
import { describeFolderMatrix } from './folder-matrix.ts';

describeFolderMatrix({
  name: 'MemoryEventStore',
  convergenceRuns: process.env.ENGINE_FULL_PROPERTIES === '1' ? 150 : 25,
  create: async (deviceId) => createMemoryEventStore({ deviceId }),
});
