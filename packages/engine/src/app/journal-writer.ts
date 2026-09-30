import type { EpochMs } from '@dolphy-app/engine-contract';
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
  /**
   * Пакет записей одной транзакции: `seq` подряд от `lastSeq + 1`, `at` по
   * HLC-правилу с учётом предыдущих записей пакета. Состояние не меняется.
   */
  buildBatch<F extends EntryFields>(
    items: readonly { fields: F; options?: BuildOptions }[],
  ): (F & Pick<LogEntry, BaseKey>)[];
  /** Вызывать после успешного `append`: `seq` берётся из хранилища, без пропусков. */
  commit(entry: Pick<LogEntry, 'seq' | 'at'>): void;
}

export const createJournalWriter = ({
  clock,
  ids,
  eventStore,
}: JournalWriterDeps): JournalWriter => {
  let ownPrevAt: EpochMs = 0;

  /** HLC-правило (engine-ts.md §5.1). */
  const computeAt = (
    requestedAt: EpochMs | undefined,
    prevAt: EpochMs,
  ): EpochMs => {
    const now = clock.now();
    const clamped = Math.min(requestedAt ?? now, now + FIVE_MIN_MS);
    return Math.max(clamped, eventStore.maxAt() + 1, prevAt);
  };

  // `seq` не кэшируется: после `checkRestore` (догон или форк `deviceId`)
  // хранилище знает верный `lastSeq`, а писатель — нет
  const buildAt = <F extends EntryFields>(
    fields: F,
    options: BuildOptions,
    seq: number,
    prevAt: EpochMs,
  ) => ({
    ...fields,
    id: options.id ?? ids.next(),
    deviceId: eventStore.deviceId,
    seq,
    at: computeAt(options.at, prevAt),
    recordedAt: clock.now(),
  });

  const build: JournalWriter['build'] = (fields, options = {}) =>
    buildAt(fields, options, eventStore.lastSeq() + 1, ownPrevAt);

  const buildBatch: JournalWriter['buildBatch'] = (items) => {
    let prevAt = ownPrevAt;
    const firstSeq = eventStore.lastSeq() + 1;
    return items.map(({ fields, options = {} }, index) => {
      const entry = buildAt(fields, options, firstSeq + index, prevAt);
      prevAt = entry.at;
      return entry;
    });
  };

  const commit: JournalWriter['commit'] = (entry) => {
    ownPrevAt = entry.at;
  };

  return { build, buildBatch, commit };
};
