import { randomUUID } from 'node:crypto';
import { EngineError } from '@lms/engine/app';
import type {
  ConflictReason,
  ConflictRow,
  ConflictState,
  EventStore,
  SegmentRecord,
  StoreTx,
} from '@lms/engine/ports';
import {
  DEVICE_ID_PATTERN,
  appendInTx,
  canon,
  createVectorTracker,
  parseEntry,
  unitOf,
} from '@lms/engine/sync';
import type { LogEntry } from '@lms/engine';
import { guard, mapSqliteError } from './errors.ts';
import { SCHEMA_VERSION, migrate, readSchemaVersion } from './migrations.ts';
import type { RepositoryStore } from '@lms/engine/ports';
import { createSqliteRepositoryStore } from './repository-store.ts';
import { createSqliteSettingsStore } from './settings-store.ts';
import type { SqliteSettingsStore } from './settings-store.ts';
import { openBetterSqliteDatabase } from './sql-database.ts';
import type { SqlDatabase, SqlParam } from './sql-database.ts';

export type Durability = 'full' | 'normal';

export interface SqliteEventStoreOptions {
  /** Файл БД (`dataDir/engine.db`); `:memory:` — для проверок. */
  path: string;
  /** Нужен только при создании БД; иначе берётся `meta.device_id`. */
  deviceId?: string;
  /** `full` (по умолчанию): `synchronous=FULL`, на macOS ещё `fullfsync=ON`. */
  durability?: Durability;
  /** Явно включить или выключить `fullfsync`; по умолчанию — macOS и `full`. */
  fullfsync?: boolean;
  /** Порча БД: открыть только на чтение (`append` → `STORE_READONLY`). */
  readOnly?: boolean;
  /** Ожидание писателя до `STORE_BUSY`, мс; по умолчанию 2 000 [ВЫВОД]. */
  busyTimeoutMs?: number;
  /** Время для `meta.created_at`, мс. */
  now?: () => number;
}

export interface StoreInspection {
  journalMode: string;
  synchronous: 'off' | 'normal' | 'full' | 'extra';
  foreignKeys: boolean;
  fullfsync: boolean;
  userVersion: number;
}

export interface SqliteEventStore extends EventStore {
  /** Настройки соединения, прочитанные из `PRAGMA` (диагностика и тесты). */
  inspect(): StoreInspection;
}

const DEFAULT_BUSY_TIMEOUT_MS = 2_000;
const PAGE_SIZE = 5_000;
const SYNCHRONOUS_MODES = ['off', 'normal', 'full', 'extra'] as const;

interface EntryRow {
  device_id: string;
  seq: number;
  id: string;
  kind: string;
  at: number;
  recorded_at: number;
  unit_id: string;
  grade: number | null;
  source: string | null;
  flag: string | null;
  op: string | null;
  extra: string | null;
}

interface ConflictRecordRow {
  conflict_id: string;
  reason: string;
  entry_hash: string;
  state: string;
  id: string;
  device_id: string;
  seq: number;
  payload: string;
  detected_at: number;
}

interface SegmentRow {
  device_id: string;
  name: string;
  sha256: string;
  first_seq: number;
  last_seq: number;
  imported_at: number;
}

const toEntry = (row: EntryRow): LogEntry => {
  const base = {
    id: row.id,
    deviceId: row.device_id,
    seq: row.seq,
    at: row.at,
    recordedAt: row.recorded_at,
  };
  if (row.kind === 'attempt') {
    return {
      ...base,
      kind: 'attempt',
      exerciseId: row.unit_id,
      grade: row.grade as 1,
      source: row.source as 'self',
    };
  }
  if (row.kind === 'unit_flag') {
    return {
      ...base,
      kind: 'unit_flag',
      unitId: row.unit_id,
      flag: row.flag as 'blacklist',
      op: row.op as 'set',
    };
  }
  const extra = row.extra === null ? null : JSON.parse(row.extra);
  const revision = (extra as { libraryRevision?: unknown } | null)
    ?.libraryRevision;
  if (typeof revision !== 'string') {
    return { ...base, kind: 'progress_reset', unitId: row.unit_id };
  }
  return {
    ...base,
    kind: 'progress_reset',
    unitId: row.unit_id,
    libraryRevision: revision,
  };
};

