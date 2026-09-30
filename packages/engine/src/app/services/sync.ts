import type {
  FolderRestoreResult,
  FolderSyncReport,
  ImportResult,
  LogEntryDto,
  RebuildResult,
  ResolveConflictResult,
  SyncConflictDto,
  SyncService,
  SyncStateDto,
  TraneImportResult,
  UnitId,
} from '@spirula-app/engine-contract';
import type { LogEntry } from '../../domain/journal.ts';
import type { FolderSync } from '../../node/folder-sync.ts';
import { importFromTrane } from '../../sync/trane-import.ts';
import type { EngineContext } from '../context.ts';
import { EngineError } from '../errors.ts';
import { paginate } from '../pagination.ts';

const notConfigured = () => new EngineError('SYNC_FOLDER_NOT_CONFIGURED');

/**
 * `sync.*`: слой над `Replica`, `FolderSync` и импортом Trane. Вставленные
 * записи применяются к проекциям по одной; если они старше применённых или
 * скрыты конфликтом — полная пересборка.
 */
export const createSyncService = (ctx: EngineContext): SyncService => {
  let folderCache: { dir: string; sync: FolderSync } | null = null;

  const emitProgress = (unitIds: Iterable<UnitId>) => {
    const unique = [...new Set(unitIds)];
    if (unique.length > 0) {
      ctx.emit({ type: 'progress', unitIds: unique, at: ctx.clock.now() });
    }
  };

  const emitConflicts = async (conflictIds: readonly string[]) => {
    if (conflictIds.length === 0) return;
    const unresolved = (await ctx.replica.listConflicts()).length;
    ctx.emit({
      type: 'sync-conflict',
      conflictIds: [...conflictIds],
      unresolved,
    });
  };

  const applyInserted = (entries: readonly LogEntry[]) => {
    emitProgress(ctx.applyEntries(entries));
  };

  const getState = async (): Promise<SyncStateDto> => ctx.replica.getState();

  const exportSince: SyncService['exportSince'] = async (req = {}) => {
    const { entries, next } = await ctx.replica.exportSince(req);
    return next === undefined
      ? { entries: [...entries] }
      : { entries: [...entries], next };
  };

  const importEntries = async (
    entries: LogEntryDto[],
  ): Promise<ImportResult> => {
    const outcome = await ctx.replica.import(entries);
    const needsRebuild = outcome.needsRebuild;
    if (needsRebuild) await ctx.rebuild();
    else applyInserted(outcome.insertedEntries);
    await emitConflicts(outcome.conflictIds);
    return {
      inserted: outcome.inserted,
      duplicates: outcome.duplicates,
      rejected: outcome.rejected,
      conflicts: outcome.conflictIds.length,
      rebuilt: needsRebuild,
    };
  };

  const rebuild = async (): Promise<RebuildResult> => {
    const startedAtMs = ctx.clock.now();
    await ctx.rebuild();
    return {
      entries: ctx.eventStore.entryCount(),
      ms: ctx.clock.now() - startedAtMs,
    };
  };

  const importTrane = async ({
    traneDir,
  }: {
    traneDir: string;
  }): Promise<TraneImportResult> => {
    if (!ctx.openTraneSource) {
      throw new EngineError('INVALID_ARGUMENT', {
        details: { reason: 'trane-source-unavailable' },
      });
    }
    const source = await ctx.openTraneSource(traneDir);
    const result = await importFromTrane({
      store: ctx.eventStore,
      clock: ctx.clock,
      source,
    });
    if (result.attempts + result.flags > 0) await ctx.rebuild();
    return result;
  };

  const getConflicts: SyncService['getConflicts'] = async (req) => {
    const groups = await ctx.replica.listConflicts();
    const dtos = groups.map((group): SyncConflictDto => ({
      conflictId: group.conflictId,
      reason: group.reason,
      entries: group.entries,
      entryHashes: group.entryHashes,
      detectedAt: group.detectedAt,
    }));
    return paginate(dtos, req);
  };

  const resolveConflict: SyncService['resolveConflict'] = async ({
    conflictId,
    keep,
  }): Promise<ResolveConflictResult> => {
    const outcome = await ctx.replica.resolveConflict({ conflictId, keep });
    if (outcome.needsRebuild) await ctx.rebuild();
    return {
      conflictId: outcome.conflictId,
      kept: outcome.kept,
      rebuilt: outcome.needsRebuild,
    };
  };

  const configuredFolder = async (): Promise<FolderSync> => {
    const { folderSync } = ctx;
    if (!folderSync) throw notConfigured();
    const dir = await folderSync.load();
    if (dir === null) throw notConfigured();
    if (folderCache?.dir !== dir) {
      const sync = folderSync.open({
        dir,
        store: ctx.eventStore,
        replica: ctx.replica,
      });
      folderCache = { dir, sync };
    }
    return folderCache.sync;
  };

  const configure = async ({
    dir,
  }: {
    dir: string;
  }): Promise<{ dir: string }> => {
    const { folderSync } = ctx;
    if (!folderSync) throw notConfigured();
    await folderSync.save(dir);
    folderCache = null;
    const saved = await folderSync.load();
    if (saved === null) throw notConfigured();
    return { dir: saved };
  };

  const syncFolder = async (): Promise<FolderSyncReport> => {
    const folder = await configuredFolder();
    const vectorBefore = ctx.eventStore.vector();
    const report = await folder.sync();
    const hasInserted = report.inserted > 0;
    if (report.needsRebuild) await ctx.rebuild();
    else if (hasInserted) {
      const fresh = await ctx.eventStore.readSince(
        vectorBefore,
        Number.MAX_SAFE_INTEGER,
      );
      applyInserted(fresh);
    }
    await emitConflicts(report.conflictIds);
    return {
      inserted: report.inserted,
      duplicates: report.duplicates,
      rejected: report.rejected,
      pending: report.pending,
      headErrors: report.headErrors,
      corruptSegments: report.corruptSegments,
      pendingSegments: report.pendingSegments,
      applied: report.applied,
      published: report.published,
      conflicts: report.conflictIds.length,
      rebuilt: report.needsRebuild,
    };
  };

  const checkRestore = async (): Promise<FolderRestoreResult> => {
    const folder = await configuredFolder();
    const report = await folder.checkRestore();
    if (report.action === 'none') return { action: 'none' };
    ctx.markDirty();
    await ctx.rebuild();
    return report.newDeviceId === undefined
      ? { action: report.action }
      : { action: report.action, newDeviceId: report.newDeviceId };
  };

  return {
    getState,
    exportSince,
    import: importEntries,
    rebuild,
    importFromTrane: importTrane,
    getConflicts,
    resolveConflict,
    folder: { configure, sync: syncFolder, checkRestore },
  };
};
