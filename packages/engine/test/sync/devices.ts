import { createFakeClock, createTestIds } from '@lms/testkit';
import type { FakeClock } from '@lms/testkit';
import { createJournalWriter } from '../../src/app/index.ts';
import type {
  BuildOptions,
  EntryFields,
  JournalWriter,
} from '../../src/app/index.ts';
import type { LogEntry } from '../../src/domain/journal.ts';
import { createFolderSync } from '../../src/node/index.ts';
import type { FolderSync } from '../../src/node/index.ts';
import type { EventStore } from '../../src/ports/index.ts';
import { createReplica } from '../../src/sync/index.ts';
import type { Replica } from '../../src/sync/index.ts';

/** Хранилище для теста; `path` — файл БД устройства (для SQLite), если нужен. */
export interface TestStore extends EventStore {
  readonly location?: string;
}

export type StoreFactory = (
  deviceId: string,
  slot: string,
) => Promise<TestStore>;

export interface Device {
  readonly deviceId: string;
  readonly store: TestStore;
  readonly clock: FakeClock;
  readonly replica: Replica;
  /** Писатель журнала; после `rotateDeviceId` и догона хвоста — пересоздать. */
  writer: JournalWriter;
  write(fields: EntryFields, options?: BuildOptions): Promise<LogEntry>;
  attempt(exerciseId?: string, grade?: 1 | 2 | 3 | 4 | 5): Promise<LogEntry>;
  many(count: number, exerciseId?: string): Promise<void>;
  folder(dir: string, entriesPerSegment?: number): FolderSync;
  resetWriter(): void;
  all(): Promise<LogEntry[]>;
}

export interface DeviceOptions {
  clock?: FakeClock;
  slot?: string;
}

/** Устройство: хранилище + настоящий `createJournalWriter` (HLC-правило) + реплика. */
export const createDevice = async (
  create: StoreFactory,
  deviceId: string,
  { clock = createFakeClock(), slot = deviceId }: DeviceOptions = {},
): Promise<Device> => {
  const store = await create(deviceId, slot);
  const ids = createTestIds(`${deviceId}-${slot}`);
  const makeWriter = () =>
    createJournalWriter({ clock, ids, eventStore: store });
  const replica = createReplica({ store, clock });

  const device: Device = {
    deviceId,
    store,
    clock,
    replica,
    writer: makeWriter(),
    write: async (fields, options) => {
      const entry = device.writer.build(fields, options);
      await store.append([entry]);
      device.writer.commit(entry);
      return entry as LogEntry;
    },
    attempt: (exerciseId = 'c::l::e1', grade = 3) => {
      clock.advance(1_000);
      return device.write({
        kind: 'attempt',
        exerciseId,
        grade,
        source: 'self',
      });
    },
    many: async (count, exerciseId) => {
      for (let i = 0; i < count; i++) await device.attempt(exerciseId);
    },
    folder: (dir, entriesPerSegment = 5) =>
      createFolderSync({ dir, store, replica, entriesPerSegment }),
    resetWriter: () => {
      device.writer = makeWriter();
    },
    all: async () => {
      const found: LogEntry[] = [];
      for await (const entry of store.readAll()) found.push(entry);
      return found;
    },
  };
  return device;
};