const toParams = (entry: LogEntry): SqlParam[] => {
  const isAttempt = entry.kind === 'attempt';
  const isFlag = entry.kind === 'unit_flag';
  const revision =
    entry.kind === 'progress_reset' ? entry.libraryRevision : undefined;
  return [
    entry.deviceId,
    entry.seq,
    entry.id,
    entry.kind,
    entry.at,
    entry.recordedAt,
    unitOf(entry),
    isAttempt ? entry.grade : null,
    isAttempt ? entry.source : null,
    isFlag ? entry.flag : null,
    isFlag ? entry.op : null,
    revision === undefined
      ? null
      : JSON.stringify({ libraryRevision: revision }),
  ];
};

const parsePayload = (payload: string): LogEntry => {
  const parsed = parseEntry(JSON.parse(payload));
  if (!parsed.ok) {
    throw new EngineError('STORE_CORRUPT', {
      details: { table: 'log_conflict', reason: parsed.reason },
    });
  }
  return parsed.entry;
};

const toConflictRow = (row: ConflictRecordRow): ConflictRow => ({
  conflictId: row.conflict_id,
  reason: row.reason as ConflictReason,
  entryHash: row.entry_hash,
  state: row.state as ConflictState,
  entry: parsePayload(row.payload),
  detectedAt: row.detected_at,
});

const INSERT_ENTRY = `INSERT INTO log_entry
  (device_id, seq, id, kind, at, recorded_at, unit_id, grade, source, flag, op, extra)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_CONFLICT = `INSERT OR REPLACE INTO log_conflict
  (conflict_id, reason, entry_hash, state, id, device_id, seq, payload, detected_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_SEGMENT = `INSERT OR REPLACE INTO imported_segment
  (device_id, name, sha256, first_seq, last_seq, imported_at)
  VALUES (?, ?, ?, ?, ?, ?)`;

const configure = (
  db: SqlDatabase,
  {
    durability,
    fullfsync,
    readOnly,
  }: Required<
    Pick<SqliteEventStoreOptions, 'durability' | 'fullfsync' | 'readOnly'>
  >,
) => {
  if (!readOnly) db.pragma('journal_mode = WAL');
  db.pragma(`synchronous = ${durability === 'full' ? 'FULL' : 'NORMAL'}`);
  db.pragma('foreign_keys = ON');
  if (fullfsync) {
    db.pragma('fullfsync = ON');
    db.pragma('checkpoint_fullfsync = ON');
  }
};

const loadDeviceId = (
  db: SqlDatabase,
  {
    deviceId,
    readOnly,
    now,
  }: Pick<SqliteEventStoreOptions, 'deviceId' | 'readOnly' | 'now'>,
): string => {
  const existing = db
    .prepare<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'device_id'",
    )
    .get();
  if (existing) return existing.value;
  if (readOnly) {
    throw new EngineError('STORE_CORRUPT', {
      details: { reason: 'meta.device_id is missing' },
    });
  }
  const created = deviceId ?? randomUUID();
  if (!DEVICE_ID_PATTERN.test(created)) {
    throw new EngineError('INVALID_ARGUMENT', { details: { deviceId } });
  }
  const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  db.transaction(() => {
    insert.run('device_id', created);
    insert.run('created_at', String((now ?? Date.now)()));
  });
  return created;
};

