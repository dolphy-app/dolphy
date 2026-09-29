import type { EpochMs } from '@lms/engine-contract';
import type { LogEntry } from '../domain/journal.ts';
import type { Clock, EventStore, IdGenerator } from '../ports/index.ts';

export const FIVE_MIN_MS = 300_000;

type BaseKey = 'id' | 'deviceId' | 'seq' | 'at' | 'recordedAt';
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Поля записи, которые задаёт вызывающий; остальное проставляет писатель. */
export type EntryFields = DistributiveOmit<LogEntry, BaseKey>;

export interface JournalWriterDeps {
  clock: Clock;
  ids: IdGenerator;
  eventStore: Pick<EventStore, 'deviceId' | 'lastSeq' | 'maxAt'>;
}

export interface BuildOptions {
  /** `requestId` попытки; по умолчанию uuidv7. */
  id?: string;
  /** Запрошенное время события; по умолчанию `now`. */
  at?: EpochMs;
}

export interface JournalWriter {
  /** Собирает запись, не меняя состояние: повторный `build` до `commit` даёт тот же `seq`. */
  build<F extends EntryFields>(
    fields: F,
    options?: BuildOptions,
  ): F & Pick<LogEntry, BaseKey>;
  /** Вызывать после успешного `append`: `seq` растёт только тогда, без пропусков. */
  commit(entry: Pick<LogEntry, 'seq' | 'at'>): void;
}

export const createJournalWriter = ({
  clock,
  ids,
  eventStore,
}: JournalWriterDeps): JournalWriter => {
  let seq = eventStore.lastSeq();
  let ownPrevAt: EpochMs = 0;

  /** HLC-правило (engine-ts.md §5.1). */
  const computeAt = (requestedAt: EpochMs | undefined): EpochMs => {
    const now = clock.now();
    const clamped = Math.min(requestedAt ?? now, now + FIVE_MIN_MS);
    return Math.max(clamped, eventStore.maxAt() + 1, ownPrevAt);
  };

  const build: JournalWriter['build'] = (fields, options = {}) => ({
    ...fields,
    id: options.id ?? ids.next(),
    deviceId: eventStore.deviceId,
    seq: seq + 1,
    at: computeAt(options.at),
    recordedAt: clock.now(),
  });

  const commit: JournalWriter['commit'] = (entry) => {
    seq = entry.seq;
    ownPrevAt = entry.at;
  };

  return { build, commit };
};
