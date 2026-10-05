import {
  BUILTIN_GRADE_POLICY,
  EXTENSION_ID_PATTERN,
  GRADE_POLICY_ID_PATTERN,
  LOG_LEVELS,
  MATERIAL_WIDTH_RANGE,
  MAX_LOG_ENTRIES,
  THEME_ID_PATTERN,
} from '@dolphy-app/engine-contract';
import {
  KEYBINDING_LIMITS,
  KEY_MAX_LENGTH,
  WHEN_MAX_LENGTH,
} from '@dolphy-app/engine';
import * as z from 'zod';
import type {
  AttemptEntryDto,
  DeepPartial,
  ExerciseFilterDto,
  JsonValue,
  KeyValueFilterWire,
  LearningEngine,
  LogEntryDto,
  RpcMethodName,
  SavedFilterDto,
  SchedulerOptionsDto,
  SessionPartWire,
  StudySessionWire,
  UnitFilterWire,
} from '@dolphy-app/engine-contract';

type Path<T, K extends string> = K extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? Path<T[Head], Tail>
    : never
  : K extends keyof T
    ? T[K]
    : never;

/** Позиционные аргументы метода `LearningEngine` по RPC-имени. */
export type ArgsOf<K extends RpcMethodName> =
  Path<LearningEngine, K> extends (...args: infer A) => unknown ? A : never;

const optional = <T extends z.core.SomeType>(schema: T) =>
  z.exactOptional(schema);

const unitId = z.string().min(1);
const str = z.string();
const extensionId = z.string().min(1).max(64).regex(EXTENSION_ID_PATTERN);
const extensionVersion = z
  .string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
const num = z.number();
const int = z.int();
const bool = z.boolean();
const epochMs = z.number().int().nonnegative();
const requestId = z.string().min(1);
const repositoryId = z.string().min(1).max(200);
const grade = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const unitKind = z.enum(['course', 'lesson', 'exercise']);
const severity = z.enum(['error', 'warning', 'info']);
const attemptSource = z.enum(['self', 'runner', 'placement', 'trane-import']);

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

const pageRequest = z.strictObject({
  limit: optional(z.int().min(1).max(500)),
  cursor: optional(str),
});
const frontierRequest = z.strictObject({
  ...pageRequest.shape,
  courseId: optional(unitId),
});
const dueRequest = z.strictObject({
  ...pageRequest.shape,
  minNeed: optional(num),
  courseIds: optional(z.array(unitId)),
});
const diagnosticsPageRequest = z.strictObject({
  ...pageRequest.shape,
  minSeverity: optional(severity),
});
const validateRequest = z.strictObject({
  ...diagnosticsPageRequest.shape,
  runChecks: optional(bool),
});

const assetRef = z.strictObject({ unitId, path: str.min(1) });
const graphQuery = z.strictObject({
  rootIds: optional(z.array(unitId)),
  depth: optional(z.int().min(0)),
  kinds: optional(z.array(unitKind)),
  limit: optional(z.int().min(1).max(2000)),
});

const filterType = z.enum(['Include', 'Exclude']);
const filterOp = z.enum(['All', 'Any']);
const keyValueFilter: z.ZodType<KeyValueFilterWire> = z.lazy(() =>
  z.union([
    z.strictObject({
      CourseFilter: z.strictObject({
        key: str,
        value: str,
        filter_type: filterType,
      }),
    }),
    z.strictObject({
      LessonFilter: z.strictObject({
        key: str,
        value: str,
        filter_type: filterType,
      }),
    }),
    z.strictObject({
      CombinedFilter: z.strictObject({
        op: filterOp,
        filters: z.array(keyValueFilter),
      }),
    }),
  ]),
);
const unitFilter: z.ZodType<UnitFilterWire> = z.union([
  z.strictObject({
    CourseFilter: z.strictObject({ course_ids: z.array(unitId) }),
  }),
  z.strictObject({
    LessonFilter: z.strictObject({ lesson_ids: z.array(unitId) }),
  }),
  z.strictObject({
    MetadataFilter: z.strictObject({ filter: keyValueFilter }),
  }),
  z.literal('ReviewListFilter'),
  z.strictObject({ Dependents: z.strictObject({ unit_ids: z.array(unitId) }) }),
  z.strictObject({
    Dependencies: z.strictObject({
      unit_ids: z.array(unitId),
      depth: z.int().min(0),
    }),
  }),
]);
const sessionPart: z.ZodType<SessionPartWire> = z.union([
  z.strictObject({
    UnitFilter: z.strictObject({ filter: unitFilter, duration: num }),
  }),
  z.strictObject({
    SavedFilter: z.strictObject({ filter_id: str, duration: num }),
  }),
  z.strictObject({ NoFilter: z.strictObject({ duration: num }) }),
]);
const studySession: z.ZodType<StudySessionWire> = z.strictObject({
  id: str,
  description: optional(str),
  parts: optional(z.array(sessionPart)),
});
const savedFilter: z.ZodType<SavedFilterDto> = z.strictObject({
  id: str,
  description: str,
  filter: unitFilter,
});
const exerciseFilter: z.ZodType<ExerciseFilterDto> = z.union([
  z.strictObject({ UnitFilter: unitFilter }),
  z.strictObject({
    StudySession: z.strictObject({
      startTimeMs: epochMs,
      definition: studySession,
    }),
  }),
]);

