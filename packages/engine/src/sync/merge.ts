import type { EpochMs } from '@lms/engine-contract';
import { EngineError } from '../app/errors.ts';
import type { LogEntry } from '../domain/journal.ts';
import type {
  AppendResult,
  ConflictReason,
  ConflictRow,
  StoreTx,
} from '../ports/index.ts';
import {
  assertEntry,
  compareEntries,
  entryHash,
  isClockSkewed,
} from './entry.ts';

/**
 * Состояние реплики — МНОЖЕСТВО записей (живые в `log_entry` плюс скрытые в
 * `log_conflict`); слияние — объединение множеств, а то, какие записи скрыты, —
 * чистая функция от множества: запись скрыта, если её `id` встречается с двумя
 * содержимыми (`id-content`), её `(deviceId, seq)` — с двумя `id`
 * (`seq-two-ids`) или она из будущего (`clock-skew`). Правило «отклонить
 * входящую» не коммутативно (`report-journal-sync.md` §2, контрпример 1).
 */

export interface MergeOptions {
  detectedAt: EpochMs;
  /** Часы получателя: запись дальше `nowMs + 24 ч` — тоже `clock-skew`. */
  receiverNowMs?: EpochMs;
}

export interface MergeOutcome {
  /** Записи, ставшие живыми. */
  inserted: LogEntry[];
  duplicates: number;
  /** Новые (ещё не виденные) записи, попавшие в карантин. */
  quarantined: number;
  /** Живые записи, скрытые пришедшей записью (проекции надо пересобрать). */
  removed: LogEntry[];
  /** Конфликты, созданные или пополненные этим слиянием. */
  conflictIds: string[];
}

interface Member {
  entry: LogEntry;
  hash: string;
  live: boolean;
}

interface Group {
  reason: ConflictReason;
  members: Map<string, Member>;
}

const groupKey = (reason: ConflictReason, key: string) => `${reason}:${key}`;

const addRows = (
  members: Map<string, Member>,
  rows: readonly ConflictRow[],
) => {
  for (const row of rows) {
    if (members.has(row.entryHash)) continue;
    members.set(row.entryHash, {
      entry: row.entry,
      hash: row.entryHash,
      live: false,
    });
  }
};

const addLive = (members: Map<string, Member>, entry: LogEntry | null) => {
  if (!entry) return;
  const hash = entryHash(entry);
  if (!members.has(hash)) members.set(hash, { entry, hash, live: true });
};

const applyOne = (
  tx: StoreTx,
  entry: LogEntry,
  options: MergeOptions,
  outcome: MergeOutcome,
  touched: Set<string>,
) => {
  const sameId = tx.findById(entry.id);
  const idRows = tx.conflictRowsById(entry.id);
  const pairLive = tx.findByPair(entry.deviceId, entry.seq);
  const pairRows = tx.conflictRowsByPair(entry.deviceId, entry.seq);
  const skewed = isClockSkewed(entry, options.receiverNowMs);
  const isFree =
    !sameId && !pairLive && idRows.length === 0 && pairRows.length === 0;
  if (isFree && !skewed) {
    tx.insert(entry);
    outcome.inserted.push(entry);
    return;
  }

  const hash = entryHash(entry);
  const isKnown =
    (sameId !== null && entryHash(sameId) === hash) ||
    idRows.some((row) => row.entryHash === hash);
  if (isKnown) {
    outcome.duplicates++;
    return;
  }

  const self: Member = { entry, hash, live: false };
  const groups = new Map<string, Group>();

  const idMembers = new Map<string, Member>();
  addLive(idMembers, sameId);
  addRows(idMembers, idRows);
  if (idMembers.size > 0) {
    idMembers.set(hash, self);
    groups.set(groupKey('id-content', entry.id), {
      reason: 'id-content',
      members: idMembers,
    });
  }

  const pairMembers = new Map<string, Member>();
  addLive(pairMembers, pairLive);
  addRows(pairMembers, pairRows);
  const ids = new Set([entry.id]);
  for (const member of pairMembers.values()) ids.add(member.entry.id);
  if (ids.size > 1) {
    pairMembers.set(hash, self);
    const key = `${entry.deviceId}#${entry.seq}`;
    groups.set(groupKey('seq-two-ids', key), {
      reason: 'seq-two-ids',
      members: pairMembers,
    });
  }

  if (skewed) {
    groups.set(groupKey('clock-skew', entry.id), {
      reason: 'clock-skew',
      members: new Map([[hash, self]]),
    });
  }

  const moved = new Map<string, Member>();
  for (const [conflictId, group] of groups) {
    const existing = new Map<string, ConflictRow>();
    for (const row of tx.conflictRowsByGroup(conflictId)) {
      existing.set(row.entryHash, row);
    }
    for (const member of group.members.values()) {
      const row = existing.get(member.hash);
      if (row && row.state !== 'kept') continue;
      tx.putConflictRow({
        conflictId,
        reason: group.reason,
        entryHash: member.hash,
        state: 'open',
        entry: member.entry,
        detectedAt: row?.detectedAt ?? options.detectedAt,
      });
      touched.add(conflictId);
    }
    for (const member of group.members.values()) {
      if (member.live) moved.set(member.hash, member);
    }
  }
  for (const member of moved.values()) {
    tx.remove(member.entry.id);
    outcome.removed.push(member.entry);
  }
  outcome.quarantined++;
};

