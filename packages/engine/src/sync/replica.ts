import type { MissingSeqs, StateVector } from '@lms/engine-contract';
import { EngineError } from '../app/errors.ts';
import type { LogEntry } from '../domain/journal.ts';
import type { Clock, EventStore, SegmentRecord } from '../ports/index.ts';
import { MAX_SYNC_BATCH, compareEntries, parseEntry } from './entry.ts';
import {
  applyIncoming,
  groupConflicts,
  resolveConflictGroup,
} from './merge.ts';
import type { ConflictGroup, ResolveOutcome } from './merge.ts';

export interface ReplicaDeps {
  store: EventStore;
  clock: Clock;
}

export interface SyncState {
  deviceId: string;
  vector: StateVector;
  missing: MissingSeqs;
  entryCount: number;
  /** Неразрешённые конфликты. */
  conflictCount: number;
}

export interface ExportRequest {
  since?: StateVector;
  limit?: number;
}

export interface ExportBatch {
  entries: readonly LogEntry[];
  /** Вектор для следующего вызова; нет — всё отдано. */
  next?: StateVector;
}

export interface RejectedEntry {
  /** `id` записи, если он читался; иначе пустая строка. */
  id: string;
  reason: string;
}

export interface ImportOutcome {
  inserted: number;
  duplicates: number;
  /** Структурно неверные записи (схема); конфликты сюда не входят. */
  rejected: RejectedEntry[];
  /** Новые записи, скрытые конфликтом. */
  quarantined: number;
  /** Конфликты, созданные или пополненные импортом. */
  conflictIds: string[];
  /** Записи, ставшие живыми, в порядке `(at, deviceId, seq)`. */
  insertedEntries: LogEntry[];
  /** Проекции надо пересобрать: пришло старее применённого или запись скрыта. */
  needsRebuild: boolean;
}

export interface IngestOptions {
  /** Сегмент FolderSync: попадает в `imported_segment` той же транзакцией. */
  segment?: Omit<SegmentRecord, 'importedAt'>;
}

export interface ResolveResult extends ResolveOutcome {
  needsRebuild: boolean;
}

export interface Replica {
  getState(): Promise<SyncState>;
  /** Записи с `seq` больше префикса `since`, включая записи за дырами. */
  exportSince(request?: ExportRequest): Promise<ExportBatch>;
  /** Идемпотентный импорт извне: схема проверяется, ≤ 5 000 записей за вызов. */
  import(entries: readonly unknown[]): Promise<ImportOutcome>;
  /** Слияние проверенных записей без лимита (сегменты FolderSync, Trane). */
  ingest(
    entries: readonly LogEntry[],
    options?: IngestOptions,
  ): Promise<ImportOutcome>;
  /** Открытые конфликты. */
  listConflicts(): Promise<ConflictGroup[]>;
  resolveConflict(request: {
    conflictId: string;
    keep: string;
  }): Promise<ResolveResult>;
}

const invalidArgument = (details: Record<string, unknown>) =>
  new EngineError('INVALID_ARGUMENT', { details });

export const createReplica = ({ store, clock }: ReplicaDeps): Replica => {
  const listConflicts = async () => {
    const groups = groupConflicts(await store.conflicts());
    return groups.filter((group) => group.isOpen);
  };

  const getState = async (): Promise<SyncState> => ({
    deviceId: store.deviceId,
    vector: store.vector(),
    missing: store.missing(),
    entryCount: store.entryCount(),
    conflictCount: (await listConflicts()).length,
  });

  const exportSince = async ({
    since = {},
    limit = MAX_SYNC_BATCH,
  }: ExportRequest = {}): Promise<ExportBatch> => {
    if (!Number.isInteger(limit) || limit < 1) {
      throw invalidArgument({ limit });
    }
    const size = Math.min(limit, MAX_SYNC_BATCH);
    const found = await store.readSince(since, size + 1);
    if (found.length <= size) return { entries: found };
    const entries = found.slice(0, size);
    const next: StateVector = { ...since };
    for (const entry of entries) {
      next[entry.deviceId] = Math.max(next[entry.deviceId] ?? 0, entry.seq);
    }
    return { entries, next };
  };

  const ingest: Replica['ingest'] = async (entries, options = {}) => {
    const priorMaxAt = store.maxAt();
    const now = clock.now();
    const outcome = await store.transact((tx) => {
      const merged = applyIncoming(tx, entries, {
        detectedAt: now,
        receiverNowMs: now,
      });
      const { segment } = options;
      if (segment) tx.putSegment({ ...segment, importedAt: now });
      return merged;
    });
    const insertedEntries = outcome.inserted.sort((a, b) =>
      compareEntries(a, b),
    );
    const isOlder = insertedEntries.some((entry) => entry.at <= priorMaxAt);
    return {
      inserted: insertedEntries.length,
      duplicates: outcome.duplicates,
      rejected: [],
      quarantined: outcome.quarantined,
      conflictIds: outcome.conflictIds,
      insertedEntries,
      needsRebuild: outcome.removed.length > 0 || isOlder,
    };
  };

  const importEntries: Replica['import'] = async (entries) => {
    if (entries.length > MAX_SYNC_BATCH) {
      throw invalidArgument({ count: entries.length, max: MAX_SYNC_BATCH });
    }
    const valid: LogEntry[] = [];
    const rejected: RejectedEntry[] = [];
    for (const raw of entries) {
      const parsed = parseEntry(raw);
      if (parsed.ok) {
        valid.push(parsed.entry);
        continue;
      }
      const id = (raw as { id?: unknown } | null)?.id;
      rejected.push({
        id: typeof id === 'string' ? id : '',
        reason: parsed.reason,
      });
    }
    const outcome = await ingest(valid);
    return { ...outcome, rejected };
  };

  const resolveConflict: Replica['resolveConflict'] = async ({
    conflictId,
    keep,
  }) => {
    const outcome = await store.transact((tx) =>
      resolveConflictGroup(tx, conflictId, keep),
    );
    return { ...outcome, needsRebuild: outcome.restored.length > 0 };
  };

  return {
    getState,
    exportSince,
    import: importEntries,
    ingest,
    listConflicts,
    resolveConflict,
  };
};
