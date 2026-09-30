import type {
  EpochMs,
  MissingSeqs,
  StateVector,
} from '@spirula/engine-contract';
import { EngineError } from '../app/errors.ts';
import type { LogEntry } from '../domain/journal.ts';
import type {
  ConflictRow,
  EventStore,
  SegmentRecord,
  StoreTx,
} from '../ports/index.ts';
import {
  DEVICE_ID_PATTERN,
  assertEntry,
  compareKeys,
  compareStrings,
} from '../sync/entry.ts';
import { appendInTx } from '../sync/merge.ts';
import { createVectorTracker } from '../sync/vector.ts';

export interface MemoryEventStoreOptions {
  deviceId?: string;
  /** Начальное содержимое: как `append`, без проверки транзакцией. */
  entries?: readonly LogEntry[];
}

const pairKey = (deviceId: string, seq: number) => `${deviceId}#${seq}`;
const rowKey = (conflictId: string, entryHash: string) =>
  `${conflictId}\0${entryHash}`;
const segmentKey = ({ deviceId, name, sha256 }: SegmentRecord) =>
  `${deviceId}/${name}#${sha256}`;

/**
 * Эталонная реализация порта `EventStore` в памяти: тот же набор контрактных
 * тестов, что у SQLite. Откат транзакции — журналом обратных действий.
 */
export const createMemoryEventStore = ({
  deviceId: initialDeviceId = 'device-a',
  entries = [],
}: MemoryEventStoreOptions = {}): EventStore => {
  let deviceId = initialDeviceId;
  let isClosed = false;
  let maxAt: EpochMs = 0;
  const live = new Map<string, LogEntry>();
  const pairs = new Map<string, string>();
  const rows = new Map<string, ConflictRow>();
  const registry = new Map<string, SegmentRecord>();
  const tracker = createVectorTracker();

  const ensureOpen = () => {
    if (isClosed) throw new EngineError('ENGINE_CLOSED');
  };

  const rowsWhere = (test: (row: ConflictRow) => boolean) => {
    const found: ConflictRow[] = [];
    for (const row of rows.values()) if (test(row)) found.push(row);
    return found;
  };

  const transact = async <T>(work: (tx: StoreTx) => T): Promise<T> => {
    ensureOpen();
    const undo: (() => void)[] = [];
    const seen: [string, number][] = [];
    let topAt = maxAt;

    const insert = (entry: LogEntry) => {
      const key = pairKey(entry.deviceId, entry.seq);
      if (live.has(entry.id) || pairs.has(key)) {
        throw new Error(`insert: id or (device, seq) is taken: ${entry.id}`);
      }
      live.set(entry.id, entry);
      pairs.set(key, entry.id);
      undo.push(() => {
        live.delete(entry.id);
        pairs.delete(key);
      });
      seen.push([entry.deviceId, entry.seq]);
      if (entry.at > topAt) topAt = entry.at;
    };

    const remove = (id: string) => {
      const entry = live.get(id);
      if (!entry) return;
      const key = pairKey(entry.deviceId, entry.seq);
      live.delete(id);
      pairs.delete(key);
      undo.push(() => {
        live.set(id, entry);
        pairs.set(key, id);
      });
    };

    const putConflictRow = (row: ConflictRow) => {
      const key = rowKey(row.conflictId, row.entryHash);
      const previous = rows.get(key);
      rows.set(key, row);
      undo.push(() => {
        if (previous) rows.set(key, previous);
        else rows.delete(key);
      });
      seen.push([row.entry.deviceId, row.entry.seq]);
    };

    const putSegment = (segment: SegmentRecord) => {
      const key = segmentKey(segment);
      const previous = registry.get(key);
      registry.set(key, segment);
      undo.push(() => {
        if (previous) registry.set(key, previous);
        else registry.delete(key);
      });
    };

    const tx: StoreTx = {
      findById: (id) => live.get(id) ?? null,
      findByPair: (device, seq) => {
        const id = pairs.get(pairKey(device, seq));
        return id === undefined ? null : live.get(id)!;
      },
      insert,
      remove,
      conflictRowsByHash: (hash) => rowsWhere((row) => row.entryHash === hash),
      conflictRowsById: (id) => rowsWhere((row) => row.entry.id === id),
      conflictRowsByPair: (device, seq) =>
        rowsWhere(
          (row) => row.entry.deviceId === device && row.entry.seq === seq,
        ),
      conflictRowsByGroup: (conflictId) =>
        rowsWhere((row) => row.conflictId === conflictId),
      putConflictRow,
      putSegment,
    };

    try {
      const result = work(tx);
      for (const [device, seq] of seen) tracker.add(device, seq);
      maxAt = topAt;
      return result;
    } catch (error) {
      for (const revert of undo.reverse()) revert();
      throw error;
    }
  };

  const append: EventStore['append'] = (batch) =>
    transact((tx) => appendInTx(tx, batch));

  const sortedLive = () => [...live.values()].sort(compareKeys);

  async function* readAll() {
    ensureOpen();
    yield* sortedLive();
  }

  const readSince: EventStore['readSince'] = async (since, limit) => {
    ensureOpen();
    const found: LogEntry[] = [];
    for (const entry of live.values()) {
      if (entry.seq > (since[entry.deviceId] ?? 0)) found.push(entry);
    }
    found.sort(
      (a, b) => compareStrings(a.deviceId, b.deviceId) || a.seq - b.seq,
    );
    return found.slice(0, limit);
  };

  const readDevice: EventStore['readDevice'] = async (
    device,
    fromSeq,
    toSeq = Number.MAX_SAFE_INTEGER,
  ) => {
    ensureOpen();
    const found: LogEntry[] = [];
    for (const entry of live.values()) {
      if (entry.deviceId !== device) continue;
      if (entry.seq >= fromSeq && entry.seq <= toSeq) found.push(entry);
    }
    return found.sort((a, b) => a.seq - b.seq);
  };

  const conflicts: EventStore['conflicts'] = async () => {
    ensureOpen();
    return [...rows.values()].sort(
      (a, b) =>
        compareStrings(a.conflictId, b.conflictId) ||
        compareStrings(a.entryHash, b.entryHash),
    );
  };

  const segments: EventStore['segments'] = async () => {
    ensureOpen();
    return [...registry.values()];
  };

  const rotateDeviceId: EventStore['rotateDeviceId'] = async (next) => {
    ensureOpen();
    if (!DEVICE_ID_PATTERN.test(next)) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { deviceId: next },
      });
    }
    deviceId = next;
  };

  const store: EventStore = {
    get deviceId() {
      return deviceId;
    },
    lastSeq: () => tracker.maxSeq(deviceId),
    maxAt: () => maxAt,
    append,
    readAll,
    close: async () => {
      isClosed = true;
    },
    transact,
    vector: (): StateVector => tracker.vector(),
    missing: (): MissingSeqs => tracker.missing(),
    maxSeq: (device) => tracker.maxSeq(device),
    entryCount: () => live.size,
    readSince,
    readDevice,
    conflicts,
    segments,
    rotateDeviceId,
  };

  for (const entry of entries) {
    const valid = assertEntry(entry);
    live.set(valid.id, valid);
    pairs.set(pairKey(valid.deviceId, valid.seq), valid.id);
    tracker.add(valid.deviceId, valid.seq);
    if (valid.at > maxAt) maxAt = valid.at;
  }
  return store;
};
