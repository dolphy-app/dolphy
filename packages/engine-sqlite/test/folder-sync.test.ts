import { describeFolderMatrix } from '../../engine/test/sync/folder-matrix.ts';
import { openTestStore, useTempDir } from './store-factory.ts';

const temp = useTempDir();

describeFolderMatrix({
  name: 'SqliteEventStore',
  convergenceRuns: process.env.ENGINE_FULL_PROPERTIES === '1' ? 150 : 15,
  create: async (deviceId, slot) => openTestStore(temp.dir, slot, deviceId),
});
