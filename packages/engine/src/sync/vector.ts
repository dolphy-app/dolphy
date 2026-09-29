import type { MissingSeqs, StateVector } from '@lms/engine-contract';
import { compareStrings } from './entry.ts';

/** Не более стольких дыр на устройство попадает в `missing()`. */
export const MAX_MISSING_PER_DEVICE = 1_000;

export interface VectorTracker {
  /** Учитывает `seq` (повтор безвреден). */
  add(deviceId: string, seq: number): void;
  /** Длина непрерывного префикса `1..n`; 0 — нет `seq = 1`. */
  contiguous(deviceId: string): number;
  /** Наибольший увиденный `seq` (с дырами). */
  maxSeq(deviceId: string): number;
  /** Все устройства, чьи `seq` учтены, по возрастанию `deviceId`. */
  devices(): string[];
  /** `{deviceId: contiguous}` только для устройств с непустым префиксом. */
  vector(): StateVector;
  missing(): MissingSeqs;
}

/**
 * Вектор состояния = непрерывный префикс, а не `max(seq)`: при переставленных
 * файлах максимум пропускает дыры (`report-journal-sync.md` §2).
 */
export const createVectorTracker = (): VectorTracker => {
  const prefixes = new Map<string, number>();
  const above = new Map<string, Set<number>>();
  const maxima = new Map<string, number>();

  const add = (deviceId: string, seq: number) => {
    if (seq > (maxima.get(deviceId) ?? 0)) maxima.set(deviceId, seq);
    const prefix = prefixes.get(deviceId) ?? 0;
    if (seq <= prefix) return;
    let pending = above.get(deviceId);
    if (seq > prefix + 1) {
      if (!pending) {
        pending = new Set();
        above.set(deviceId, pending);
      }
      pending.add(seq);
      return;
    }
    let next = seq;
    while (pending?.delete(next + 1)) next++;
    prefixes.set(deviceId, next);
  };

  const contiguous = (deviceId: string) => prefixes.get(deviceId) ?? 0;

  const vector = (): StateVector => {
    const result: StateVector = {};
    const devices = [...prefixes.keys()].sort(compareStrings);
    for (const deviceId of devices) result[deviceId] = prefixes.get(deviceId)!;
    return result;
  };

  const missing = (): MissingSeqs => {
    const result: MissingSeqs = {};
    const devices = [...above.keys()].sort(compareStrings);
    for (const deviceId of devices) {
      const pending = above.get(deviceId)!;
      if (pending.size === 0) continue;
      const gaps: number[] = [];
      const top = maxima.get(deviceId)!;
      for (let seq = contiguous(deviceId) + 1; seq < top; seq++) {
        if (gaps.length === MAX_MISSING_PER_DEVICE) break;
        if (!pending.has(seq)) gaps.push(seq);
      }
      result[deviceId] = gaps;
    }
    return result;
  };

  return {
    add,
    contiguous,
    maxSeq: (deviceId) => maxima.get(deviceId) ?? 0,
    devices: () => [...maxima.keys()].sort(compareStrings),
    vector,
    missing,
  };
};

export interface DeviceSeqInfo {
  max: number;
  contiguous: number;
  missing: number[];
}

/** Покрытие `seq` по устройствам для набора записей (`seq` с 1, без дыр). */
export const seqInfo = (
  entries: Iterable<{ deviceId: string; seq: number }>,
): Map<string, DeviceSeqInfo> => {
  const seen = new Map<string, Set<number>>();
  for (const { deviceId, seq } of entries) {
    let seqs = seen.get(deviceId);
    if (!seqs) {
      seqs = new Set();
      seen.set(deviceId, seqs);
    }
    seqs.add(seq);
  }
  const info = new Map<string, DeviceSeqInfo>();
  for (const [deviceId, seqs] of seen) {
    let max = 0;
    for (const seq of seqs) if (seq > max) max = seq;
    let contiguous = 0;
    while (seqs.has(contiguous + 1)) contiguous++;
    const missing: number[] = [];
    for (let seq = contiguous + 1; seq < max; seq++) {
      if (!seqs.has(seq)) missing.push(seq);
    }
    info.set(deviceId, { max, contiguous, missing });
  }
  return info;
};
