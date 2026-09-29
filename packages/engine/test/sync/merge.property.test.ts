import { createMemoryEventStore } from '../../src/node/index.ts';
import { describeMergeProperties } from './merge-properties.ts';

describeMergeProperties({
  name: 'MemoryEventStore',
  numRuns: 3_000,
  create: async () => {
    const store = createMemoryEventStore();
    return { store, dispose: () => store.close() };
  },
});
