export { diag, sortDiagnostics, summarize } from './diagnostics.ts';
export type { DiagnosticLocation } from './diagnostics.ts';
export type {
  CourseUnit,
  ExerciseUnit,
  FieldSrc,
  LessonUnit,
  Model,
  Src,
  UnitMeta,
} from './model.ts';
export { splitFrontmatter, stripFrontmatter } from './frontmatter.ts';
export type { FrontmatterSplit } from './frontmatter.ts';
export {
  COURSE_MANIFEST,
  EXERCISE_MANIFEST,
  LESSON_MANIFEST,
  scan,
} from './scan.ts';
export type { ScanOptions, ScanResult, ScanStats } from './scan.ts';
export { MAX_MANIFEST_BYTES, MAX_TEXT_BYTES } from './file-reader.ts';
export { DEFAULT_CHECK_OPTIONS, DEFAULT_GRANULARITY } from './checks.ts';
export type { CheckOptions } from './checks.ts';
export { compile } from './compile.ts';
export type {
  CompileOptions,
  CompileResult,
  CompileTimings,
} from './compile.ts';
export {
  ArtifactFormatError,
  FORMAT_VERSION,
  decodeArtifact,
  encodeArtifact,
  loadCompiled,
  redundantEdgesOf,
} from './artifact.ts';
export type { Artifact, ArtifactGraph, ArtifactUnit } from './artifact.ts';
export { loadDirectory } from './load-directory.ts';
export type {
  LoadDirectoryOptions,
  LoadDirectoryResult,
} from './load-directory.ts';
export { checkFreshness, probeArtifact } from './freshness.ts';
export type {
  ArtifactProbe,
  FreshnessOptions,
  FreshnessResult,
} from './freshness.ts';
export { contentRevision, listInputs, statFingerprint } from './revision.ts';
export {
  createLibraryHolder,
  openLibrary,
  reloadLibrary,
} from './library-holder.ts';
export type {
  LibraryHolder,
  LibraryStatus,
  OpenLibraryDeps,
  OpenLibraryOptions,
  ReloadResult,
} from './library-holder.ts';
export { MAX_ASSET_BYTES, readAsset } from './read-asset.ts';
export {
  DEFAULT_REFERENCE_CONCURRENCY,
  DEFAULT_REFERENCE_TIMEOUT_MS,
  checkReferences,
} from './reference-check.ts';
export type {
  ReferenceCheckOptions,
  ReferenceCheckResult,
  ReferenceCheckStats,
} from './reference-check.ts';