const progressQuery = z.strictObject({
  scope: optional(
    z.union([
      z.strictObject({ courseId: unitId }),
      z.strictObject({ lessonId: unitId }),
      z.strictObject({ unitIds: z.array(unitId) }),
    ]),
  ),
  includeExercises: optional(bool),
});

const placementResult = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('grade'), grade }),
  z.strictObject({ kind: z.literal('attempt'), attemptId: str.min(1) }),
]);

const masteryWindow = z.strictObject({
  percentage: optional(num),
  range: optional(z.tuple([optional(num), optional(num)])),
});
const schedulerPatch: z.ZodType<DeepPartial<SchedulerOptionsDto>> =
  z.strictObject({
    batchSize: optional(int),
    relearnFraction: optional(num),
    masteryWindows: optional(
      z.strictObject({
        new: optional(masteryWindow),
        target: optional(masteryWindow),
        current: optional(masteryWindow),
        easy: optional(masteryWindow),
        mastered: optional(masteryWindow),
      }),
    ),
    passingScore: optional(
      z.strictObject({
        minScore: optional(num),
        minFraction: optional(num),
        minAvgTrials: optional(num),
      }),
    ),
    supersedingScore: optional(num),
    numTrials: optional(int),
    numRewards: optional(int),
    maxLessonsInProgress: optional(int),
    implicitCredit: optional(
      z.strictObject({
        enabled: optional(bool),
        lambda: optional(num),
        minCredit: optional(num),
        kappa: optional(num),
      }),
    ),
    remediation: optional(
      z.strictObject({
        failThreshold: optional(num),
        maxItems: optional(int),
      }),
    ),
    plan: optional(
      z.strictObject({
        targetRetention: optional(num),
        minNewFraction: optional(num),
        maxSameCourseRun: optional(int),
        minTagDistance: optional(int),
      }),
    ),
  });

/** Размеры строк — как в движке; число записей сверх лимита доходит до сервиса, чтобы тот ответил `reason: 'limit'`. */
const keybindingEntry = z.strictObject({
  key: z.string().max(KEY_MAX_LENGTH),
  when: z.string().max(WHEN_MAX_LENGTH).nullable(),
});
const keybindingsPatch = z
  .record(
    z.string().max(KEYBINDING_LIMITS.commandLength),
    z
      .array(keybindingEntry)
      .max(KEYBINDING_LIMITS.entriesPerCommand * 8)
      .nullable(),
  )
  .refine((patch) => Object.keys(patch).length <= KEYBINDING_LIMITS.commands, {
    message: `at most ${KEYBINDING_LIMITS.commands} commands in one patch`,
  });

const stateVector = z.record(str, z.int().nonnegative());
const logEntryBase = {
  id: str.min(1),
  deviceId: str.min(1),
  seq: z.int().min(1),
  at: epochMs,
  recordedAt: epochMs,
};
const logEntry: z.ZodType<LogEntryDto> = z.discriminatedUnion('kind', [
  z.strictObject({
    ...logEntryBase,
    kind: z.literal('attempt'),
    exerciseId: unitId,
    grade,
    source: attemptSource,
  }) satisfies z.ZodType<AttemptEntryDto>,
  z.strictObject({
    ...logEntryBase,
    kind: z.literal('unit_flag'),
    unitId,
    flag: z.enum(['blacklist', 'review']),
    op: z.enum(['set', 'unset']),
  }),
  z.strictObject({
    ...logEntryBase,
    kind: z.literal('progress_reset'),
    unitId,
    libraryRevision: optional(str),
  }),
]);

