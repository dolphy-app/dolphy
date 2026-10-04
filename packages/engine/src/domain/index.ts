export { createUnitGraph, UnitGraphError } from './graph.ts';
export type {
  UnitGraph,
  UnitGraphBuilder,
  UnitGraphErrorKind,
  UnitType,
  WeightedUnit,
} from './graph.ts';
export {
  buildIndexedGraph,
  findCycle,
  topoOrder,
  transitiveReduction,
} from './graph-algorithms.ts';
export type { IndexedGraph, Reduction } from './graph-algorithms.ts';
export { assembleLibrary } from './library.ts';
export type { AssembleOptions, Library } from './library.ts';
export {
  assetPathsOf,
  InvalidAssetPathError,
  normalizeCourseManifest,
  normalizeExerciseManifest,
  normalizeLessonManifest,
  normalizePath,
  resolveAssetPath,
} from './asset-path.ts';
export {
  encodeCourseManifest,
  encodeExerciseManifest,
  encodeLessonManifest,
  encodeUserPreferences,
  findUnknownKeys,
  MANIFEST_KEYS,
  parseCourseManifest,
  parseEncompassedList,
  parseExerciseManifest,
  parseExerciseType,
  parseKbString,
  parseLessonManifest,
  parseMetadata,
  parseStringList,
  parseUserPreferences,
  stringifyManifest,
} from './manifest-schema.ts';
export type { ParseResult, SchemaIssue } from './manifest-schema.ts';
export {
  DEFAULT_EXTENSION_SETTINGS,
  decodeExtensionSettings,
  decodeUpdateCheckedAt,
  isExtensionId,
  normalizeExtensionSettings,
} from './extension-settings.ts';
export {
  DEFAULT_LEARNING_SETTINGS,
  decodeLearningSettings,
  isGradePolicyId,
} from './learning-settings.ts';
export {
  COMMAND_KEY_PATTERN,
  DEFAULT_KEYBINDINGS_SETTINGS,
  KEYBINDING_LIMITS,
  KEY_MAX_LENGTH,
  WHEN_MAX_LENGTH,
  decodeKeybindingsSettings,
} from './keybindings-settings.ts';
export {
  DEFAULT_UI_SETTINGS,
  LOCALE_MODES,
  decodeUiSettings,
  isLocaleMode,
  isThemeId,
} from './ui-settings.ts';
export {
  EXTENSION_SECRET_LIMITS,
  EXTENSION_STORAGE_LIMITS,
  SECRET_STORE_LIMITS,
  compareKeys,
  encodeJson,
  findStorageViolation,
  utf8Length,
} from './extension-data.ts';
export type {
  StorageLimits,
  StorageQuotaKind,
  StorageSnapshot,
  StorageViolation,
} from './extension-data.ts';
export {
  effectiveSettingValues,
  findSettingValueProblem,
  normalizeSettingValue,
} from './extension-setting-values.ts';
export type { SettingValueProblem } from './extension-setting-values.ts';
export {
  STATS_DAILY_MAX_DAYS,
  dailyOf,
  formatStatsDate,
  localDayOf,
  parseStatsDate,
  streakOf,
} from './learning-stats.ts';
export type { DailyResult, DayCounts, StreakResult } from './learning-stats.ts';