/** Идемпотентное слияние; записи уже прошли `parseEntry`. */
export const applyIncoming = (
  tx: StoreTx,
  entries: Iterable<LogEntry>,
  options: MergeOptions,
): MergeOutcome => {
  const outcome: MergeOutcome = {
    inserted: [],
    duplicates: 0,
    quarantined: 0,
    removed: [],
    conflictIds: [],
  };
  const touched = new Set<string>();
  for (const entry of entries) applyOne(tx, entry, options, outcome, touched);
  outcome.conflictIds = [...touched].sort();
  return outcome;
};

/**
 * Локальная запись: `id` известен (живой или скрытый) — дубликат; чужой
 * `(deviceId, seq)` под другим `id` — ошибка (писатель обязан идти по
 * `lastSeq`), вся пачка откатывается.
 */
export const appendInTx = (
  tx: StoreTx,
  entries: readonly LogEntry[],
): AppendResult => {
  const appended: LogEntry[] = [];
  const duplicates: string[] = [];
  for (const raw of entries) {
    const entry = assertEntry(raw);
    const isKnown =
      tx.findById(entry.id) !== null ||
      tx.conflictRowsById(entry.id).length > 0;
    if (isKnown) {
      duplicates.push(entry.id);
      continue;
    }
    const isTaken =
      tx.findByPair(entry.deviceId, entry.seq) !== null ||
      tx.conflictRowsByPair(entry.deviceId, entry.seq).length > 0;
    if (isTaken) {
      throw new Error(
        `append: (${entry.deviceId}, ${entry.seq}) is taken by another entry`,
      );
    }
    tx.insert(entry);
    appended.push(entry);
  }
  return { appended, duplicates };
};

export interface ConflictGroup {
  conflictId: string;
  reason: ConflictReason;
  /** Все стороны конфликта в каноническом порядке. */
  entries: LogEntry[];
  /** Есть строка в состоянии `open`. */
  isOpen: boolean;
  detectedAt: EpochMs;
}

/** Строки `log_conflict` → конфликты; порядок по `conflictId`. */
export const groupConflicts = (
  rows: readonly ConflictRow[],
): ConflictGroup[] => {
  const byGroup = new Map<string, ConflictRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.conflictId);
    if (list) list.push(row);
    else byGroup.set(row.conflictId, [row]);
  }
  const groups: ConflictGroup[] = [];
  for (const [conflictId, members] of byGroup) {
    const entries = members
      .map((row) => row.entry)
      .sort((a, b) => compareEntries(a, b));
    groups.push({
      conflictId,
      reason: members[0]!.reason,
      entries,
      isOpen: members.some((row) => row.state === 'open'),
      detectedAt: Math.min(...members.map((row) => row.detectedAt)),
    });
  }
  return groups.sort((a, b) =>
    a.conflictId < b.conflictId ? -1 : Number(a.conflictId > b.conflictId),
  );
};

export interface ResolveOutcome {
  conflictId: string;
  /** `id` оставленной записи; `null` при `keep: 'none'`. */
  kept: string | null;
  /** Записи, вернувшиеся в журнал. */
  restored: LogEntry[];
}

/**
 * Локальное решение: оставленная запись → `kept` и (если её больше ничто не
 * держит) обратно в `log_entry`, остальные → `discarded`. `keep` — `id` записи
 * или её `entryHash` (в `id-content` у сторон общий `id`: берётся первая в
 * каноническом порядке).
 */
export const resolveConflictGroup = (
  tx: StoreTx,
  conflictId: string,
  keep: string,
): ResolveOutcome => {
  const rows = tx.conflictRowsByGroup(conflictId);
  const open = rows.filter((row) => row.state === 'open');
  if (open.length === 0) {
    throw new EngineError('SYNC_CONFLICT_NOT_FOUND', {
      details: { conflictId },
    });
  }
  const candidates = open
    .filter((row) => row.entry.id === keep || row.entryHash === keep)
    .sort((a, b) => compareEntries(a.entry, b.entry));
  if (keep !== 'none' && candidates.length === 0) {
    throw new EngineError('INVALID_ARGUMENT', {
      details: { conflictId, keep },
    });
  }
  const chosen = keep === 'none' ? null : candidates[0]!;
  for (const row of open) {
    const state = row === chosen ? 'kept' : 'discarded';
    tx.putConflictRow({ ...row, state });
  }

  const restored: LogEntry[] = [];
  if (chosen) {
    const holders = tx.conflictRowsByHash(chosen.entryHash);
    const isFree = holders.every((row) => row.state === 'kept');
    const { entry } = chosen;
    const isClear =
      tx.findById(entry.id) === null &&
      tx.findByPair(entry.deviceId, entry.seq) === null;
    if (isFree && isClear) {
      tx.insert(entry);
      restored.push(entry);
    }
  }
  return { conflictId, kept: chosen ? chosen.entry.id : null, restored };
};