/** По схеме на КАЖДЫЙ ключ `RPC_METHODS`; несовпадение с контрактом — ошибка типов. */
export const schemas = {
  'library.getInfo': z.tuple([]),
  'library.getDiagnostics': z.tuple([optional(diagnosticsPageRequest)]),
  'library.validate': z.tuple([optional(validateRequest)]),
  'library.compile': z.tuple([
    optional(z.strictObject({ runChecks: optional(bool) })),
  ]),
  'library.reload': z.tuple([]),
  'library.listCourses': z.tuple([optional(pageRequest)]),
  'library.listLessons': z.tuple([unitId, optional(pageRequest)]),
  'library.listExercises': z.tuple([unitId, optional(pageRequest)]),
  'library.getUnit': z.tuple([unitId]),
  'library.matchPrefix': z.tuple([
    str,
    optional(unitKind),
    optional(pageRequest),
  ]),
  'library.getGraph': z.tuple([optional(graphQuery)]),
  'library.readAsset': z.tuple([assetRef]),
  'repositories.list': z.tuple([]),
  'repositories.add': z.tuple([
    z.strictObject({
      url: str.min(1).max(2048),
      ref: optional(str.min(1).max(255)),
    }),
  ]),
  'repositories.update': z.tuple([repositoryId]),
  'repositories.remove': z.tuple([repositoryId]),
  'repositories.cancel': z.tuple([repositoryId]),
  'practice.startSession': z.tuple([]),
  'practice.finishSession': z.tuple([
    z.strictObject({ sessionId: str.min(1) }),
  ]),
  'practice.getBatch': z.tuple([
    optional(z.strictObject({ filter: optional(exerciseFilter) })),
  ]),
  'practice.beginAttempt': z.tuple([z.strictObject({ exerciseId: unitId })]),
  'practice.submitAnswer': z.tuple([
    z.strictObject({ attemptId: str.min(1), answer: z.unknown() }),
  ]),
  'practice.completeAttempt': z.tuple([
    z.strictObject({
      attemptId: str.min(1),
      grade: optional(grade),
      outcome: optional(z.literal('gave-up')),
    }),
  ]),
  'practice.recordAttempt': z.tuple([
    z.strictObject({
      requestId,
      exerciseId: unitId,
      grade,
      at: optional(epochMs),
      source: optional(attemptSource),
    }),
  ]),
  'practice.getUnitScore': z.tuple([unitId]),
  'practice.getAttempts': z.tuple([unitId, optional(pageRequest)]),
  'practice.getProgress': z.tuple([
    optional(progressQuery),
    optional(pageRequest),
  ]),
  'practice.getFrontier': z.tuple([optional(frontierRequest)]),
  'practice.getDue': z.tuple([optional(dueRequest)]),
  'practice.resetProgress': z.tuple([z.strictObject({ unitId, requestId })]),
  'plan.getDay': z.tuple([
    z.strictObject({
      maxItems: z.int().min(1),
      seed: optional(z.int().nonnegative()),
      courseIds: optional(z.array(unitId)),
    }),
  ]),
  'placement.start': z.tuple([
    z.strictObject({
      courseIds: optional(z.array(unitId)),
      budget: z.int().min(1),
      seed: optional(z.int().nonnegative()),
    }),
  ]),
  'placement.nextProbe': z.tuple([str.min(1)]),
  'placement.answer': z.tuple([
    z.strictObject({ probeId: str.min(1), result: placementResult }),
  ]),
  'placement.finish': z.tuple([
    z.strictObject({ sessionId: str.min(1), requestId }),
  ]),
  'placement.abort': z.tuple([z.strictObject({ sessionId: str.min(1) })]),
  'remediation.getPlan': z.tuple([z.strictObject({ exerciseId: unitId })]),
  'extensions.list': z.tuple([]),
  'extensions.contributions': z.tuple([]),
  'extensions.getSettings': z.tuple([]),
  'extensions.setEnabled': z.tuple([extensionId, z.boolean()]),
  'extensions.setTrusted': z.tuple([extensionId, z.boolean()]),
  'extensions.setNotificationsEnabled': z.tuple([extensionId, z.boolean()]),
  'extensions.catalog': z.tuple([
    optional(z.strictObject({ refresh: optional(bool) })),
  ]),
  'extensions.install': z.tuple([extensionId, optional(extensionVersion)]),
  'extensions.uninstall': z.tuple([
    extensionId,
    optional(z.strictObject({ removeData: optional(bool) })),
  ]),
  'extensions.updates': z.tuple([]),
  'extensions.docs': z.tuple([
    extensionId,
    optional(z.strictObject({ version: optional(extensionVersion) })),
  ]),
  'extensions.docImage': z.tuple([
    extensionId,
    extensionVersion,
    z.string().min(1).max(200),
  ]),
  'extensions.setCheckUpdates': z.tuple([bool]),
  'extensions.setSafeMode': z.tuple([bool]),
  'extensions.diagnostics': z.tuple([]),
  'extensions.restartHost': z.tuple([]),
  'extensions.readLogs': z.tuple([
    optional(
      z.strictObject({
        extensionId: optional(extensionId),
        minLevel: optional(z.enum(LOG_LEVELS)),
        limit: optional(z.number().int().min(1).max(MAX_LOG_ENTRIES)),
      }),
    ),
  ]),
  'extensions.getSettingValues': z.tuple([extensionId]),
  'extensions.setSettingValue': z.tuple([
    extensionId,
    str.min(1).max(128),
    jsonValue,
  ]),
  'extensions.resetSettingValues': z.tuple([extensionId]),
  'extensions.dataUsage': z.tuple([extensionId]),
  'extensions.clearData': z.tuple([extensionId]),
  'extensions.invokeCommand': z.tuple([
    extensionId,
    str.min(1).max(128),
    optional(jsonValue),
  ]),
  'extensions.runImporter': z.tuple([
    extensionId,
    str.min(1).max(128),
    // размер проверяет сервис: слишком большой файл — `too-large`, а не отказ схемы
    z.union([
      z.strictObject({ name: str.min(1).max(255), text: str }),
      z.strictObject({
        name: str.min(1).max(255),
        bytes: z.instanceof(Uint8Array),
      }),
    ]),
  ]),
  'extensions.commitImport': z.tuple([str.min(1).max(128)]),
  'extensions.discardImport': z.tuple([str.min(1).max(128)]),
  'extensions.runExporter': z.tuple([
    extensionId,
    str.min(1).max(128),
    z.union([
      z.strictObject({ scope: z.literal('course'), courseId: unitId }),
      z.strictObject({ scope: z.literal('progress') }),
    ]),
  ]),
  'curation.blacklist.list': z.tuple([optional(pageRequest)]),
  'curation.blacklist.has': z.tuple([unitId]),
  'curation.blacklist.add': z.tuple([unitId]),
  'curation.blacklist.remove': z.tuple([unitId]),
  'curation.blacklist.removePrefix': z.tuple([str]),
  'curation.reviewList.list': z.tuple([optional(pageRequest)]),
  'curation.reviewList.has': z.tuple([unitId]),
  'curation.reviewList.add': z.tuple([unitId]),
  'curation.reviewList.remove': z.tuple([unitId]),
  'curation.reviewList.removePrefix': z.tuple([str]),
  'curation.filters.list': z.tuple([]),
  'curation.filters.get': z.tuple([str.min(1)]),
  'curation.filters.save': z.tuple([savedFilter]),
  'curation.filters.delete': z.tuple([str.min(1)]),
  'curation.sessions.list': z.tuple([]),
  'curation.sessions.get': z.tuple([str.min(1)]),
  'curation.sessions.save': z.tuple([studySession]),
  'curation.sessions.delete': z.tuple([str.min(1)]),
  'settings.getScheduler': z.tuple([]),
  'settings.setScheduler': z.tuple([schedulerPatch]),
  'settings.resetScheduler': z.tuple([]),
  'settings.getPreferences': z.tuple([]),
  'settings.setPreferences': z.tuple([
    z.strictObject({
      ignoredPaths: z.array(str),
      schedulerBatchSize: optional(z.int().min(1)),
    }),
  ]),
  'settings.getScorer': z.tuple([]),
  'settings.getUi': z.tuple([]),
  'settings.setUi': z.tuple([
    z.strictObject({
      theme: optional(z.string().max(64).regex(THEME_ID_PATTERN)),
      locale: optional(z.enum(['system', 'ru', 'en'])),
      activeCourseId: optional(unitId.nullable()),
      materialWidth: optional(
        z
          .int()
          .min(MATERIAL_WIDTH_RANGE.min)
          .max(MATERIAL_WIDTH_RANGE.max)
          .nullable(),
      ),
      materialCollapsed: optional(z.boolean()),
    }),
  ]),
  'settings.getLearning': z.tuple([]),
  'settings.setLearning': z.tuple([
    z.strictObject({
      gradePolicy: optional(
        z.union([
          z.literal(BUILTIN_GRADE_POLICY),
          z.string().max(64).regex(GRADE_POLICY_ID_PATTERN),
        ]),
      ),
    }),
  ]),
  'settings.getKeybindings': z.tuple([]),
  'settings.setKeybindings': z.tuple([keybindingsPatch]),
  'sync.getState': z.tuple([]),
  'sync.exportSince': z.tuple([
    optional(
      z.strictObject({
        since: optional(stateVector),
        limit: optional(z.int().min(1).max(5000)),
      }),
    ),
  ]),
  'sync.import': z.tuple([z.array(logEntry)]),
  'sync.rebuild': z.tuple([]),
  'sync.importFromTrane': z.tuple([z.strictObject({ traneDir: str.min(1) })]),
  'sync.getConflicts': z.tuple([optional(pageRequest)]),
  'sync.resolveConflict': z.tuple([
    z.strictObject({ conflictId: str.min(1), keep: str.min(1) }),
  ]),
  'sync.folder.configure': z.tuple([z.strictObject({ dir: str.min(1) })]),
  'sync.folder.sync': z.tuple([]),
  'sync.folder.checkRestore': z.tuple([]),
  diagnostics: z.tuple([]),
} satisfies { [K in RpcMethodName]: z.ZodType<ArgsOf<K>> };

export type RpcSchemas = typeof schemas;
