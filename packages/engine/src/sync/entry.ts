import { createHash } from 'node:crypto';
import type { LogEntry } from '../domain/journal.ts';

/** Записи с `at > recordedAt + 24 ч` уходят в карантин `clock-skew` (§5.1). */
export const CLOCK_SKEW_LIMIT_MS = 86_400_000;
/** Лимит записей за вызов `exportSince` и `import` (engine-ts-api.md §10). */
export const MAX_SYNC_BATCH = 5_000;

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const SOURCES: readonly unknown[] = [
  'self',
  'runner',
  'placement',
  'trane-import',
];
const GRADES: readonly unknown[] = [1, 2, 3, 4, 5];
const FLAGS: readonly unknown[] = ['blacklist', 'review'];
const OPS: readonly unknown[] = ['set', 'unset'];

type OrderKey = Pick<LogEntry, 'at' | 'deviceId' | 'seq'>;

/** Сравнение по кодовым единицам UTF-16: не зависит от локали. */
export const compareStrings = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/** Ключ порядка проекций `(at, deviceId, seq)` (§5.1). */
export const compareKeys = (a: OrderKey, b: OrderKey): number =>
  a.at - b.at || compareStrings(a.deviceId, b.deviceId) || a.seq - b.seq;

/** Полный порядок: при равных `(deviceId, seq)` (только в конфликте) — `id`. */
export const compareEntries = (a: LogEntry, b: LogEntry): number =>
  compareKeys(a, b) || compareStrings(a.id, b.id);

/** Канонический JSON: ключи по алфавиту, `undefined` пропускается. */
export const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canon(record[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
};

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export const entryHash = (entry: LogEntry): string => sha256Hex(canon(entry));

/**
 * Значение колонки `unit_id`: упражнение попытки, юнит флага или сброса,
 * `targetId` отмены (это не юнит: сиротами в `W_ORPHAN_EVENTS` не считается).
 */
export const unitOf = (entry: LogEntry): string => {
  switch (entry.kind) {
    case 'attempt':
      return entry.exerciseId;
    case 'retract':
      return entry.targetId;
    default:
      return entry.unitId;
  }
};

/** Причина `clock-skew` не зависит от часов получателя, если `nowMs` не задан. */
export const isClockSkewed = (entry: LogEntry, nowMs?: number): boolean => {
  if (entry.at > entry.recordedAt + CLOCK_SKEW_LIMIT_MS) return true;
  return nowMs !== undefined && entry.at > nowMs + CLOCK_SKEW_LIMIT_MS;
};

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export type ParsedEntry =
  { ok: true; entry: LogEntry } | { ok: false; reason: string };

const fail = (reason: string): ParsedEntry => ({ ok: false, reason });

/**
 * Проверка схемы записи, пришедшей извне (сегмент, `import`). Возвращает
 * нормализованную запись: только известные поля, поэтому оба адаптера хранилища
 * видят одно и то же содержимое (и один `canon`).
 */
export const parseEntry = (input: unknown): ParsedEntry => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('not an object');
  }
  const raw = input as Record<string, unknown>;
  const { id, deviceId, seq, at, recordedAt } = raw;
  if (!isText(id)) return fail('bad id');
  if (!isText(deviceId) || !DEVICE_ID_PATTERN.test(deviceId)) {
    return fail('bad deviceId');
  }
  if (!isInt(seq) || seq < 1) return fail('bad seq');
  if (!isInt(at) || !isInt(recordedAt)) return fail('bad at/recordedAt');
  const base = { id, deviceId, seq, at, recordedAt };
  switch (raw.kind) {
    case 'attempt': {
      const { exerciseId, grade, source } = raw;
      if (!isText(exerciseId)) return fail('bad exerciseId');
      if (!GRADES.includes(grade)) return fail('bad grade');
      if (!SOURCES.includes(source)) return fail('bad source');
      const entry = { ...base, kind: 'attempt', exerciseId, grade, source };
      return { ok: true, entry: entry as LogEntry };
    }
    case 'unit_flag': {
      const { unitId, flag, op } = raw;
      if (!isText(unitId)) return fail('bad unitId');
      if (!FLAGS.includes(flag)) return fail('bad flag');
      if (!OPS.includes(op)) return fail('bad op');
      const entry = { ...base, kind: 'unit_flag', unitId, flag, op };
      return { ok: true, entry: entry as LogEntry };
    }
    case 'progress_reset': {
      const { unitId, libraryRevision } = raw;
      if (!isText(unitId)) return fail('bad unitId');
      if (
        libraryRevision !== undefined &&
        typeof libraryRevision !== 'string'
      ) {
        return fail('bad libraryRevision');
      }
      const entry = { ...base, kind: 'progress_reset', unitId };
      if (libraryRevision === undefined) {
        return { ok: true, entry: entry as LogEntry };
      }
      return { ok: true, entry: { ...entry, libraryRevision } as LogEntry };
    }
    case 'retract': {
      const { targetId, op } = raw;
      if (!isText(targetId)) return fail('bad targetId');
      if (!OPS.includes(op)) return fail('bad op');
      const entry = { ...base, kind: 'retract', targetId, op };
      return { ok: true, entry: entry as LogEntry };
    }
    default:
      return fail('bad kind');
  }
};

/** Локальная запись (`append`): нарушение схемы — ошибка программиста. */
export const assertEntry = (entry: LogEntry): LogEntry => {
  const parsed = parseEntry(entry);
  if (!parsed.ok) {
    throw new TypeError(
      `invalid log entry ${String(entry.id)}: ${parsed.reason}`,
    );
  }
  return parsed.entry;
};
