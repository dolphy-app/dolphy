import type { EpochMs, Grade } from '@dolphy-app/engine-contract';
import type { LogEntry } from '../domain/journal.ts';
import type { Clock, EventStore } from '../ports/index.ts';
import { FIVE_MIN_MS } from '../app/journal-writer.ts';
import { sha256Hex } from './entry.ts';
import { appendInTx } from './merge.ts';

/** Строка `practice_stats` Trane (`timestamp` — секунды, `score` — 1.0…5.0). */
export interface TraneTrial {
  rowId: number;
  unitId: string;
  score: number | null;
  timestampSec: number | null;
}

/**
 * Чтение каталога `.trane` (`practice_stats.db`, `blacklist.db`,
 * `review_list.db`); SQLite-реализация — в `@dolphy-app/engine-sqlite`.
 */
export interface TraneSource {
  trials(): Iterable<TraneTrial>;
  blacklist(): Iterable<string>;
  reviewList(): Iterable<string>;
}

export interface TraneImportDeps {
  store: EventStore;
  clock: Clock;
  source: TraneSource;
}

export interface TraneImportResult {
  /** Записаны новыми записями журнала. */
  attempts: number;
  flags: number;
  /** Не записаны: нет оценки или времени, оценка вне 1–5, уже импортировано. */
  skipped: number;
}

const gradeOf = (score: number | null): Grade | null => {
  if (score === null || !Number.isFinite(score)) return null;
  const grade = Math.round(score);
  return grade >= 1 && grade <= 5 ? (grade as Grade) : null;
};

const digest = (...parts: (string | number | null)[]) =>
  sha256Hex(parts.join('\0')).slice(0, 32);

/**
 * `id` зависит от устройства: два устройства, импортировавших один каталог,
 * дали бы иначе одинаковые `id` с разным `seq` (`id-content`). Повтор на том же
 * устройстве идемпотентен — известные `id` пропускаются до назначения `seq`.
 */
export const importFromTrane = async ({
  store,
  clock,
  source,
}: TraneImportDeps): Promise<TraneImportResult> => {
  const now = clock.now();
  const { deviceId } = store;
  let skipped = 0;

  const attempts: {
    id: string;
    at: EpochMs;
    exerciseId: string;
    grade: Grade;
  }[] = [];
  for (const trial of source.trials()) {
    const grade = gradeOf(trial.score);
    if (grade === null || trial.timestampSec === null) {
      skipped++;
      continue;
    }
    const id = `trane-${deviceId}-${digest(
      trial.rowId,
      trial.unitId,
      trial.timestampSec,
      trial.score,
    )}`;
    const at = Math.min(trial.timestampSec * 1000, now + FIVE_MIN_MS);
    attempts.push({ id, at, exerciseId: trial.unitId, grade });
  }
  attempts.sort(
    (a, b) => a.at - b.at || Number(a.id > b.id) - Number(a.id < b.id),
  );

  const flags: { id: string; unitId: string; flag: 'blacklist' | 'review' }[] =
    [];
  const collect = (unitIds: Iterable<string>, flag: 'blacklist' | 'review') => {
    for (const unitId of unitIds) {
      const id = `trane-${deviceId}-${flag}-${digest(unitId)}`;
      flags.push({ id, unitId, flag });
    }
  };
  collect(source.blacklist(), 'blacklist');
  collect(source.reviewList(), 'review');

  return store.transact((tx) => {
    let seq = store.lastSeq();
    const isKnown = (id: string) =>
      tx.findById(id) !== null || tx.conflictRowsById(id).length > 0;
    const fresh: LogEntry[] = [];
    let importedAttempts = 0;
    let importedFlags = 0;
    for (const item of attempts) {
      if (isKnown(item.id)) {
        skipped++;
        continue;
      }
      fresh.push({
        id: item.id,
        deviceId,
        seq: ++seq,
        at: item.at,
        recordedAt: now,
        kind: 'attempt',
        exerciseId: item.exerciseId,
        grade: item.grade,
        source: 'trane-import',
      });
      importedAttempts++;
    }
    const flagAt = Math.max(now, store.maxAt() + 1);
    for (const item of flags) {
      if (isKnown(item.id)) {
        skipped++;
        continue;
      }
      fresh.push({
        id: item.id,
        deviceId,
        seq: ++seq,
        at: flagAt,
        recordedAt: now,
        kind: 'unit_flag',
        unitId: item.unitId,
        flag: item.flag,
        op: 'set',
      });
      importedFlags++;
    }
    appendInTx(tx, fresh);
    return { attempts: importedAttempts, flags: importedFlags, skipped };
  });
};
