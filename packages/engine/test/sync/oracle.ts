import type { LogEntry } from '../../src/domain/journal.ts';
import type { EventStore } from '../../src/ports/index.ts';
import {
  canon,
  compareEntries,
  compareStrings,
  groupConflicts,
  isClockSkewed,
} from '../../src/sync/index.ts';

/** Наблюдаемое состояние реплики: живые записи и конфликты (без `state`/времён). */
export interface ReplicaState {
  live: string[];
  conflicts: { conflictId: string; reason: string; members: string[] }[];
}

const canonAll = (entries: Iterable<LogEntry>): string[] =>
  [...entries]
    .sort((a, b) => compareEntries(a, b) || compareStrings(canon(a), canon(b)))
    .map((entry) => canon(entry));

/**
 * Оракул: состояние — множество различных записей (по каноническому
 * содержимому); скрытые — чистая функция множества, ничего от порядка прихода.
 */
export const oracleState = (input: Iterable<LogEntry>): ReplicaState => {
  const byCanon = new Map<string, LogEntry>();
  for (const entry of input) byCanon.set(canon(entry), entry);
  const all = [...byCanon.values()];

  const byId = new Map<string, LogEntry[]>();
  const byPair = new Map<string, LogEntry[]>();
  const skewed = new Map<string, LogEntry[]>();
  const push = (map: Map<string, LogEntry[]>, key: string, entry: LogEntry) => {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  };
  for (const entry of all) {
    push(byId, entry.id, entry);
    push(byPair, `${entry.deviceId}#${entry.seq}`, entry);
    if (isClockSkewed(entry)) push(skewed, entry.id, entry);
  }

  const hidden = new Set<string>();
  const conflicts: ReplicaState['conflicts'] = [];
  const add = (reason: string, key: string, members: LogEntry[]) => {
    for (const member of members) hidden.add(canon(member));
    conflicts.push({
      conflictId: `${reason}:${key}`,
      reason,
      members: canonAll(members),
    });
  };
  for (const [id, members] of byId) {
    if (members.length > 1) add('id-content', id, members);
  }
  for (const [pair, members] of byPair) {
    if (new Set(members.map((member) => member.id)).size > 1) {
      add('seq-two-ids', pair, members);
    }
  }
  for (const [id, members] of skewed) add('clock-skew', id, members);

  conflicts.sort((a, b) => compareStrings(a.conflictId, b.conflictId));
  return {
    live: canonAll(all.filter((entry) => !hidden.has(canon(entry)))),
    conflicts,
  };
};

/** Все различные записи хранилища: живые и скрытые (состояние-множество). */
export const setOf = async (store: EventStore): Promise<LogEntry[]> => {
  const found = new Map<string, LogEntry>();
  for await (const entry of store.readAll()) found.set(canon(entry), entry);
  for (const row of await store.conflicts()) {
    found.set(canon(row.entry), row.entry);
  }
  return [...found.values()];
};

export const stateOf = async (store: EventStore): Promise<ReplicaState> => {
  const live: LogEntry[] = [];
  for await (const entry of store.readAll()) live.push(entry);
  const groups = groupConflicts(await store.conflicts());
  return {
    live: canonAll(live),
    conflicts: groups.map((group) => ({
      conflictId: group.conflictId,
      reason: group.reason,
      members: canonAll(group.entries),
    })),
  };
};
