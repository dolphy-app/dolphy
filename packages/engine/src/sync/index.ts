export {
  CLOCK_SKEW_LIMIT_MS,
  DEVICE_ID_PATTERN,
  MAX_SYNC_BATCH,
  assertEntry,
  canon,
  compareEntries,
  compareKeys,
  compareStrings,
  entryHash,
  isClockSkewed,
  parseEntry,
  sha256Hex,
  unitOf,
} from './entry.ts';
export type { ParsedEntry } from './entry.ts';
export {
  applyIncoming,
  appendInTx,
  groupConflicts,
  resolveConflictGroup,
} from './merge.ts';
export type {
  ConflictGroup,
  MergeOptions,
  MergeOutcome,
  ResolveOutcome,
} from './merge.ts';
export { createReplica } from './replica.ts';
export type {
  ExportBatch,
  ExportRequest,
  ImportOutcome,
  IngestOptions,
  RejectedEntry,
  Replica,
  ReplicaDeps,
  ResolveResult,
  SyncState,
} from './replica.ts';
export {
  HEAD_FILE,
  SEGMENT_PATTERN,
  decodeSegment,
  encodeSegment,
  parseHead,
  segmentDigest,
  segmentName,
} from './segment.ts';
export type {
  EncodedSegment,
  Head,
  HeadResult,
  SegmentInfo,
  SegmentResult,
} from './segment.ts';
export { importFromTrane } from './trane-import.ts';
export type {
  TraneImportDeps,
  TraneImportResult,
  TraneSource,
  TraneTrial,
} from './trane-import.ts';
export {
  MAX_MISSING_PER_DEVICE,
  createVectorTracker,
  seqInfo,
} from './vector.ts';
export type { DeviceSeqInfo, VectorTracker } from './vector.ts';
