import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EngineError } from '../app/errors.ts';
import type { EventStore } from '../ports/index.ts';
import { DEVICE_ID_PATTERN, compareStrings } from '../sync/entry.ts';
import type { Replica } from '../sync/replica.ts';
import {
  HEAD_FILE,
  SEGMENT_PATTERN,
  decodeSegment,
  encodeSegment,
  parseHead,
  segmentDigest,
} from '../sync/segment.ts';
import type { Head, SegmentInfo, SegmentResult } from '../sync/segment.ts';
import { syncDirectory, writeFileDurable } from './durable-write.ts';

export interface FolderSyncOptions {
  /** Общая папка сегментов (папка файлового синхронизатора или Git). */
  dir: string;
  store: EventStore;
  replica: Replica;
  /** Размер сегмента при публикации; по умолчанию 10 000 (§6a.6). */
  entriesPerSegment?: number;
  /** `fsync` каталога после `rename`; по умолчанию включён. */
  dirFsync?: boolean;
}

export interface PublishReport {
  segments: number;
  entries: number;
  bytes: number;
}

export interface FolderImportReport {
  inserted: number;
  duplicates: number;
  /** Записи в отвергнутых сегментах и новые записи, скрытые конфликтом. */
  rejected: number;
  /** Сегменты, объявленные в `head`, но не применённые (повтор в следующем раунде). */
  pending: number;
  headErrors: string[];
  corruptSegments: string[];
  pendingSegments: string[];
  /** Применённые сегменты `device/name`. */
  applied: string[];
  /** Конфликты, созданные или пополненные импортом. */
  conflictIds: string[];
  needsRebuild: boolean;
}

export interface FolderRoundReport extends FolderImportReport {
  published: { segments: number; entries: number };
}

export interface RestoreReport {
  action: 'none' | 'catch-up' | 'fork';
  localMax: number;
  folderMax: number;
  peerSeenMax: number;
  newDeviceId?: string;
}

export interface CompactReport {
  before: number;
  after: number;
  headBytes: number;
}

export interface FolderSync {
  readonly dir: string;
  /** Публикует свой хвост новыми сегментами и атомарно заменяет `head.json`. */
  export(): Promise<PublishReport>;
  /** Применяет сегменты других устройств (своё — при `includeOwn`). */
  import(options?: { includeOwn?: boolean }): Promise<FolderImportReport>;
  /** Один раунд: `export`, затем `import`. */
  sync(): Promise<FolderRoundReport>;
  /** Переписывает свои сегменты крупнее; старые файлы удаляются последними. */
  compact(entriesPerSegment: number): Promise<CompactReport>;
  /** Восстановление из бэкапа: догнать свой хвост или форкнуть `deviceId`. */
  checkRestore(): Promise<RestoreReport>;
}

const DEFAULT_ENTRIES_PER_SEGMENT = 10_000;
const FORK_SUFFIX = /^(.*)-(\d{1,3})$/;

const clash = (details: Record<string, unknown>) =>
  new EngineError('SYNC_DEVICE_ID_CLASH', { details });

const emptyReport = (): FolderImportReport => ({
  inserted: 0,
  duplicates: 0,
  rejected: 0,
  pending: 0,
  headErrors: [],
  corruptSegments: [],
  pendingSegments: [],
  applied: [],
  conflictIds: [],
  needsRebuild: false,
});

const registryKey = (
  deviceId: string,
  { name, sha256 }: { name: string; sha256: string },
) => `${deviceId}/${name}#${sha256}`;

