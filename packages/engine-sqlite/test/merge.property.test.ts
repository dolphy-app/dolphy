import { describeMergeProperties } from '../../engine/test/sync/merge-properties.ts';
import { openSqliteEventStore } from '../src/index.ts';

describeMergeProperties({
  name: 'SqliteEventStore',
  numRuns: process.env.ENGINE_FULL_PROPERTIES === '1' ? 3_000 : 300,
  create: async () => {
    const store = openSqliteEventStore({
      path: ':memory:',
      deviceId: 'dev-a',
      durability: 'normal',
    });
    return { store, dispose: () => store.close() };
  },
});