/** Хранилище журнала поверх порта `SqlDatabase`; открытие — `openSqliteEventStore`. */
export const createSqliteEventStore = (
  db: SqlDatabase,
  options: Omit<SqliteEventStoreOptions, 'path' | 'busyTimeoutMs'>,
): SqliteEventStore => {
  const durability = options.durability ?? 'full';
  const readOnly = options.readOnly ?? false;
  const fullfsync =
    options.fullfsync ??
    (process.platform === 'darwin' && durability === 'full');

  let initialDeviceId: string;
  try {
    configure(db, { durability, fullfsync, readOnly });
    if (readOnly) {
      if (readSchemaVersion(db) !== SCHEMA_VERSION) {
        throw new EngineError('STORE_READONLY', {
          message: 'Database needs migration but is opened read-only',
          details: { userVersion: readSchemaVersion(db) },
        });
      }
    } else {
      migrate(db);
    }
    initialDeviceId = loadDeviceId(db, options);
  } catch (error) {
    db.close();
    throw mapSqliteError(error);
  }

  let deviceId = initialDeviceId;
  let isClosed = false;
  const tracker = createVectorTracker();

  const insertEntry = db.prepare(INSERT_ENTRY);
  const byId = db.prepare<EntryRow>('SELECT * FROM log_entry WHERE id = ?');
  const byPair = db.prepare<EntryRow>(
    'SELECT * FROM log_entry WHERE device_id = ? AND seq = ?',
  );
  const deleteById = db.prepare('DELETE FROM log_entry WHERE id = ?');
  const putConflict = db.prepare(INSERT_CONFLICT);
  const putSegment = db.prepare(INSERT_SEGMENT);
  const conflictsByHash = db.prepare<ConflictRecordRow>(
    'SELECT * FROM log_conflict WHERE entry_hash = ?',
  );
  const conflictsById = db.prepare<ConflictRecordRow>(
    'SELECT * FROM log_conflict WHERE id = ?',
  );
  const conflictsByPair = db.prepare<ConflictRecordRow>(
    'SELECT * FROM log_conflict WHERE device_id = ? AND seq = ?',
  );
  const conflictsByGroup = db.prepare<ConflictRecordRow>(
    'SELECT * FROM log_conflict WHERE conflict_id = ?',
  );
  const allConflicts = db.prepare<ConflictRecordRow>(
    'SELECT * FROM log_conflict ORDER BY conflict_id, entry_hash',
  );
  const allSegments = db.prepare<SegmentRow>('SELECT * FROM imported_segment');
  const firstPage = db.prepare<EntryRow>(
    'SELECT * FROM log_entry ORDER BY at, device_id, seq LIMIT ?',
  );
  const nextPage = db.prepare<EntryRow>(
    `SELECT * FROM log_entry WHERE (at, device_id, seq) > (?, ?, ?)
     ORDER BY at, device_id, seq LIMIT ?`,
  );
  const sinceDevice = db.prepare<EntryRow>(
    'SELECT * FROM log_entry WHERE device_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  );
  const rangeDevice = db.prepare<EntryRow>(
    `SELECT * FROM log_entry WHERE device_id = ? AND seq >= ? AND seq <= ?
     ORDER BY seq`,
  );
  const countEntries = db.prepare<{ total: number }>(
    'SELECT count(*) AS total FROM log_entry',
  );
  const topAt = db.prepare<{ top: number | null }>(
    'SELECT max(at) AS top FROM log_entry',
  );
  const seqPairs = db.prepare<{ device_id: string; seq: number }>(
    `SELECT device_id, seq FROM log_entry
     UNION ALL SELECT device_id, seq FROM log_conflict`,
  );
  const setDeviceId = db.prepare(
    "UPDATE meta SET value = ? WHERE key = 'device_id'",
  );

  guard(() => {
    for (const row of seqPairs.iterate()) tracker.add(row.device_id, row.seq);
  });
  let maxAt = guard(() => topAt.get()?.top ?? 0);

  const ensureOpen = () => {
    if (isClosed) throw new EngineError('ENGINE_CLOSED');
  };

  const findOne = (statement: typeof byId, ...params: SqlParam[]) => {
    const row = statement.get(...params);
    return row ? toEntry(row) : null;
  };

  const transact: EventStore['transact'] = async (work) => {
    ensureOpen();
    const seen: [string, number][] = [];
    let candidateAt = maxAt;

    const tx: StoreTx = {
      findById: (id) => findOne(byId, id),
      findByPair: (device, seq) => findOne(byPair, device, seq),
      insert: (entry) => {
        insertEntry.run(...toParams(entry));
        seen.push([entry.deviceId, entry.seq]);
        if (entry.at > candidateAt) candidateAt = entry.at;
      },
      remove: (id) => {
        deleteById.run(id);
      },
      conflictRowsByHash: (hash) =>
        conflictsByHash.all(hash).map(toConflictRow),
      conflictRowsById: (id) => conflictsById.all(id).map(toConflictRow),
      conflictRowsByPair: (device, seq) =>
        conflictsByPair.all(device, seq).map(toConflictRow),
      conflictRowsByGroup: (conflictId) =>
        conflictsByGroup.all(conflictId).map(toConflictRow),
      putConflictRow: (row) => {
        const { entry } = row;
        putConflict.run(
          row.conflictId,
          row.reason,
          row.entryHash,
          row.state,
          entry.id,
          entry.deviceId,
          entry.seq,
          canon(entry),
          row.detectedAt,
        );
        seen.push([entry.deviceId, entry.seq]);
      },
      putSegment: (segment) => {
        putSegment.run(
          segment.deviceId,
          segment.name,
          segment.sha256,
          segment.firstSeq,
          segment.lastSeq,
          segment.importedAt,
        );
      },
    };

    const result = guard(() => db.transaction(() => work(tx)));
    for (const [device, seq] of seen) tracker.add(device, seq);
    maxAt = candidateAt;
    return result;
  };

  const append: EventStore['append'] = (entries) =>
    transact((tx) => appendInTx(tx, entries));

  const readPage = (last: EntryRow | null): EntryRow[] =>
    guard(() =>
      last
        ? nextPage.all(last.at, last.device_id, last.seq, PAGE_SIZE)
        : firstPage.all(PAGE_SIZE),
    );

  async function* readAll() {
    ensureOpen();
    let last: EntryRow | null = null;
    for (;;) {
      const page = readPage(last);
      for (const row of page) yield toEntry(row);
      if (page.length < PAGE_SIZE) return;
      last = page[page.length - 1]!;
    }
  }

  const readSince: EventStore['readSince'] = async (since, limit) => {
    ensureOpen();
    const found: LogEntry[] = [];
    for (const device of tracker.devices()) {
      const room = limit - found.length;
      if (room <= 0) break;
      const rows = guard(() =>
        sinceDevice.all(device, since[device] ?? 0, room),
      );
      for (const row of rows) found.push(toEntry(row));
    }
    return found;
  };

  const readDevice: EventStore['readDevice'] = async (
    device,
    fromSeq,
    toSeq = Number.MAX_SAFE_INTEGER,
  ) => {
    ensureOpen();
    const rows = guard(() => rangeDevice.all(device, fromSeq, toSeq));
    return rows.map(toEntry);
  };

  const conflicts: EventStore['conflicts'] = async () => {
    ensureOpen();
    return guard(() => allConflicts.all().map(toConflictRow));
  };

  const segments: EventStore['segments'] = async () => {
    ensureOpen();
    const rows = guard(() => allSegments.all());
    return rows.map((row): SegmentRecord => ({
      deviceId: row.device_id,
      name: row.name,
      sha256: row.sha256,
      firstSeq: row.first_seq,
      lastSeq: row.last_seq,
      importedAt: row.imported_at,
    }));
  };

  const rotateDeviceId: EventStore['rotateDeviceId'] = async (next) => {
    ensureOpen();
    if (!DEVICE_ID_PATTERN.test(next)) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { deviceId: next },
      });
    }
    guard(() => db.transaction(() => setDeviceId.run(next)));
    deviceId = next;
  };

  const inspect = (): StoreInspection => ({
    journalMode: String(db.pragma('journal_mode')),
    synchronous: SYNCHRONOUS_MODES[Number(db.pragma('synchronous'))] ?? 'off',
    foreignKeys: Number(db.pragma('foreign_keys')) === 1,
    fullfsync: Number(db.pragma('fullfsync')) === 1,
    userVersion: readSchemaVersion(db),
  });

  return {
    get deviceId() {
      return deviceId;
    },
    lastSeq: () => tracker.maxSeq(deviceId),
    maxAt: () => maxAt,
    append,
    readAll,
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      db.close();
    },
    transact,
    vector: () => tracker.vector(),
    missing: () => tracker.missing(),
    maxSeq: (device) => tracker.maxSeq(device),
    entryCount: () => {
      ensureOpen();
      return guard(() => countEntries.get()?.total ?? 0);
    },
    readSince,
    readDevice,
    conflicts,
    segments,
    rotateDeviceId,
    inspect,
  };
};

const openDatabase = ({
  path,
  busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
  readOnly,
}: SqliteEventStoreOptions) =>
  guard(() =>
    openBetterSqliteDatabase({
      path,
      busyTimeoutMs,
      ...(readOnly !== undefined && { readOnly }),
    }),
  );

/** Открывает (и при необходимости создаёт и мигрирует) `engine.db`. */
export const openSqliteEventStore = (
  options: SqliteEventStoreOptions,
): SqliteEventStore => createSqliteEventStore(openDatabase(options), options);

export interface SqliteStorage {
  events: SqliteEventStore;
  /** Настройки ученика в той же БД; соединение закрывает `events.close()`. */
  settings: SqliteSettingsStore;
  /** Реестр git-репозиториев в той же БД. */
  repositories: RepositoryStore;
}

/** `engine.db` целиком: журнал событий и настройки на одном соединении. */
export const openSqliteStorage = (
  options: SqliteEventStoreOptions,
): SqliteStorage => {
  const db = openDatabase(options);
  const events = createSqliteEventStore(db, options);
  return {
    events,
    settings: createSqliteSettingsStore(db),
    repositories: createSqliteRepositoryStore(db),
  };
};