export const createFolderSync = ({
  dir,
  store,
  replica,
  entriesPerSegment = DEFAULT_ENTRIES_PER_SEGMENT,
  dirFsync = true,
}: FolderSyncOptions): FolderSync => {
  /** Сегменты с верным sha256, но порченым содержимым: не перечитываются. */
  const bad = new Set<string>();

  const ownDir = () => join(dir, store.deviceId);

  const readHeadText = (device: string) =>
    readFile(join(dir, device, HEAD_FILE), 'utf8').catch(() => null);

  const readHead = async (device: string): Promise<Head | string> => {
    const text = await readHeadText(device);
    if (text === null) return 'no head';
    const parsed = parseHead(text, device);
    return parsed.ok ? parsed.head : parsed.reason;
  };

  const deviceDirs = async (): Promise<string[]> => {
    let names: string[];
    try {
      const found = await readdir(dir, { withFileTypes: true });
      names = found
        .filter((item) => item.isDirectory())
        .map((item) => item.name);
    } catch {
      return [];
    }
    return names
      .filter((name) => DEVICE_ID_PATTERN.test(name))
      .sort(compareStrings);
  };

  const ownRun = async (fromSeq: number) => {
    const found = await store.readDevice(store.deviceId, fromSeq);
    let expected = fromSeq;
    let length = 0;
    for (const entry of found) {
      if (entry.seq !== expected) break;
      expected++;
      length++;
    }
    return found.slice(0, length);
  };

  /**
   * Head для нашего `deviceId` обязан описывать НАШИ записи: последний
   * объявленный сегмент пересчитывается из журнала и сверяется по sha256.
   * Иначе (клон `deviceId`, бэкап без `checkRestore`) молча опубликовать
   * ничего нельзя: `head.maxSeq` скрыл бы новые записи.
   */
  const assertHeadIsOurs = async (head: Head) => {
    const last = head.segments[head.segments.length - 1];
    if (!last) return;
    const mine = await store.readDevice(
      store.deviceId,
      last.firstSeq,
      last.lastSeq,
    );
    if (mine.length === 0 && store.maxSeq(store.deviceId) === 0) return;
    const isSame =
      mine.length === last.count && segmentDigest(mine) === last.sha256;
    if (!isSame) {
      throw clash({
        deviceId: store.deviceId,
        segment: last.name,
        localEntries: mine.length,
      });
    }
  };

  /** Сегменты уже на диске; каталог сбрасывается до того, как head их объявит. */
  const writeHead = async (head: Head, previous: string | null) => {
    const text = JSON.stringify(head);
    if (text !== previous) {
      if (dirFsync) await syncDirectory(ownDir());
      await writeFileDurable(join(ownDir(), HEAD_FILE), text, { dirFsync });
    }
    return Buffer.byteLength(text);
  };

  const exportOwn = async (): Promise<PublishReport> => {
    await mkdir(ownDir(), { recursive: true });
    const previous = await readHeadText(store.deviceId);
    const parsed =
      previous === null ? null : parseHead(previous, store.deviceId);
    const head: Head = parsed?.ok
      ? parsed.head
      : { deviceId: store.deviceId, maxSeq: 0, segments: [] };
    await assertHeadIsOurs(head);
    const pending = await ownRun(head.maxSeq + 1);
    const report: PublishReport = { segments: 0, entries: 0, bytes: 0 };
    for (let start = 0; start < pending.length; start += entriesPerSegment) {
      const chunk = pending.slice(start, start + entriesPerSegment);
      const { info, bytes } = encodeSegment(chunk);
      await writeFileDurable(join(ownDir(), info.name), bytes, {
        dirFsync: false,
      });
      head.segments.push(info);
      head.maxSeq = info.lastSeq;
      report.segments++;
      report.entries += chunk.length;
      report.bytes += bytes.length;
    }
    head.seen = store.vector();
    await writeHead(head, previous);
    return report;
  };

  const loadSegment = async (
    device: string,
    info: SegmentInfo,
  ): Promise<SegmentResult> => {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(dir, device, info.name));
    } catch {
      return { kind: 'pending', why: 'file not present' };
    }
    return decodeSegment(bytes, info, device);
  };

  const importDevice = async (
    device: string,
    head: Head,
    registry: Set<string>,
    report: FolderImportReport,
  ) => {
    const conflicts = new Set(report.conflictIds);
    const contiguous = () => store.vector()[device] ?? 0;
    const segments = head.segments.filter(
      (info) => !bad.has(registryKey(device, info)),
    );

    const apply = async (info: SegmentInfo, result: SegmentResult) => {
      if (result.kind !== 'ok') return false;
      const outcome = await replica.ingest(result.entries, {
        segment: {
          deviceId: device,
          name: info.name,
          sha256: info.sha256,
          firstSeq: info.firstSeq,
          lastSeq: info.lastSeq,
        },
      });
      report.inserted += outcome.inserted;
      report.duplicates += outcome.duplicates;
      report.rejected += outcome.quarantined;
      report.needsRebuild ||= outcome.needsRebuild;
      for (const id of outcome.conflictIds) conflicts.add(id);
      registry.add(registryKey(device, info));
      return true;
    };

    const note = (info: SegmentInfo, result: SegmentResult) => {
      if (result.kind === 'ok') return;
      const line = `${device}/${info.name}: ${result.why}`;
      if (result.kind === 'pending') {
        if (!report.pendingSegments.includes(line)) {
          report.pendingSegments.push(line);
        }
        return;
      }
      report.corruptSegments.push(line);
      report.rejected += info.count;
      bad.add(registryKey(device, info));
    };

    // Сегмент внутри покрытого префикса, ни разу не применённый под этим
    // (name, sha256): повторное использование seq, векторное сравнение его пропустило бы.
    for (const info of segments) {
      const isCovered = info.lastSeq <= contiguous();
      if (!isCovered || registry.has(registryKey(device, info))) continue;
      const result = await loadSegment(device, info);
      if (await apply(info, result)) continue;
      note(info, result);
    }

    for (;;) {
      const prefix = contiguous();
      const candidates = segments
        .filter((info) => info.lastSeq > prefix && info.firstSeq <= prefix + 1)
        .sort(
          (a, b) => b.lastSeq - a.lastSeq || compareStrings(a.name, b.name),
        );
      let isApplied = false;
      for (const info of candidates) {
        const result = await loadSegment(device, info);
        if (await apply(info, result)) {
          report.applied.push(`${device}/${info.name}`);
          isApplied = true;
          break;
        }
        note(info, result);
      }
      if (!isApplied) break;
    }

    const prefix = contiguous();
    const beyond = segments.filter((info) => info.lastSeq > prefix);
    for (const info of beyond) {
      const prefixLine = `${device}/${info.name}:`;
      const isNoted = report.pendingSegments.some((line) =>
        line.startsWith(prefixLine),
      );
      if (isNoted || bad.has(registryKey(device, info))) continue;
      report.pendingSegments.push(
        `${prefixLine} gap before firstSeq=${info.firstSeq} (have ${prefix})`,
      );
    }
    report.pending += beyond.length;
    report.conflictIds = [...conflicts].sort();
  };

  const importAll = async ({
    includeOwn = false,
  }: { includeOwn?: boolean } = {}): Promise<FolderImportReport> => {
    const report = emptyReport();
    const registry = new Set(
      (await store.segments()).map((segment) =>
        registryKey(segment.deviceId, segment),
      ),
    );
    for (const device of await deviceDirs()) {
      if (device === store.deviceId && !includeOwn) continue;
      const head = await readHead(device);
      if (typeof head === 'string') {
        if (head !== 'no head') report.headErrors.push(`${device}: ${head}`);
        continue;
      }
      await importDevice(device, head, registry, report);
    }
    return report;
  };

  const sync = async (): Promise<FolderRoundReport> => {
    const published = await exportOwn();
    const report = await importAll();
    return {
      ...report,
      published: { segments: published.segments, entries: published.entries },
    };
  };

  const compact = async (perSegment: number): Promise<CompactReport> => {
    const current = await readHead(store.deviceId);
    if (typeof current === 'string')
      return { before: 0, after: 0, headBytes: 0 };
    const all = await ownRun(1);
    const last = all[all.length - 1];
    if (!last || last.seq < current.maxSeq) {
      throw clash({ deviceId: store.deviceId, reason: 'local run is shorter' });
    }
    await assertHeadIsOurs(current);
    const segments: SegmentInfo[] = [];
    for (let start = 0; start < all.length; start += perSegment) {
      const chunk = all.slice(start, start + perSegment);
      const { info, bytes } = encodeSegment(chunk);
      const path = join(ownDir(), info.name);
      const existing = await readFile(path).catch(() => null);
      const isSame = existing !== null && existing.equals(bytes);
      if (!isSame) await writeFileDurable(path, bytes, { dirFsync: false });
      segments.push(info);
    }
    const head: Head = {
      deviceId: store.deviceId,
      maxSeq: last.seq,
      segments,
      seen: store.vector(),
    };
    const headBytes = await writeHead(head, null);
    const keep = new Set(segments.map((info) => info.name));
    for (const name of await readdir(ownDir())) {
      if (SEGMENT_PATTERN.test(name) && !keep.has(name)) {
        await rm(join(ownDir(), name));
      }
    }
    return {
      before: current.segments.length,
      after: segments.length,
      headBytes,
    };
  };

  const forkId = async (): Promise<string> => {
    const taken = new Set([
      ...(await deviceDirs()),
      ...Object.keys(store.vector()),
    ]);
    const match = FORK_SUFFIX.exec(store.deviceId);
    const base = match ? match[1]! : store.deviceId;
    for (let n = match ? Number(match[2]) + 1 : 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate) && DEVICE_ID_PATTERN.test(candidate)) {
        return candidate;
      }
    }
  };

  const checkRestore = async (): Promise<RestoreReport> => {
    const self = store.deviceId;
    const localMax = store.maxSeq(self);
    const own = await readHead(self);
    const folderMax = typeof own === 'string' ? 0 : own.maxSeq;
    let peerSeenMax = 0;
    for (const device of await deviceDirs()) {
      if (device === self) continue;
      const head = await readHead(device);
      if (typeof head !== 'string') {
        peerSeenMax = Math.max(peerSeenMax, head.seen?.[self] ?? 0);
      }
    }
    const report = { localMax, folderMax, peerSeenMax };
    if (Math.max(folderMax, peerSeenMax) <= localMax) {
      return { action: 'none', ...report };
    }
    await importAll({ includeOwn: true });
    const caughtUp = store.vector()[self] ?? 0;
    if (caughtUp >= peerSeenMax && caughtUp >= folderMax) {
      return { action: 'catch-up', ...report };
    }
    const newDeviceId = await forkId();
    await store.rotateDeviceId(newDeviceId);
    return { action: 'fork', ...report, newDeviceId };
  };

  return {
    dir,
    export: exportOwn,
    import: importAll,
    sync,
    compact,
    checkRestore,
  };
};
