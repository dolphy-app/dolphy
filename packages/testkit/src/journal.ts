import type {
  AttemptSource,
  EpochMs,
  Grade,
  UnitId,
} from '@spirula/engine-contract';
import type {
  AttemptEntry,
  LogEntry,
  ProgressResetEntry,
  UnitFlagEntry,
} from '@spirula/engine';
import { T0_MS } from './clock.ts';

export const DEFAULT_DEVICE_ID = 'device-a';
const STEP_MS = 1_000;

/** Служебные поля записи; без `seq`/`at` — первая запись устройства в `T0_MS`. */
export interface EntryBaseFields {
  id?: string;
  deviceId?: string;
  seq?: number;
  at?: EpochMs;
  recordedAt?: EpochMs;
}

const base = (fields: EntryBaseFields) => {
  const deviceId = fields.deviceId ?? DEFAULT_DEVICE_ID;
  const seq = fields.seq ?? 1;
  const at = fields.at ?? T0_MS;
  return {
    id: fields.id ?? `${deviceId}-${String(seq).padStart(6, '0')}`,
    deviceId,
    seq,
    at,
    recordedAt: fields.recordedAt ?? at,
  };
};

export interface AttemptFields extends EntryBaseFields {
  exerciseId: UnitId;
  grade?: Grade;
  source?: AttemptSource;
}

export const buildAttempt = (fields: AttemptFields): AttemptEntry => ({
  ...base(fields),
  kind: 'attempt',
  exerciseId: fields.exerciseId,
  grade: fields.grade ?? 3,
  source: fields.source ?? 'self',
});

export interface UnitFlagFields extends EntryBaseFields {
  unitId: UnitId;
  flag: UnitFlagEntry['flag'];
  op?: UnitFlagEntry['op'];
}

export const buildUnitFlag = (fields: UnitFlagFields): UnitFlagEntry => ({
  ...base(fields),
  kind: 'unit_flag',
  unitId: fields.unitId,
  flag: fields.flag,
  op: fields.op ?? 'set',
});

export interface ProgressResetFields extends EntryBaseFields {
  unitId: UnitId;
  libraryRevision?: string;
}

export const buildProgressReset = (
  fields: ProgressResetFields,
): ProgressResetEntry => ({
  ...base(fields),
  kind: 'progress_reset',
  unitId: fields.unitId,
  ...(fields.libraryRevision !== undefined && {
    libraryRevision: fields.libraryRevision,
  }),
});

export interface JournalBuilderOptions {
  deviceId?: string;
  /** Момент первой записи, мс. */
  startAt?: EpochMs;
  /** Шаг между записями, мс; `at` строго растёт. */
  stepMs?: number;
}

export interface JournalBuilder {
  readonly deviceId: string;
  attempt(
    exerciseId: UnitId,
    grade?: Grade,
    source?: AttemptSource,
  ): AttemptEntry;
  unitFlag(
    unitId: UnitId,
    flag: UnitFlagEntry['flag'],
    op?: UnitFlagEntry['op'],
  ): UnitFlagEntry;
  progressReset(unitId: UnitId, libraryRevision?: string): ProgressResetEntry;
  /** Пропускает время без записей. */
  wait(ms: number): void;
  /** Все выданные записи по порядку `seq`. */
  readonly entries: readonly LogEntry[];
}

/**
 * Писатель одного устройства: `seq` идёт с 1 без пропусков, `at` строго
 * возрастает, поэтому порядок `(at, deviceId, seq)` совпадает с порядком записи.
 */
export const createJournalBuilder = ({
  deviceId = DEFAULT_DEVICE_ID,
  startAt = T0_MS,
  stepMs = STEP_MS,
}: JournalBuilderOptions = {}): JournalBuilder => {
  const entries: LogEntry[] = [];
  let seq = 0;
  let nextAt = startAt;

  const stamp = () => {
    seq += 1;
    const at = nextAt;
    nextAt += stepMs;
    return { deviceId, seq, at };
  };
  const push = <T extends LogEntry>(entry: T): T => {
    entries.push(entry);
    return entry;
  };

  return {
    deviceId,
    attempt: (exerciseId, grade = 3, source = 'self') =>
      push(buildAttempt({ exerciseId, grade, source, ...stamp() })),
    unitFlag: (unitId, flag, op = 'set') =>
      push(buildUnitFlag({ unitId, flag, op, ...stamp() })),
    progressReset: (unitId, libraryRevision) =>
      push(
        buildProgressReset({
          unitId,
          ...stamp(),
          ...(libraryRevision !== undefined && { libraryRevision }),
        }),
      ),
    wait: (ms) => {
      nextAt += ms;
    },
    get entries() {
      return entries;
    },
  };
};
