import { describeEventStoreContract } from '../../engine/test/store/contract.ts';
import type { StoreHarness } from '../../engine/test/store/contract.ts';
import { openSqliteEventStore } from '../src/index.ts';
import { useTempDir } from './store-factory.ts';

const temp = useTempDir();
let counter = 0;

describeEventStoreContract('SqliteEventStore', async (deviceId) => {
  const path = `${temp.dir}/contract-${counter++}.db`;
  const open = () =>
    openSqliteEventStore({ path, deviceId, durability: 'normal' });
  const harness: StoreHarness = {
    store: open(),
    reopen: async () => {
      await harness.store.close();
      return open();
    },
    dispose: () => harness.store.close(),
  };
  return harness;
});
