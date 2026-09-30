import type { StateVector } from '@spirula-app/engine-contract';
import type { LogEntry } from '../domain/journal.ts';
import { DEVICE_ID_PATTERN, canon, parseEntry, sha256Hex } from './entry.ts';

/** Формат общей папки (engine-ts.md §6a.6): `<dir>/<deviceId>/seg-<first>-<last>.jsonl` + `head.json`. */
export interface SegmentInfo {
  name: string;
  firstSeq: number;
  lastSeq: number;
  count: number;
  sha256: string;
}

export interface Head {
  deviceId: string;
  maxSeq: number;
  segments: SegmentInfo[];
  /** Непрерывный префикс, который автор head видел у каждого устройства. */
  seen?: StateVector;
}

export const SEGMENT_PATTERN = /^seg-(\d+)-(\d+)\.jsonl$/;
export const HEAD_FILE = 'head.json';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const segmentName = (firstSeq: number, lastSeq: number) =>
  `seg-${firstSeq}-${lastSeq}.jsonl`;

export interface EncodedSegment {
  info: SegmentInfo;
  bytes: Uint8Array;
}

const render = (entries: readonly LogEntry[]): Uint8Array => {
  if (entries.length === 0) return new Uint8Array(0);
  return encoder.encode(`${entries.map((entry) => canon(entry)).join('\n')}\n`);
};

/** Строки — канонический JSON, поэтому sha256 воспроизводится на любом устройстве. */
export const encodeSegment = (entries: readonly LogEntry[]): EncodedSegment => {
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const bytes = render(entries);
  const info = {
    name: segmentName(first.seq, last.seq),
    firstSeq: first.seq,
    lastSeq: last.seq,
    count: entries.length,
    sha256: sha256Hex(bytes),
  };
  return { info, bytes };
};

/** sha256 сегмента, каким он должен получиться из записей (проверка клона). */
export const segmentDigest = (entries: readonly LogEntry[]): string =>
  sha256Hex(render(entries));

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export type HeadResult =
  { ok: true; head: Head } | { ok: false; reason: string };

const isSegmentInfo = (value: unknown): value is SegmentInfo => {
  if (value === null || typeof value !== 'object') return false;
  const info = value as Record<string, unknown>;
  return (
    typeof info.name === 'string' &&
    SEGMENT_PATTERN.test(info.name) &&
    isInt(info.firstSeq) &&
    isInt(info.lastSeq) &&
    isInt(info.count) &&
    typeof info.sha256 === 'string'
  );
};

/** `dir` — имя каталога устройства; `deviceId` в head обязан совпасть с ним. */
export const parseHead = (text: string, dir: string): HeadResult => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'head not valid JSON' };
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, reason: 'bad head shape' };
  }
  const head = raw as Record<string, unknown>;
  const { deviceId, maxSeq, segments, seen } = head;
  if (deviceId !== dir || !DEVICE_ID_PATTERN.test(dir)) {
    return { ok: false, reason: 'bad head shape' };
  }
  if (!isInt(maxSeq) || !Array.isArray(segments)) {
    return { ok: false, reason: 'bad head shape' };
  }
  if (!segments.every(isSegmentInfo)) {
    return { ok: false, reason: 'bad segment record' };
  }
  const result: Head = { deviceId: dir, maxSeq, segments };
  if (seen !== null && typeof seen === 'object' && !Array.isArray(seen)) {
    const vector: StateVector = {};
    for (const [key, value] of Object.entries(seen)) {
      if (isInt(value)) vector[key] = value;
    }
    result.seen = vector;
  }
  return { ok: true, head: result };
};

export type SegmentResult =
  | { kind: 'ok'; entries: LogEntry[] }
  | { kind: 'pending' | 'corrupt'; why: string };

/**
 * Сегмент применяется целиком или не применяется: sha256 не совпал — ждём
 * (файл ещё копируется или обрезан), а число строк, схема, `deviceId` и
 * непрерывность `seq` при верном sha256 — порча навсегда.
 */
export const decodeSegment = (
  bytes: Uint8Array,
  info: SegmentInfo,
  deviceId: string,
): SegmentResult => {
  if (sha256Hex(bytes) !== info.sha256) {
    return {
      kind: 'pending',
      why: `sha256 mismatch (size ${bytes.length}, incomplete or in flight)`,
    };
  }
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { kind: 'corrupt', why: 'not UTF-8' };
  }
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length !== info.count) {
    return {
      kind: 'corrupt',
      why: `count ${lines.length} != head ${info.count}`,
    };
  }
  const entries: LogEntry[] = [];
  let expected = info.firstSeq;
  for (const line of lines) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return { kind: 'corrupt', why: 'line is not JSON' };
    }
    const parsed = parseEntry(json);
    if (!parsed.ok) return { kind: 'corrupt', why: `schema: ${parsed.reason}` };
    const { entry } = parsed;
    if (entry.deviceId !== deviceId) {
      return { kind: 'corrupt', why: `foreign deviceId ${entry.deviceId}` };
    }
    if (entry.seq !== expected++) {
      return { kind: 'corrupt', why: `seq ${entry.seq} not contiguous` };
    }
    entries.push(entry);
  }
  if (expected - 1 !== info.lastSeq) {
    return { kind: 'corrupt', why: 'lastSeq mismatch' };
  }
  return { kind: 'ok', entries };
};
