import type {
  AttemptSource,
  EpochMs,
  Grade,
  UnitId,
} from '@spirula-app/engine-contract';

/** Журнал событий — единственный первичный факт (engine-ts.md §5.1). */
interface EntryBase {
  /** uuidv7; для попытки — `requestId`. */
  id: string;
  deviceId: string;
  /** По устройству, без пропусков. */
  seq: number;
  /** Время события по HLC-правилу, мс. */
  at: EpochMs;
  /** Wall-clock записи, мс; порядок не задаёт. */
  recordedAt: EpochMs;
}

export interface AttemptEntry extends EntryBase {
  kind: 'attempt';
  exerciseId: UnitId;
  grade: Grade;
  source: AttemptSource;
}

export interface UnitFlagEntry extends EntryBase {
  kind: 'unit_flag';
  unitId: UnitId;
  flag: 'blacklist' | 'review';
  op: 'set' | 'unset';
}

export interface ProgressResetEntry extends EntryBase {
  kind: 'progress_reset';
  /** Курс, урок или упражнение. */
  unitId: UnitId;
  /** `revision` артефакта на момент записи (хранится в `extra`). */
  libraryRevision?: string;
}

export type LogEntry = AttemptEntry | UnitFlagEntry | ProgressResetEntry;
