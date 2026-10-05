export const CONTRACT_VERSION = 25 as const;
/** Потолок `JSON.stringify(answer).length` на границе движка; длиннее — `INVALID_ARGUMENT` без обращения к расширению. */
export const MAX_ANSWER_CHARS = 200_000 as const;

export type UnitId = string;
export type EpochMs = number;
export type Grade = 1 | 2 | 3 | 4 | 5;
export type UnitKind = 'course' | 'lesson' | 'exercise';

/** Любое значение JSON (хранилище и настройки расширений). */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface PageRequest {
  limit?: number;
  cursor?: string;
}
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export type EngineErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'ENGINE_CLOSED'
  | 'INCOMPATIBLE_CONTRACT'
  | 'LIBRARY_NOT_LOADED'
  | 'LIBRARY_INVALID'
  | 'ASSET_OUTSIDE_LIBRARY'
  | 'ASSET_TOO_LARGE'
  | 'ATTEMPT_NOT_FOUND'
  | 'ATTEMPT_CLOSED'
  | 'EXERCISE_TYPE_UNAVAILABLE'
  | 'PLACEMENT_SESSION_NOT_FOUND'
  | 'PLACEMENT_SESSION_ACTIVE'
  | 'PLACEMENT_BUDGET_EXHAUSTED'
  | 'SYNC_DEVICE_ID_CLASH'
  | 'SYNC_CONFLICT_NOT_FOUND'
  | 'SYNC_FOLDER_NOT_CONFIGURED'
  | 'STORE_BUSY'
  | 'STORE_READONLY'
  | 'STORE_CORRUPT'
  | 'REPOSITORY_EXISTS'
  | 'REPOSITORY_REJECTED'
  | 'GIT_FETCH_FAILED'
  | 'CATALOG_UNAVAILABLE'
  | 'EXTENSION_INSTALL_FAILED'
  /** Запись в хранилище расширения превысила потолок; `details`: `extensionId`, `kind`, `limit`. */
  | 'EXTENSION_STORAGE_QUOTA'
  /** Системного хранилища ключей нет (или оно не расшифровало значение): секрет расширения не записан и не прочитан. */
  | 'SECRETS_UNAVAILABLE'
  /** Команда расширения не выполнена; `details`: `extensionId`, `commandId`, `reason` (`ExtensionCommandFailureReason`). */
  | 'EXTENSION_COMMAND_FAILED'
  /** Импорт или экспорт расширения не выполнен; `details`: `extensionId`, `id`, `kind` (`import` | `export`), `reason` (`ExtensionTransferFailureReason`). */
  | 'EXTENSION_TRANSFER_FAILED'
  | 'INTERNAL';

export interface EngineErrorDto {
  code: EngineErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type Severity = 'error' | 'warning' | 'info';
/** Каталог компилятора: 36 кодов + `W_GRANULARITY`, `E_REFERENCE_FAILS` (engine-ts.md §1.1, F2) + `W_ORPHAN_EVENTS` (его выдаёт движок при открытии, не компилятор). Префикс = серьёзность по умолчанию. */
export type DiagnosticCode =
  // разбор и схема
  | 'E_IO'
  | 'E_JSON_PARSE'
  | 'E_SCHEMA'
  | 'W_UNKNOWN_KEY'
  | 'E_FRONTMATTER_UNTERMINATED'
  | 'E_FRONTMATTER_PARSE'
  | 'E_ENGINE_SCHEMA'
  | 'W_ENGINE_UNKNOWN_KEY'
  | 'E_ENGINE_DUPLICATE'
  | 'W_UNKNOWN_EXERCISE_TYPE'
  | 'E_EXERCISE_SPEC'
  // идентификаторы
  | 'E_ID_EMPTY'
  | 'E_ID_DUPLICATE'
  | 'E_ID_MISMATCH'
  // граф
  | 'E_DEP_MISSING'
  | 'E_DEP_SELF'
  | 'E_DEP_KIND'
  | 'E_CYCLE_DEPENDENCY'
  | 'E_CYCLE_SUPERSEDED'
  | 'E_CYCLE_ENCOMPASSED'
  | 'W_REDUNDANT_EDGE'
  | 'E_ENC_WEIGHT'
  | 'E_ENC_MISSING'
  | 'E_ENC_NOT_ANCESTOR'
  | 'E_SUP_MISSING'
  | 'W_ORPHAN_LESSON'
  | 'W_FAN_IN'
  // расширение `engine`
  | 'E_KEYPREREQ_MISSING'
  | 'E_KEYPREREQ_NOT_ANCESTOR'
  | 'E_NO_VERIFICATION'
  | 'I_NO_VERIFICATION'
  // ассеты и раскладка
  | 'W_UNSUPPORTED_GENERATOR'
  | 'E_ASSET_MISSING'
  | 'E_ASSET_ESCAPES_ROOT'
  | 'E_ASSET_TYPE'
  | 'W_ASSET_KIND_UNSUPPORTED'
  | 'W_KB_STRAY_FILE'
  // сверх каталога спайка (компилятор)
  | 'W_GRANULARITY'
  | 'E_REFERENCE_FAILS'
  // выдаёт движок при открытии библиотеки: в журнале есть события юнитов, которых нет в библиотеке (engine-ts.md §9, курс переименовали)
  | 'W_ORPHAN_EVENTS';

/** Серьёзность по умолчанию: 36 значений из `spike/compiler/src/diagnostics.ts`; для трёх новых кодов — по префиксу [ВЫВОД]. */
export const DIAGNOSTIC_SEVERITY: Record<DiagnosticCode, Severity> = {
  E_IO: 'error',
  E_JSON_PARSE: 'error',
  E_SCHEMA: 'error',
  W_UNKNOWN_KEY: 'warning',
  E_FRONTMATTER_UNTERMINATED: 'error',
  E_FRONTMATTER_PARSE: 'error',
  E_ENGINE_SCHEMA: 'error',
  W_ENGINE_UNKNOWN_KEY: 'warning',
  E_ENGINE_DUPLICATE: 'error',
  W_UNKNOWN_EXERCISE_TYPE: 'warning',
  E_EXERCISE_SPEC: 'error',
  E_ID_EMPTY: 'error',
  E_ID_DUPLICATE: 'error',
  E_ID_MISMATCH: 'error',
  E_DEP_MISSING: 'error',
  E_DEP_SELF: 'error',
  E_DEP_KIND: 'error',
  E_CYCLE_DEPENDENCY: 'error',
  E_CYCLE_SUPERSEDED: 'error',
  E_CYCLE_ENCOMPASSED: 'error',
  W_REDUNDANT_EDGE: 'warning',
  E_ENC_WEIGHT: 'error',
  E_ENC_MISSING: 'error',
  E_ENC_NOT_ANCESTOR: 'error',
  E_SUP_MISSING: 'error',
  W_ORPHAN_LESSON: 'warning',
  W_FAN_IN: 'warning',
  E_KEYPREREQ_MISSING: 'error',
  E_KEYPREREQ_NOT_ANCESTOR: 'error',
  E_NO_VERIFICATION: 'error',
  I_NO_VERIFICATION: 'info',
  W_UNSUPPORTED_GENERATOR: 'warning',
  E_ASSET_MISSING: 'error',
  E_ASSET_ESCAPES_ROOT: 'error',
  E_ASSET_TYPE: 'error',
  W_ASSET_KIND_UNSUPPORTED: 'warning',
  W_KB_STRAY_FILE: 'warning',
  W_GRANULARITY: 'warning',
  E_REFERENCE_FAILS: 'error',
  W_ORPHAN_EVENTS: 'warning',
};

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  unitId?: UnitId;
  /** Путь файла относительно корня библиотеки. */
  path?: string;
  /** Строка в `path` (1-based), где она детерминирована. */
  line?: number;
  /** Связанные юниты: полный путь цикла (`E_CYCLE_*`), цель `encompassed`, обходной пререквизит `W_REDUNDANT_EDGE`. */
  related?: UnitId[];
}
export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  infos: number;
}

/** `fresh` — артефакт соответствует библиотеке (stat или content-`revision`); `stale` — `revision` отличается; `missing` — файла нет или он не читается; `compiling` — идёт фоновая компиляция. */
export type ArtifactState = 'fresh' | 'stale' | 'missing' | 'compiling';

export interface LibraryInfo {
  contractVersion: number;
  root: string;
  /** content-`revision` загруженной библиотеки (sha256 по отсортированным `path\0len\0bytes`). */
  revision: string;
  state: 'ready' | 'invalid';
  artifact: ArtifactState;
  counts: {
    courses: number;
    lessons: number;
    exercises: number;
    dependencyEdges: number;
  };
  diagnostics: DiagnosticSummary;
  loadedAt: EpochMs;
  loadMs: number;
}

export interface AssetRef {
  unitId: UnitId;
  path: string;
}
export interface WeightedRef {
  id: UnitId;
  weight: number;
}

export interface UnitCommon {
  id: UnitId;
  name: string;
  description?: string;
  metadata: Record<string, string[]>;
  dependencies: UnitId[];
  encompassed: WeightedRef[];
  superseded: UnitId[];
}
export interface CourseDto extends UnitCommon {
  kind: 'course';
  lessonCount: number;
  authors?: string[];
  material?: AssetRef;
  instructions?: AssetRef;
}
export interface LessonDto extends UnitCommon {
  kind: 'lesson';
  courseId: UnitId;
  exerciseCount: number;
  material?: AssetRef;
  instructions?: AssetRef;
}

export type ExerciseContentDto =
  | { type: 'flashcard'; front: AssetRef; back?: AssetRef }
  | { type: 'inlineFlashcard'; front: string; back?: string }
  | { type: 'markdown'; ref: AssetRef }
  | { type: 'inlineMarkdown'; text: string };

/** Вид задания и элемент ввода ответа, объявленные расширением. */
export interface ExerciseTaskDto {
  type: string;
  timeoutMs: number;
  element: string;
  rendererUrl: string;
  /** Расширение не из поставки и не доверенное: элемент ответа исполняется в изолированной рамке. */
  isolated: boolean;
  /** Откуда расширение: у `dev` окно пересоздаёт смонтированный элемент при правке (`revision` меняется). */
  origin: ExtensionOriginDto;
  /** Отпечаток файлов расширения (меняется при обновлении и правке); у расширений из поставки — пустая строка. */
  revision: string;
}
export interface ExerciseDto {
  kind: 'exercise';
  id: UnitId;
  lessonId: UnitId;
  courseId: UnitId;
  name: string;
  description?: string;
  exerciseType: 'declarative' | 'procedural';
  content: ExerciseContentDto;
  task?: ExerciseTaskDto;
  keyPrerequisites: UnitId[];
}
export type UnitDto = CourseDto | LessonDto | ExerciseDto;

export interface GraphQuery {
  rootIds?: UnitId[];
  depth?: number;
  kinds?: UnitKind[];
  limit?: number;
}
export interface GraphNodeDto {
  id: UnitId;
  kind: UnitKind;
  name: string;
  parentId?: UnitId;
}
/** `from` зависит от `to` (dependency), охватывает `to` (encompassed) или заменяет `to` (superseded). */
export interface GraphEdgeDto {
  from: UnitId;
  to: UnitId;
  type: 'dependency' | 'encompassed' | 'superseded';
  weight?: number;
}
export interface GraphDto {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  truncated: boolean;
}

export interface AssetContent {
  ref: AssetRef;
  mime: 'text/markdown' | 'text/plain';
  text: string;
  bytes: number;
}

export interface ValidateRequest extends PageRequest {
  minSeverity?: Severity;
  /** Прогнать эталонные решения через раннер и выдать `E_REFERENCE_FAILS` (M5). */
  runChecks?: boolean;
}
export interface ValidateResult extends Page<Diagnostic> {
  /** content-`revision` файлов на момент проверки; может отличаться от `LibraryInfo.revision`. */
  revision: string;
  summary: DiagnosticSummary;
  checksRun: boolean;
}
export interface CompileRequest {
  runChecks?: boolean;
}
export interface CompileResult {
  revision: string;
  diagnosticsSummary: DiagnosticSummary;
  /** false: есть ошибки (артефакт не пишется) или свежий артефакт уже лежит на диске. */
  artifactWritten: boolean;
}

export interface LibraryService {
  getInfo(): Promise<LibraryInfo>;
  getDiagnostics(
    req?: PageRequest & { minSeverity?: Severity },
  ): Promise<Page<Diagnostic>>;
  validate(req?: ValidateRequest): Promise<ValidateResult>;
  compile(req?: CompileRequest): Promise<CompileResult>;
  reload(): Promise<LibraryInfo>;
  listCourses(req?: PageRequest): Promise<Page<CourseDto>>;
  listLessons(courseId: UnitId, req?: PageRequest): Promise<Page<LessonDto>>;
  listExercises(
    lessonId: UnitId,
    req?: PageRequest,
  ): Promise<Page<ExerciseDto>>;
  getUnit(id: UnitId): Promise<UnitDto>;
  matchPrefix(
    prefix: string,
    kind?: UnitKind,
    req?: PageRequest,
  ): Promise<Page<UnitId>>;
  getGraph(query?: GraphQuery): Promise<GraphDto>;
  readAsset(ref: AssetRef): Promise<AssetContent>;
}

export type FilterOp = 'All' | 'Any';
export type FilterType = 'Include' | 'Exclude';
export type KeyValueFilterWire =
  | { CourseFilter: { key: string; value: string; filter_type: FilterType } }
  | { LessonFilter: { key: string; value: string; filter_type: FilterType } }
  | { CombinedFilter: { op: FilterOp; filters: KeyValueFilterWire[] } };
export type UnitFilterWire =
  | { CourseFilter: { course_ids: UnitId[] } }
  | { LessonFilter: { lesson_ids: UnitId[] } }
  | { MetadataFilter: { filter: KeyValueFilterWire } }
  | 'ReviewListFilter'
  | { Dependents: { unit_ids: UnitId[] } }
  | { Dependencies: { unit_ids: UnitId[]; depth: number } };
export type SessionPartWire =
  | { UnitFilter: { filter: UnitFilterWire; duration: number } }
  | { SavedFilter: { filter_id: string; duration: number } }
  | { NoFilter: { duration: number } };
export interface StudySessionWire {
  id: string;
  description?: string;
  parts?: SessionPartWire[];
}
export type ExerciseFilterDto =
  | { UnitFilter: UnitFilterWire }
  | { StudySession: { startTimeMs: EpochMs; definition: StudySessionWire } };

export type MasteryWindowName =
  'new' | 'target' | 'current' | 'easy' | 'mastered';
export interface UnitScoreDto {
  unitId: UnitId;
  kind: UnitKind;
  /** 0..5; null = нет валидной оценки. В `getBatch` (паритет Trane) зависимость без оценки считается выполненной; в `getFrontier` — закрытой (§4). */
  score: number | null;
  avgTrials: number | null;
  window: MasteryWindowName | null;
}

export type UnitStatus =
  | 'locked'
  | 'ready'
  | 'in-progress'
  | 'mastered'
  | 'blacklisted'
  | 'superseded';
export interface ProgressNodeDto {
  id: UnitId;
  kind: UnitKind;
  status: UnitStatus;
  score: number | null;
  avgTrials: number | null;
  attempts: number;
  lastAttemptAt?: EpochMs;
  dueExercises?: number;
}
export interface ProgressQuery {
  scope?: { courseId: UnitId } | { lessonId: UnitId } | { unitIds: UnitId[] };
  includeExercises?: boolean;
}

export type AttemptSource = 'self' | 'runner' | 'placement' | 'trane-import';
export interface AttemptRecordDto {
  eventId: string;
  exerciseId: UnitId;
  grade: Grade;
  at: EpochMs;
  source: AttemptSource;
}

export interface BatchRequest {
  filter?: ExerciseFilterDto;
}
/** `reasons[i]` — причина показа `exercises[i]`; массивы одной длины. */
export interface BatchDto {
  exercises: ExerciseDto[];
  reasons: ItemReason[];
  generatedAt: EpochMs;
  sessionId: string;
}

/** Причина позиции в батче и плане дня: `new` — попыток нет; `review` — есть попытки; `remediation` — вставлено ремедиацией (§4.3). */
export type ItemReason = 'review' | 'new' | 'remediation';

export interface AttemptDto {
  attemptId: string;
  exercise: ExerciseDto;
  startedAt: EpochMs;
  verifiable: boolean;
  /** Результат `project()` расширения; `null`, если упражнение не проверяемое. */
  view: unknown;
}
export interface SubmitAnswerRequest {
  attemptId: string;
  answer: unknown;
}
/**
 * Причины `error`-вердикта, которые порождает хост, а не расширение
 * (остальные причины открытые строки расширения).
 */
export const HOST_ERROR_REASONS = [
  'timeout',
  'resource_kill',
  'worker_crash',
  'internal',
] as const;
export type HostErrorReason = (typeof HOST_ERROR_REASONS)[number];

interface VerdictBase {
  attemptId: string;
  /** Число вердиктов `passed`/`failed` по попытке; `error` не считается. */
  attemptsUsed: number;
  durationMs: number;
  feedback?: string;
  /** Данные расширения, непрозрачны для движка (например, `{ rowCount }` у SQL). */
  data?: unknown;
}
export type VerdictDto =
  | (VerdictBase & { outcome: 'passed' })
  /** Вина ученика. `detail` (ожидаемые строки) — только при `EngineConfig.authorMode`. */
  | (VerdictBase & { outcome: 'failed'; reason: string; detail?: string })
  /** Не вина ученика: журнал не затрагивается, повтор `submitAnswer` разрешён. */
  | (VerdictBase & { outcome: 'error'; reason: string });
export interface CompleteAttemptRequest {
  attemptId: string;
  grade?: Grade;
  outcome?: 'gave-up';
}
export interface RecordAttemptRequest {
  requestId: string;
  exerciseId: UnitId;
  grade: Grade;
  at?: EpochMs;
  source?: AttemptSource;
}
export interface RecordResultDto {
  eventId: string;
  exerciseId: UnitId;
  grade: Grade;
  at: EpochMs;
  duplicate: boolean;
  affected: UnitScoreDto[];
  /** Только если порог ремедиации пересечён именно этой попыткой (§4.3). */
  remediation?: RemediationDto;
}

export interface FrontierRequest extends PageRequest {
  courseId?: UnitId;
}
export interface FrontierItemDto {
  lessonId: UnitId;
  courseId: UnitId;
  exerciseCount: number;
}
export interface DueRequest extends PageRequest {
  minNeed?: number;
  /** Область курсов (как `PlacementStartRequest.courseIds`): пусто или нет поля — все курсы; неизвестный курс — `NOT_FOUND`. */
  courseIds?: UnitId[];
}
export interface DueItemDto {
  exerciseId: UnitId;
  lessonId: UnitId;
  /** `1 − retrievability`, 0..1; список отсортирован по убыванию. */
  need: number;
  /** R сейчас, 0..1. */
  retrievability: number;
  score: number;
  lastAttemptAt: EpochMs;
}

export interface PracticeService {
  startSession(): Promise<{ sessionId: string; startedAt: EpochMs }>;
  /**
   * Окно сообщает, что сессия обучения закончилась: расширения с событием
   * `session.finished` получают его один раз на `sessionId`. Идемпотентна:
   * повтор и неизвестный `sessionId` ничего не отправляют (`emitted: false`).
   * После неё следующий `getBatch` начинает новую сессию.
   */
  finishSession(req: { sessionId: string }): Promise<{ emitted: boolean }>;
  getBatch(req?: BatchRequest): Promise<BatchDto>;
  beginAttempt(req: { exerciseId: UnitId }): Promise<AttemptDto>;
  submitAnswer(req: SubmitAnswerRequest): Promise<VerdictDto>;
  completeAttempt(req: CompleteAttemptRequest): Promise<RecordResultDto>;
  recordAttempt(req: RecordAttemptRequest): Promise<RecordResultDto>;
  getUnitScore(unitId: UnitId): Promise<UnitScoreDto>;
  getAttempts(
    exerciseId: UnitId,
    req?: PageRequest,
  ): Promise<Page<AttemptRecordDto>>;
  getProgress(
    query?: ProgressQuery,
    req?: PageRequest,
  ): Promise<Page<ProgressNodeDto>>;
  getFrontier(req?: FrontierRequest): Promise<Page<FrontierItemDto>>;
  getDue(req?: DueRequest): Promise<Page<DueItemDto>>;
  resetProgress(req: {
    unitId: UnitId;
    requestId: string;
  }): Promise<{ eventId: string; duplicate: boolean }>;
}

export interface PlanRequest {
  /** 1..200 (граница — самый большой замеренный размер плана, §10). */
  maxItems: number;
  /** uint32; при равных (состояние, seed) план одинаков. Без `seed` хост берёт его из `Rng` и возвращает в `DayPlanDto.seed`. */
  seed?: number;
  /** Область курсов: в план попадают упражнения (в том числе ремедиация) только этих курсов, порядок и чередование считаются внутри области. Пусто или нет поля — все курсы; неизвестный курс — `NOT_FOUND`. При равных (состояние, seed, область) план одинаков. */
  courseIds?: UnitId[];
}
export interface PlanCoverDto {
  exerciseId: UnitId;
  credit: number;
}
export interface PlanItemDto {
  exerciseId: UnitId;
  reason: ItemReason;
  /** Упражнения, чей повтор этот элемент сжимает неявным кредитом; только при `implicitCreditEnabled`. */
  covers?: PlanCoverDto[];
}
export interface DayPlanDto {
  items: PlanItemDto[];
  /** true, если интерливинг выполним и соблюдён (не более `plan.maxSameCourseRun` подряд из одного курса, общие теги разнесены на `plan.minTagDistance`). */
  interleaveOk: boolean;
  implicitCreditEnabled: boolean;
  seed: number;
  generatedAt: EpochMs;
}
export interface PlanService {
  getDay(req: PlanRequest): Promise<DayPlanDto>;
}

export interface PlacementStartRequest {
  /** Пусто или нет поля — все курсы библиотеки. */
  courseIds?: UnitId[];
  /** Максимум проб, целое 1..200 (граница — предположение [ВЫВОД]); иначе `INVALID_ARGUMENT`. */
  budget: number;
  seed?: number;
}
export interface PlacementStartResult {
  sessionId: string;
  lessonCount: number;
  budget: number;
  seed: number;
}
export interface PlacementProbeDto {
  probeId: string;
  lessonId: UnitId;
  exerciseId: UnitId;
}
/** `grade` — самооценка («пройдено» ⇔ оценка ≥ 3, engine-ts.md §6a.3); `attempt` — итог открытой попытки с проверкой (последний `passed`/`failed`). */
export type PlacementResult =
  { kind: 'grade'; grade: Grade } | { kind: 'attempt'; attemptId: string };
export interface PlacementAnswerRequest {
  probeId: string;
  result: PlacementResult;
}
export interface PlacementProgressDto {
  asked: number;
  budget: number;
  /** Темы, ещё не решённые (`p` между порогами); 0 — тест можно завершать. */
  unresolved: number;
}
export interface PlacementFinishRequest {
  sessionId: string;
  requestId: string;
}
export interface PlacementSummaryDto {
  /** Идентификаторы уроков. */
  known: UnitId[];
  unknown: UnitId[];
  uncertain: UnitId[];
  /** Фронтир, вычисленный из `known`; завышен за счёт `uncertain`-границы. */
  frontier: UnitId[];
  /** Записано попыток `source: 'placement'`: по 2 на упражнение каждого `known`-урока. */
  attemptsWritten: number;
  duplicate: boolean;
}
export interface PlacementService {
  start(req: PlacementStartRequest): Promise<PlacementStartResult>;
  /** `null` — проб больше нет (бюджет исчерпан или все темы решены). До ответа на выданную пробу возвращает ту же пробу. */
  nextProbe(sessionId: string): Promise<PlacementProbeDto | null>;
  answer(req: PlacementAnswerRequest): Promise<PlacementProgressDto>;
  finish(req: PlacementFinishRequest): Promise<PlacementSummaryDto>;
  abort(req: { sessionId: string }): Promise<void>;
}

export interface RemediationStepDto {
  /** Пререквизит-юнит (урок); в порядке `engine.keyPrerequisites`, иначе прямые зависимости урока с наименьшей R. */
  unitId: UnitId;
  source: 'key-prerequisite' | 'lesson-dependency';
  /** Упражнения шага: наименьшая R, не начатые — по порядку id; всего по плану не больше `remediation.maxItems`. */
  exerciseIds: UnitId[];
  /** Успех на каждом упражнении шага после триггера. */
  done: boolean;
}
export interface RemediationDto {
  exerciseId: UnitId;
  /** true — триггер сработал и не снят. */
  active: boolean;
  triggeredAt?: EpochMs;
  steps: RemediationStepDto[];
}
export interface RemediationService {
  getPlan(req: { exerciseId: UnitId }): Promise<RemediationDto>;
}

export interface FlagService {
  list(req?: PageRequest): Promise<Page<UnitId>>;
  has(unitId: UnitId): Promise<boolean>;
  add(unitId: UnitId): Promise<void>;
  remove(unitId: UnitId): Promise<void>;
  /** Раскрывает префикс в id на момент вызова и пишет по записи на юнит. */
  removePrefix(prefix: string): Promise<{ removed: UnitId[] }>;
}
export interface SavedFilterDto {
  id: string;
  description: string;
  filter: UnitFilterWire;
}
export interface FilterStoreService {
  list(): Promise<Array<{ id: string; description: string }>>;
  get(id: string): Promise<SavedFilterDto>;
  save(filter: SavedFilterDto): Promise<void>;
  delete(id: string): Promise<void>;
}
export interface SessionStoreService {
  list(): Promise<Array<{ id: string; description: string }>>;
  get(id: string): Promise<StudySessionWire>;
  save(session: StudySessionWire): Promise<void>;
  delete(id: string): Promise<void>;
}
export interface CurationService {
  blacklist: FlagService;
  reviewList: FlagService;
  filters: FilterStoreService;
  sessions: SessionStoreService;
}

export interface MasteryWindowDto {
  percentage: number;
  range: [number, number];
}
export interface ImplicitCreditOptionsDto {
  /** По умолчанию false: выигрыш измерен только в круговой модели (engine-ts.md §6a.2). */
  enabled: boolean;
  /** Затухание по глубине охвата, 0 < λ ≤ 1 [диапазон — ВЫВОД]. */
  lambda: number;
  /** Кредит ниже порога отбрасывается, 0 < minCredit ≤ 1 [диапазон — ВЫВОД]. */
  minCredit: number;
  /** Множитель на кредит. Не измерен: подбирается A/B на реальных ответах [НЕ ПОДТВЕРЖДЕНО]. */
  kappa: number;
}
export interface RemediationOptionsDto {
  failThreshold: number;
  maxItems: number;
}
export interface PlanOptionsDto {
  targetRetention: number;
  minNewFraction: number;
  maxSameCourseRun: number;
  minTagDistance: number;
}

export interface SchedulerOptionsDto {
  batchSize: number;
  relearnFraction: number;
  masteryWindows: {
    new: MasteryWindowDto;
    target: MasteryWindowDto;
    current: MasteryWindowDto;
    easy: MasteryWindowDto;
    mastered: MasteryWindowDto;
  };
  passingScore: { minScore: number; minFraction: number; minAvgTrials: number };
  supersedingScore: number;
  numTrials: number;
  numRewards: number;
  maxLessonsInProgress: number;
  /** Неявный повтор (FIRe), по умолчанию `{ enabled: false, lambda: 0.9, minCredit: 0.2, kappa: 1 }`. */
  implicitCredit: ImplicitCreditOptionsDto;
  /** По умолчанию `{ failThreshold: 2, maxItems: 3 }` — предположения [НЕ ПОДТВЕРЖДЕНО]. */
  remediation: RemediationOptionsDto;
  /** По умолчанию `{ targetRetention: 0.9, minNewFraction: 0.25, maxSameCourseRun: 2, minTagDistance: 2 }`. */
  plan: PlanOptionsDto;
}
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface ScorerInfoDto {
  kind: 'fsrs-hybrid' | 'power-law';
  memoryModelId: string;
  ratingMap: 'runner' | 'anki';
  numTrials: number;
  parametersHash: string;
}
export interface PreferencesDto {
  ignoredPaths: string[];
  schedulerBatchSize?: number;
}

/** Встроенные режимы темы; кроме них `theme` может быть id темы расширения. */
export type ThemeMode = 'system' | 'light' | 'dark';
export const BUILTIN_THEMES = ['system', 'light', 'dark'] as const;
/** Допустимый вид id темы расширения (движок не проверяет, что тема есть). */
export const THEME_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** `system` — язык системы; renderer сам выбирает из поддерживаемых. */
export type LocaleMode = 'system' | 'ru' | 'en';
/** Настройки интерфейса; хранятся вместе с остальными настройками в `engine.db`. */
export interface UiSettingsDto {
  /** Встроенный режим или id темы расширения. */
  theme: string;
  locale: LocaleMode;
  /** Курс в фокусе: клиент передаёт его в `courseIds` плана и повторений. Нет поля — все курсы. Движок не проверяет, что курс есть в библиотеке: курс могли убрать, клиент сверяет сам. */
  activeCourseId?: UnitId;
  /** Ширина панели теории в сессии и вход-тесте, px. Нет поля — умолчание клиента. */
  materialWidth?: number;
  /** Панель теории скрыта. Нет поля — показана. */
  materialCollapsed?: true;
}
/** Допустимая ширина панели теории, px (`UiSettingsDto.materialWidth`). */
export const MATERIAL_WIDTH_RANGE = { min: 280, max: 800 } as const;
/** `activeCourseId: null` снимает фокус, `materialWidth: null` возвращает умолчание, `materialCollapsed: false` показывает панель. */
export type UiSettingsPatch = Partial<
  Omit<UiSettingsDto, 'activeCourseId' | 'materialWidth' | 'materialCollapsed'>
> & {
  activeCourseId?: UnitId | null;
  materialWidth?: number | null;
  materialCollapsed?: boolean;
};

/** Id встроенного правила оценки (`pass@N`). */
export const BUILTIN_GRADE_POLICY = 'passAtN' as const;
/** Допустимый вид id правила оценки расширения (движок не проверяет, что правило есть). */
export const GRADE_POLICY_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
/** Настройки обучения; хранятся вместе с остальными настройками в `engine.db`. */
export interface LearningSettingsDto {
  /** `passAtN` или id правила оценки расширения. */
  gradePolicy: string;
}

export interface SettingsService {
  getScheduler(): Promise<SchedulerOptionsDto>;
  /** Валидирует (`verify` как при открытии), применяет ко всем компонентам сразу. */
  setScheduler(
    patch: DeepPartial<SchedulerOptionsDto>,
  ): Promise<SchedulerOptionsDto>;
  resetScheduler(): Promise<SchedulerOptionsDto>;
  getPreferences(): Promise<PreferencesDto>;
  setPreferences(prefs: PreferencesDto): Promise<{ restartRequired: boolean }>;
  getScorer(): Promise<ScorerInfoDto>;
  getUi(): Promise<UiSettingsDto>;
  /** Валидирует и сохраняет; возвращает итоговые настройки. */
  setUi(patch: UiSettingsPatch): Promise<UiSettingsDto>;
  getLearning(): Promise<LearningSettingsDto>;
  /** Валидирует вид id (существование правила не проверяется) и сохраняет; возвращает итоговые настройки. */
  setLearning(
    patch: Partial<LearningSettingsDto>,
  ): Promise<LearningSettingsDto>;
  getKeybindings(): Promise<KeybindingsSettingsDto>;
  /**
   * Применяет патч целиком или не применяет: набор команды заменяется,
   * `null` возвращает умолчания. Отклоняет (`INVALID_ARGUMENT`,
   * `details.field`/`reason`/`command`/`other`) неверные клавиши и условия,
   * превышение лимитов, повторы и пересечения пользовательских привязок
   * разных команд. Возвращает итоговые привязки.
   */
  setKeybindings(patch: KeybindingsPatch): Promise<KeybindingsSettingsDto>;
}

/** Привязка пользователя: запись клавиш (`Mod+Shift+L`, `Mod+K Mod+S`) и условие `when` (`null` — без условия). */
export interface KeybindingEntryDto {
  key: string;
  when: string | null;
}

/** Пользовательские привязки по ключам команд (`app:<id>`, `extension:<extensionId>:<id>`); набор заменяет привязки команды из кода и расширений целиком, пустой — «снято». Хранятся в `engine.db`. */
export interface KeybindingsSettingsDto {
  commands: Record<string, KeybindingEntryDto[]>;
}

/** Ключ команды → новый набор или `null` (сбросить к умолчаниям). */
export type KeybindingsPatch = Record<string, KeybindingEntryDto[] | null>;

/** Причина отказа `setKeybindings` в `details.reason`. */
export type KeybindingsRejectReason =
  'syntax' | 'typing' | 'conflict' | 'limit' | 'duplicate';

/** Вектор для дельта-экспорта: `{deviceId: contiguous}` — непрерывный префикс seq (1..contiguous без пропусков), не `maxSeq`. */
export type StateVector = Record<string, number>;
/** Дыры за префиксом по устройствам: seq, записи которых уже есть, но предыдущих нет. */
export type MissingSeqs = Record<string, number[]>;

/**
 * `at` — время события по HLC-правилу (engine-ts.md §5.1): `max(min(now, now + 5 мин), maxAtУвиденный + 1, свойПрошлыйAt)`.
 * Порядок везде `(at, deviceId, seq)`, при равных `(deviceId, seq)` — `id`. `recordedAt` — wall-clock записи, порядок не задаёт.
 */
interface LogEntryBaseDto {
  id: string;
  deviceId: string;
  seq: number;
  at: EpochMs;
  recordedAt: EpochMs;
}
export interface AttemptEntryDto extends LogEntryBaseDto {
  kind: 'attempt';
  exerciseId: UnitId;
  grade: Grade;
  source: AttemptSource;
}
export interface UnitFlagEntryDto extends LogEntryBaseDto {
  kind: 'unit_flag';
  unitId: UnitId;
  flag: 'blacklist' | 'review';
  op: 'set' | 'unset';
}
export interface ProgressResetEntryDto extends LogEntryBaseDto {
  kind: 'progress_reset';
  unitId: UnitId;
  /** `revision` библиотеки на момент записи: диагностика расхождения версий курса между устройствами. */
  libraryRevision?: string;
}
export type LogEntryDto =
  AttemptEntryDto | UnitFlagEntryDto | ProgressResetEntryDto;

export interface SyncStateDto {
  deviceId: string;
  vector: StateVector;
  missing: MissingSeqs;
  entryCount: number;
  /** Неразрешённые конфликты. */
  conflictCount: number;
}
export interface ExportRequest {
  since?: StateVector;
  limit?: number;
}
export interface ExportResult {
  entries: LogEntryDto[];
  next?: StateVector;
}
export interface ImportResult {
  inserted: number;
  duplicates: number;
  /** Структурно неверные записи. Конфликты (`id-content`, `seq-two-ids`, `clock-skew`) сюда не попадают. */
  rejected: Array<{ id: string; reason: string }>;
  /** Новые конфликты, обнаруженные этим импортом. */
  conflicts: number;
  rebuilt: boolean;
}
export interface RebuildResult {
  entries: number;
  ms: number;
}
export interface TraneImportResult {
  attempts: number;
  flags: number;
  skipped: number;
}

export interface SyncConflictDto {
  conflictId: string;
  /**
   * `id-content` — тот же `id`, другое содержимое; `seq-two-ids` — тот же `(deviceId, seq)`, другой `id`;
   * `clock-skew` — запись с `at > recordedAt + 24 ч` (карантин по часам) [ВЫВОД, в спайке не реализовано].
   */
  reason: 'id-content' | 'seq-two-ids' | 'clock-skew';
  /** Все стороны конфликта; скрыты от проекций, пока конфликт открыт. */
  entries: LogEntryDto[];
  /**
   * `entryHash` (sha256 канонического JSON записи) каждой стороны — в том же порядке, что и `entries`.
   * В `id-content` у сторон общий `id`; конкретную сторону выбирают по `entryHash` в `ResolveConflictRequest.keep`.
   */
  entryHashes: string[];
  detectedAt: EpochMs;
}
export interface ResolveConflictRequest {
  conflictId: string;
  /**
   * `id` записи либо её `entryHash` (из `SyncConflictDto.entryHashes`), которую вернуть в проекции;
   * `'none'` — оставить скрытыми все. В `id-content` у сторон общий `id` — по `id` берётся первая сторона
   * в каноническом порядке, точную сторону выбирают по `entryHash`.
   */
  keep: string | 'none';
}
export interface ResolveConflictResult {
  conflictId: string;
  kept: string | null;
  rebuilt: boolean;
}

export interface FolderSyncConfigureRequest {
  dir: string;
}
export interface FolderSyncReport {
  inserted: number;
  duplicates: number;
  /** Число отвергнутых записей (у `sync.import` — массив с причинами). */
  rejected: number;
  /** Сегменты, которые не применены и повторятся в следующем раунде. */
  pending: number;
  headErrors: string[];
  corruptSegments: string[];
  pendingSegments: string[];
  /** Применённые сегменты `device/name`. */
  applied: string[];
  /** Опубликованный хвост своего журнала. */
  published: { segments: number; entries: number };
  conflicts: number;
  rebuilt: boolean;
}
export interface FolderRestoreResult {
  /** `catch-up` — свой хвост в папке длиннее локального: догнать и продолжить с `maxSeq + 1`; `fork` — данных нет нигде: новый `deviceId`. */
  action: 'none' | 'catch-up' | 'fork';
  newDeviceId?: string;
}
export interface FolderSyncService {
  /** Запоминает общую папку сегментов в `dataDir/settings/sync.json`; каталог должен существовать. */
  configure(req: FolderSyncConfigureRequest): Promise<{ dir: string }>;
  /** Один раунд: публикация своего хвоста, затем применение чужих сегментов. */
  sync(): Promise<FolderSyncReport>;
  /** Вызывать при старте и после восстановления из бэкапа. */
  checkRestore(): Promise<FolderRestoreResult>;
}

export interface SyncService {
  getState(): Promise<SyncStateDto>;
  exportSince(req?: ExportRequest): Promise<ExportResult>;
  import(entries: LogEntryDto[]): Promise<ImportResult>;
  rebuild(): Promise<RebuildResult>;
  importFromTrane(req: { traneDir: string }): Promise<TraneImportResult>;
  getConflicts(req?: PageRequest): Promise<Page<SyncConflictDto>>;
  resolveConflict(req: ResolveConflictRequest): Promise<ResolveConflictResult>;
  readonly folder: FolderSyncService;
}

export type EngineEvent =
  | { type: 'progress'; unitIds: UnitId[]; at: EpochMs }
  | {
      type: 'library-reloaded';
      revision: string;
      errors: number;
      warnings: number;
    }
  | {
      type: 'library-compiled';
      revision: string;
      artifactWritten: boolean;
      errors: number;
      warnings: number;
    }
  | { type: 'state-rebuilt'; entries: number; ms: number }
  | { type: 'sync-conflict'; conflictIds: string[]; unresolved: number }
  | {
      type: 'remediation-triggered';
      exerciseId: UnitId;
      steps: number;
      at: EpochMs;
    }
  | {
      type: 'settings-changed';
      scope:
        | 'scheduler'
        | 'preferences'
        | 'filters'
        | 'sessions'
        | 'blacklist'
        | 'reviewList'
        | 'ui'
        | 'learning'
        | 'extensions'
        | 'keybindings'
        /** Значения настроек или хранилище расширения; `extensionId` — чьи. */
        | 'extensionValues';
      extensionId?: string;
    }
  | { type: 'extensions-changed' }
  /**
   * Здоровье расширений или состояние хоста расширений изменилось (сбой,
   * активация, приостановка, перезапуск хоста): окно перечитывает
   * `extensions.diagnostics()`.
   */
  | { type: 'extension-health-changed' }
  /**
   * Набор вкладов расширений изменился: движок и хост расширений закончили
   * применять установку, удаление, включение, доверие или правку в режиме
   * разработчика. Окно перечитывает `extensions.contributions()`.
   */
  | { type: 'contributions-changed'; generation: number }
  | {
      type: 'repository-progress';
      id: string;
      phase: RepositoryPhase;
      /** Байты или объекты — по фазе; `total` неизвестен, пока сервер его не сообщил. */
      loaded?: number;
      total?: number;
    };

/** Конфигурация хоста при открытии движка (`createEngine`); через RPC не передаётся и renderer её не меняет. */
export interface EngineConfig {
  libraryRoot: string;
  dataDir: string;
  /** По умолчанию `'full'`: WAL + `synchronous=FULL` + `fullfsync=ON` на macOS (≈ 3 мс на коммит [ИЗМЕРЕНО]); `'normal'` — `NORMAL`, может откатить последние коммиты. */
  durability?: 'full' | 'normal';
  /** Авторский режим: вердикт `failed` содержит `detail` (ожидаемые строки). По умолчанию false. */
  authorMode?: boolean;
  /** Каталог расширений из поставки (read-only). */
  bundledExtensionsDir?: string;
  /** Каталог пользовательских расширений; побеждает при совпадении id. Оба каталога не заданы — вид заданий недоступен. */
  userExtensionsDir?: string;
  /** Каталог разработчика расширений (`DOLPHY_DEV_EXTENSIONS`): корень с наивысшим приоритетом, побеждает пользовательский и поставляемый при совпадении id. */
  devExtensionsDir?: string;
  /** Адрес каталога расширений (рядом лежит `index.v2.json`); не задан — используется официальный. */
  extensionCatalogUrl?: string;
  /**
   * Безопасный режим задан запуском приложения: флагом `--safe-mode` (`'flag'`)
   * или переменной `DOLPHY_SAFE_MODE=1` (`'env'`; флаг сильнее). Настройкой
   * `safeMode` не снимается. Не задан — режим зависит только от настройки.
   */
  forceSafeMode?: SafeModeSource;
  /**
   * Каталог файлового журнала (`dolphy-ГГГГ-ММ-ДД[.N].log`, пишет оболочка
   * приложения). Задан — `extensions.readLogs()` читает его; не задан — журнала
   * нет, `readLogs()` возвращает пустой список.
   */
  logsDir?: string;
  /** Версия приложения; не задана — проверка `minAppVersion` расширений не выполняется. */
  appVersion?: string;
  /**
   * Период проверки расписаний расширений, мс (по умолчанию 30 000). Задаёт
   * только несобранное приложение (`DOLPHY_SCHEDULE_TICK_MS`, e2e).
   */
  scheduleTickMs?: number;
  /**
   * Смещение часов планировщика расписаний относительно системных, мс (может
   * быть отрицательным). Задаёт только несобранное приложение
   * (`DOLPHY_CLOCK_OFFSET_MS`, e2e): время срабатывания не нужно ждать.
   */
  scheduleClockOffsetMs?: number;
}

export interface EngineDiagnosticsDto {
  contractVersion: number;
  engineVersion: string;
  uptimeMs: number;
  entryCount: number;
  dbBytes?: number;
  timings: {
    openLibraryMs: number;
    rebuildMs: number;
    batch: { count: number; p50Ms: number; p95Ms: number };
    recordAttemptP95Ms: number;
  };
  cache: { exerciseHitRatio: number; entries: number };
  dirty: boolean;
}

/** Причина `GIT_FETCH_FAILED` (`details.reason`). */
export type GitFetchFailureReason =
  | 'not-found'
  | 'auth-required'
  | 'ref-not-found'
  | 'timeout'
  | 'network'
  | 'too-large'
  /** Операция прервана `repositories.cancel`. */
  | 'cancelled';

/** Этап `repositories.add` / `repositories.update` (событие `repository-progress`). */
export type RepositoryPhase =
  'resolve' | 'fetch' | 'export' | 'validate' | 'reload';

/** `updating` — идёт операция; `error` — последняя операция отклонена или снимок пропал (`lastError`). */
export type RepositoryStatus = 'ready' | 'updating' | 'error';

/** Git-репозиторий с курсами: снимок коммита лежит в `<libraryRoot>/repositories/<id>`. */
export interface RepositoryDto {
  /** Стабильный slug нормализованного URL. */
  id: string;
  /** Нормализованный URL (`http(s)`, без учётных данных). */
  url: string;
  /** Ветка или тег; `null` — ветка по умолчанию удалённого репозитория. */
  ref: string | null;
  /** Полный SHA-1 загруженного коммита. */
  commit: string;
  fetchedAt: EpochMs;
  status: RepositoryStatus;
  /** Курсы, пришедшие из этого репозитория. */
  courseIds: UnitId[];
  lastError?: EngineErrorDto;
}

export interface AddRepositoryRequest {
  url: string;
  ref?: string;
}

export interface UpdateRepositoryResult {
  /** `false` — коммит на сервере совпал с загруженным, ничего не скачивалось. */
  changed: boolean;
  repository: RepositoryDto;
}

export interface RepositoriesService {
  list(): Promise<RepositoryDto[]>;
  /** `INVALID_ARGUMENT`, `REPOSITORY_EXISTS`, `GIT_FETCH_FAILED`, `REPOSITORY_REJECTED`. */
  add(req: AddRepositoryRequest): Promise<RepositoryDto>;
  /** `NOT_FOUND`, `GIT_FETCH_FAILED`, `REPOSITORY_REJECTED`. */
  update(id: string): Promise<UpdateRepositoryResult>;
  /** Снимок и запись удаляются, журнал не меняется. `NOT_FOUND`. */
  remove(id: string): Promise<void>;
  /** `true`, если операция над репозиторием шла и прервана. */
  cancel(id: string): Promise<boolean>;
}

export type ExtensionOriginDto = 'bundled' | 'user' | 'dev';
export type ExtensionStateDto =
  'loaded' | 'overridden' | 'invalid' | 'disabled';

/** Закрытый список кодов диагностик расширения; интерфейс строит текст по коду и данным. */
export const EXTENSION_DIAGNOSTIC_CODES = [
  'manifest-unreadable',
  'manifest-invalid',
  'id-mismatch',
  'requires-app',
  'unavailable-platform',
  'claim-clash',
  'load-failed',
  'overridden-by',
  'safe-mode',
  'locale.missing-key',
  'locale.invalid-file',
] as const;

export type ExtensionDiagnosticCode =
  (typeof EXTENSION_DIAGNOSTIC_CODES)[number];

/** Значения `data` диагностики: строки, числа и списки строк. */
export type ExtensionDiagnosticValue = string | number | string[];

/**
 * Причина состояния расширения. Данные по кодам:
 * `manifest-unreadable` — `reason`; `manifest-invalid` — `issues` (`путь: сообщение`);
 * `id-mismatch` — `expected`, `actual`; `requires-app` — `minAppVersion`;
 * `unavailable-platform` — `platform`; `claim-clash` — `kind`, `name`, `by`;
 * `load-failed` — `reason`; `overridden-by` — `origin`, `version`; `safe-mode` — без данных;
 * `locale.missing-key` — `key` (ключ `%ключ%` манифеста, которого нет в `locales/en.json`; предупреждение
 * у загруженного расширения); `locale.invalid-file` — `file`, `reason` (файл перевода проигнорирован).
 */
export interface ExtensionDiagnosticDto {
  code: ExtensionDiagnosticCode;
  data: Record<string, ExtensionDiagnosticValue>;
}

export interface ExtensionInfoDto {
  /** Id манифеста; у некорректного расширения — имя каталога. */
  id: string;
  /** `null`, если манифест не удалось прочитать. */
  version: string | null;
  origin: ExtensionOriginDto;
  state: ExtensionStateDto;
  /** Вклады по точкам (id/языки); пусто, если расширение не `loaded`/`overridden`. */
  contributes: ExtensionContributesDto;
  /** Почему некорректно, кем перекрыто; пусто у загруженного и отключённого пользователем. */
  diagnostics: ExtensionDiagnosticDto[];
  /** Возможности, объявленные в манифесте; пусто, если манифест не прочитан. */
  permissions: string[];
  /** Действующий режим кода и интерфейса: расширения из поставки — всегда `trusted`. */
  isolation: 'trusted' | 'isolated';
  /** `false` у расширений из поставки, перекрытых и некорректных: переключатели недоступны. */
  toggleable: boolean;
  /** Название из манифеста; `null` — не задано. */
  name: string | null;
  description: string | null;
  /** GitHub-логин автора из манифеста. */
  author: string | null;
  /** Значок из манифеста как `data:image/png|webp;base64,…`; `null` — значка нет или манифест не прочитан. */
  icon: string | null;
  /** Названия вкладов (`label`/`title` манифеста); `{}` — нет или манифест не прочитан. */
  titles: ContributionTitlesDto;
  /** Таблицы переводов `locales/<язык>.json`; подписи выше — как в манифесте (`%ключ%`), текст подставляет окно (`resolveText`). `{}` — нет файлов или манифест не прочитан. */
  messages: ExtensionMessagesDto;
  /** Явные теги из манифеста; `[]` — нет или манифест не прочитан. */
  tags: string[];
  /** Установлено из каталога; `null` — скопировано вручную, из поставки или из режима разработчика. */
  installed: ExtensionInstallDto | null;
  /** `true` у расширений с origin `user`: их можно удалить. */
  removable: boolean;
  /** Причина отзыва установленной версии в каталоге; `null` — не отозвана. Отозванное расширение в состоянии `disabled`, включить его нельзя. */
  revoked: string | null;
  /**
   * Предупреждение об устаревании, действующее для установленной версии (по последнему известному
   * индексу); `null` — расширение не устарело, скопировано вручную или индекса нет. Накладывает сервис
   * `extensions.list`; это предупреждение, а не отзыв: состояние и политика не меняются.
   */
  deprecated: DeprecationDto | null;
}

/** Альтернатива устаревшему расширению; `name` берётся из индекса каталога. */
export interface DeprecationAlternativeDto {
  id: string;
  /** Название записи каталога; `null` — такой записи в индексе нет. */
  name: string | null;
}

/** Расширение помечено устаревшим в каталоге (`deprecated.json`). */
export interface DeprecationDto {
  /** Диапазон версий, на которые распространяется пометка; `null` — на все. */
  versions: string | null;
  /** Причина, 1–200 символов, на английском. */
  reason: string;
  /** До 3 альтернатив. */
  alternatives: DeprecationAlternativeDto[];
}

/** Метаданные установки из каталога (файл `.dolphy-install.json` в каталоге расширения). */
export interface ExtensionInstallDto {
  catalogUrl: string;
  version: string;
  /** ISO-время установки. */
  installedAt: string;
}

export interface ExtensionContributesDto {
  exerciseTypes: string[];
  themes: string[];
  markdownRenderers: string[];
  gradePolicies: string[];
  /** Id настроек (`contributes.settings`). */
  settings: string[];
  /** Имена событий обучения (`contributes.events`). */
  events: string[];
  /** Id команд (`contributes.commands`). */
  commands: string[];
  /** Id панелей (`contributes.panels`). */
  panels: string[];
  /** Id виджетов (`contributes.widgets`). */
  widgets: string[];
  /** Id расписаний (`contributes.schedules`). */
  schedules: string[];
  /** Id импортёров (`contributes.importers`). */
  importers: string[];
  /** Id экспортёров (`contributes.exporters`). */
  exporters: string[];
}

/** Таблицы переводов расширения (`locales/<язык>.json`): язык → ключ → текст; нет файла — нет языка. */
export type ExtensionMessagesDto = Partial<
  Record<'ru' | 'en', Record<string, string>>
>;

/** Названия вкладов по точкам: `id` → `label`/`title` (у рендереров `id` — язык); точки без названий (события) не входят, у видов заданий и рендереров — только записи с `title`. */
export type ContributionTitlesDto = Partial<
  Record<
    | 'exerciseTypes'
    | 'markdownRenderers'
    | 'themes'
    | 'gradePolicies'
    | 'settings'
    | 'commands'
    | 'panels'
    | 'widgets'
    | 'importers'
    | 'exporters',
    Record<string, string>
  >
>;

/**
 * Привязка команды расширения (`commands[].keybindings`). `mac`/`windows`/`linux`
 * заменяют `key` на своей платформе (`null` — `key`); `when` — условие
 * (`null` — без условия).
 */
export interface ExtensionKeybindingDto {
  key: string;
  mac: string | null;
  windows: string | null;
  linux: string | null;
  when: string | null;
}
/** Команда расширения (`contributes.commands`). */
export interface CommandContributionDto {
  /** Id в пространстве расширения (как у тем). */
  id: string;
  extensionId: string;
  /** Название в палитре; данные расширения, не переводится. */
  title: string;
  description: string | null;
  category: string | null;
  /** Привязка-сокращение вида `Mod+Shift+L` без условия: действующая, как запись `keybindings`; ключи те же, что у `KeybindingEntryDto.key`. */
  keybinding: string | null;
  /** Дополнительные привязки команды (до 4); `[]` — нет. Привязывают только эту команду. */
  keybindings: ExtensionKeybindingDto[];
  /** `false` скрывает команду из палитры: её вызывает только панель. */
  palette: boolean;
  /** Имя значка из закрытого списка `EXTENSION_ICONS` (умолчание `puzzle`); окно рисует свой символ, подпись декоративна. */
  icon: string;
}

/** Панель расширения (`contributes.panels`): экран приложения в изолированной рамке. */
export interface PanelContributionDto {
  id: string;
  extensionId: string;
  /** Название пункта бокового меню и заголовка страницы; данные расширения. */
  title: string;
  /** Имя значка из закрытого списка `EXTENSION_ICONS` (умолчание `puzzle`); окно рисует свой символ, подпись декоративна. */
  icon: string;
  /** `dolphy-ext://<extensionId>/<путь>`. */
  rendererUrl: string;
  /** Панель всегда исполняется в рамке; поле оставлено для единообразия с остальными видами с модулем. */
  isolated: boolean;
  origin: ExtensionOriginDto;
  /** Отпечаток файлов расширения; у расширений из поставки — пустая строка. */
  revision: string;
}

/** Виджет расширения (`contributes.widgets`): карточка в изолированной рамке на экране приложения. */
export interface WidgetContributionDto {
  id: string;
  extensionId: string;
  /** Заголовок карточки и имя рамки; данные расширения (`%ключ%` подставляет окно). */
  title: string;
  /** Место виджета: `dailyPlan` — экран «План дня». */
  slot: 'dailyPlan';
  /** Наименьшая высота рамки, px (80–320). */
  minHeight: number;
  /** Наибольшая высота рамки, px (80–320, не меньше `minHeight`); выше — прокрутка внутри. */
  maxHeight: number;
  /** `dolphy-ext://<extensionId>/<путь>`. */
  rendererUrl: string;
  /** Виджет всегда исполняется в рамке, как панель. */
  isolated: boolean;
  origin: ExtensionOriginDto;
  /** Отпечаток файлов расширения; у расширений из поставки — пустая строка. */
  revision: string;
}

/** Расписание расширения (`contributes.schedules`): когда приложение запускает обработчик `ctx.schedule.on`. */
export interface ScheduleContributionDto {
  id: string;
  extensionId: string;
  /** `daily` — раз в сутки в `at`, `hourly` — в начале каждого часа; по местному времени. */
  every: 'daily' | 'hourly';
  /** `HH:MM` у `daily` (умолчание манифеста — `09:00`); `null` у `hourly`. */
  at: string | null;
}

/** Импортёр расширения (`contributes.importers`): файл пользователя → каталог курса. */
export interface ImporterContributionDto {
  id: string;
  extensionId: string;
  /** Название в палитре и карточке «Библиотеки»; данные расширения. */
  title: string;
  /** Допустимые расширения файла в нижнем регистре (`.csv`), от 1 до 8; фильтр системного диалога. */
  accept: string[];
  /** `text` — обработчик получает файл строкой UTF-8, `bytes` — байтами. */
  input: 'text' | 'bytes';
}

/** Экспортёр расширения (`contributes.exporters`): курс или прогресс → файл пользователя. */
export interface ExporterContributionDto {
  id: string;
  extensionId: string;
  /** Название в палитре и карточке «Библиотеки»; данные расширения. */
  title: string;
  /** `course` — снимок выбранного курса; `progress` — статистика через `ctx.stats` (нужно разрешение `learning.stats`). */
  scope: 'course' | 'progress';
}

/** Что вернул обработчик команды; окно исполняет `notify` и `openPanel` само. */
export type CommandResultDto =
  | { kind: 'none' }
  | { kind: 'notify'; text: string }
  | { kind: 'openPanel'; panelId: string; props?: JsonValue }
  | { kind: 'data'; value: JsonValue };

/** Причина `EXTENSION_COMMAND_FAILED` (`details.reason`). */
export type ExtensionCommandFailureReason =
  | 'unknown-command'
  | 'host-down'
  | 'timeout'
  | 'handler-failed'
  | 'invalid-result'
  | 'disabled'
  | 'replaced'
  | 'activation-timeout';

/** Причина `EXTENSION_TRANSFER_FAILED` (`details.reason`). */
export type ExtensionTransferFailureReason =
  | 'unknown-importer'
  | 'unknown-exporter'
  | 'host-down'
  | 'timeout'
  | 'handler-failed'
  | 'invalid-result'
  | 'disabled'
  | 'replaced';

export interface ThemeContributionDto {
  id: string;
  extensionId: string;
  label: string;
  dark: boolean;
  colors: Record<string, string>;
  variables: Record<string, string | number>;
}

export interface MarkdownRendererDto {
  language: string;
  extensionId: string;
  /** `dolphy-ext://<extensionId>/<путь>`. */
  rendererUrl: string;
  /** Модуль исполняется в изолированной рамке (расширение не из поставки и не доверенное). */
  isolated: boolean;
  /** Откуда расширение: у `dev` окно выводит блоки заново при правке. */
  origin: ExtensionOriginDto;
  /** Отпечаток файлов расширения; у расширений из поставки — пустая строка. */
  revision: string;
}

/** Вид задания расширения: окно по нему видит правку и обновление элемента ввода (R5, R7). */
export interface ExerciseTypeContributionDto {
  type: string;
  extensionId: string;
  /** Тег custom element'а, рисующего ввод ответа. */
  element: string;
  /** `dolphy-ext://<extensionId>/<путь>`. */
  rendererUrl: string;
  /** Расширение не из поставки и не доверенное: элемент ответа исполняется в изолированной рамке. */
  isolated: boolean;
  origin: ExtensionOriginDto;
  /** Отпечаток файлов расширения; у расширений из поставки — пустая строка. */
  revision: string;
}

export interface GradePolicyInfoDto {
  id: string;
  /** `null` у встроенного правила. */
  extensionId: string | null;
  /** `null` у встроенного правила: название переводит окно. */
  label: string | null;
}

export interface ContributionsDto {
  /**
   * Поколение набора вкладов: растёт при каждом применении расширений и равно
   * `generation` последнего события `contributions-changed`. Ответ с меньшим
   * поколением, чем уже виденное в событии, устарел. Отсчёт начинается заново
   * при каждом запуске движка.
   */
  generation: number;
  exerciseTypes: ExerciseTypeContributionDto[];
  themes: ThemeContributionDto[];
  markdownRenderers: MarkdownRendererDto[];
  gradePolicies: GradePolicyInfoDto[];
  /** Определения настроек включённых расширений. */
  settings: ExtensionSettingDefDto[];
  /** Команды включённых расширений. */
  commands: CommandContributionDto[];
  /** Панели включённых расширений. */
  panels: PanelContributionDto[];
  /** Виджеты включённых расширений. */
  widgets: WidgetContributionDto[];
  /** Расписания включённых расширений. */
  schedules: ScheduleContributionDto[];
  /** Импортёры включённых расширений. */
  importers: ImporterContributionDto[];
  /** Экспортёры включённых расширений. */
  exporters: ExporterContributionDto[];
  /** Таблицы переводов включённых расширений по id; расширения без файлов перевода не перечислены. Подписи вкладов приходят как в манифесте (`%ключ%`). */
  messages: Record<string, ExtensionMessagesDto>;
}

interface ExtensionSettingBaseDto {
  /** Равен id расширения или начинается с `<id расширения>.`. */
  id: string;
  extensionId: string;
  /** Подпись поля в диалоге настроек; данные расширения, не переводится. */
  label: string;
  description: string | null;
  /** Заголовок раздела формы; `null` — настройка в первом разделе без заголовка. */
  group: string | null;
  /** Ключ сортировки формы, целое 0–1000; при равных — порядок объявления. */
  order: number;
  /** Поле скрыто, пока значение настройки `setting` (того же расширения, не `list`) не равно `equals`; скрытое значение сохраняется. `null` — поле видно всегда. */
  visibleWhen: SettingVisibleWhenDto | null;
}

/** Условие показа поля формы настроек. */
export interface SettingVisibleWhenDto {
  setting: string;
  equals: boolean | string | number;
}

export interface BooleanSettingDefDto extends ExtensionSettingBaseDto {
  type: 'boolean';
  default: boolean;
}

export interface StringSettingDefDto extends ExtensionSettingBaseDto {
  type: 'string';
  default: string;
  /** Длина в кодовых единицах UTF-16; `null` — без ограничения. */
  maxLength: number | null;
}

/** Многострочная строка. */
export interface TextSettingDefDto extends ExtensionSettingBaseDto {
  type: 'text';
  default: string;
  /** Длина в кодовых единицах UTF-16; `null` — до 10 000. */
  maxLength: number | null;
}

/** Цвет `#rrggbb`; значение хранится в нижнем регистре. */
export interface ColorSettingDefDto extends ExtensionSettingBaseDto {
  type: 'color';
  default: string;
}

/** Список строк. */
export interface ListSettingDefDto extends ExtensionSettingBaseDto {
  type: 'list';
  default: string[];
  /** Наибольшее число элементов, 1–50. */
  maxItems: number;
  /** Наибольшая длина элемента в кодовых единицах UTF-16, 1–200. */
  itemMaxLength: number;
}

export interface NumberSettingDefDto extends ExtensionSettingBaseDto {
  type: 'number';
  default: number;
  min: number | null;
  max: number | null;
  integer: boolean;
}

export interface EnumSettingOptionDto {
  value: string;
  label: string;
}

export interface EnumSettingDefDto extends ExtensionSettingBaseDto {
  type: 'enum';
  default: string;
  options: EnumSettingOptionDto[];
}

/** Настройка расширения, которую пользователь меняет в «Настройки → Расширения». */
export type ExtensionSettingDefDto =
  | BooleanSettingDefDto
  | StringSettingDefDto
  | TextSettingDefDto
  | ColorSettingDefDto
  | ListSettingDefDto
  | NumberSettingDefDto
  | EnumSettingDefDto;

/** Действующие значения настроек расширения: по `id` каждого определения; сохранённое или `default`. */
export type ExtensionSettingValuesDto = Record<string, JsonValue>;

/** Занятое место данных расширения (хранилище кода, значения настроек и секреты считаются отдельно; у секретов байты — шифртекст). */
export interface ExtensionDataUsageDto {
  storage: { keys: number; bytes: number };
  settings: { keys: number; bytes: number };
  secrets: { keys: number; bytes: number };
}

/** События обучения, которые движок отдаёт расширениям с разрешением `learning.events`. Не входят в `EngineEvent`: окно их не видит. */
export const LEARNING_EVENT_NAMES = [
  'session.started',
  'session.finished',
  'attempt.closed',
] as const;

export type LearningEventName = (typeof LEARNING_EVENT_NAMES)[number];

/** Итог закрытой попытки: `self-assessed` — оценку поставил ученик. */
export type AttemptOutcome = 'passed' | 'failed' | 'gave-up' | 'self-assessed';

/** Поля событий: только идентификаторы, оценка и время — ответы, `spec`, обратная связь и текст упражнения в них не попадают. */
export interface LearningEventPayloads {
  'session.started': { sessionId: string; at: EpochMs };
  'session.finished': { sessionId: string; at: EpochMs };
  'attempt.closed': {
    exerciseId: UnitId;
    courseId: UnitId;
    lessonId: UnitId;
    grade: Grade;
    outcome: AttemptOutcome;
    source: AttemptSource;
    at: EpochMs;
  };
}

export type LearningEvent = {
  [N in LearningEventName]: { name: N; payload: LearningEventPayloads[N] };
}[LearningEventName];

/** Значение настройки расширения изменилось (пользователь, сброс, очистка данных); `value` — действующее. */
export interface ExtensionSettingChangeDto {
  extensionId: string;
  id: string;
  value: JsonValue;
}

/** Допустимый вид id расширения (как в манифесте). */
export const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

/** Чем безопасный режим задан при запуске: флагом `--safe-mode` или переменной `DOLPHY_SAFE_MODE`. */
export type SafeModeSource = 'flag' | 'env';

/** Настройки расширений; хранятся вместе с остальными настройками в `engine.db`. */
export interface ExtensionSettingsDto {
  /** Отключённые расширения (по id), отсортированы, без повторов. */
  disabled: string[];
  /** Доверенные расширения (исполняются без изоляции), отсортированы, без повторов. */
  trusted: string[];
  /** Проверять обновления расширений из каталога при запуске. По умолчанию включено. */
  checkUpdates: boolean;
  /**
   * Безопасный режим: расширения не из поставки отключены (диагностика
   * `safe-mode`), их код не запускается. Расширения из поставки работают.
   * По умолчанию выключено. Флаг запуска включает режим независимо от настройки.
   */
  safeMode: boolean;
  /**
   * Расширения с выключенными системными уведомлениями (по id), отсортированы,
   * без повторов: `ctx.notifications.show` у них даёт `false`. По умолчанию
   * пусто (уведомления включены).
   */
  notificationsOff: string[];
  /**
   * Расширения с выключенными расписаниями (по id), отсортированы, без
   * повторов: их `ctx.schedule.on` не срабатывает. По умолчанию пусто
   * (расписания включены).
   */
  schedulesOff: string[];
}

/** Состояние процесса хоста расширений: `gave-up` — после повторных сбоев перезапуск прекращён до `restartHost()`. */
export type ExtensionHostStatusDto = 'running' | 'restarting' | 'gave-up';

/** Сбой расширения; `reason` — причина (`handler-failed`, `timeout`, `invalid-result`, `activation-failed`), `message` — текст сбоя. */
export interface ExtensionFailureDto {
  at: EpochMs;
  reason: string;
  message: string;
}

/** Здоровье одного расширения с запуска приложения (в памяти, не сохраняется; сбрасывается при смене файлов расширения). */
export interface ExtensionHealthDto {
  id: string;
  /** Сбоев команд, событий и видов заданий. Убийства процесса и приостановка — состояние, а не сбой. */
  failures: number;
  lastFailure: ExtensionFailureDto | null;
  /** Длительность последней успешной активации; `null` — расширение не активировалось. */
  lastActivationMs: number | null;
  /** Ограниченный процесс приостановлен за цикл падений до этого времени; `null` — не приостановлен. */
  suppressedUntil: EpochMs | null;
}

/** Безопасный режим: `active` = `persisted` или `forcedBy !== null`. */
export interface SafeModeStatusDto {
  active: boolean;
  /** Значение настройки `safeMode`. */
  persisted: boolean;
  forcedBy: SafeModeSource | null;
}

/** Уровни записи журнала от подробного к важному. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevelDto = (typeof LOG_LEVELS)[number];

/** Предел `limit` у `extensions.readLogs`. */
export const MAX_LOG_ENTRIES = 500 as const;

/** Запись файлового журнала. */
export interface ExtensionLogEntryDto {
  at: EpochMs;
  level: LogLevelDto;
  /** Кто написал: `main`, `engine` или `ext-host`. */
  source: string;
  message: string;
  /** Расширение, к которому относится запись; `null` — запись самого приложения. */
  extensionId: string | null;
  /** Остальные поля записи одной JSON-строкой (обрезаются до 4096 знаков); `null` — полей нет. */
  details: string | null;
}

/** Параметры `extensions.readLogs`. */
export interface ReadLogsOptions {
  /** Только записи этого расширения. */
  extensionId?: string;
  /** Записи не ниже этого уровня; по умолчанию все. */
  minLevel?: LogLevelDto;
  /** Сколько последних записей вернуть, 1…`MAX_LOG_ENTRIES`; по умолчанию `MAX_LOG_ENTRIES`. */
  limit?: number;
}

export interface ExtensionsDiagnosticsDto {
  host: ExtensionHostStatusDto;
  safeMode: SafeModeStatusDto;
  /** Запись для каждого расширения из `list()` (у не сбоивших — нули). */
  extensions: ExtensionHealthDto[];
}

export interface ExtensionsService {
  list(): Promise<ExtensionInfoDto[]>;
  getSettings(): Promise<ExtensionSettingsDto>;
  /** `NOT_FOUND` — нет такого расширения; `INVALID_ARGUMENT` `{reason:'bundled'}` — расширение из поставки. */
  setEnabled(id: string, enabled: boolean): Promise<ExtensionSettingsDto>;
  setTrusted(id: string, trusted: boolean): Promise<ExtensionSettingsDto>;
  /**
   * Включает и выключает системные уведомления расширения (`notificationsOff`);
   * не перезапускает расширение. `NOT_FOUND` — нет такого расширения;
   * `INVALID_ARGUMENT` `{reason:'bundled'}` — расширение из поставки не
   * настраивается; не булево значение — `INVALID_ARGUMENT`.
   */
  setNotificationsEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ExtensionSettingsDto>;
  /**
   * Включает и выключает расписания расширения (`schedulesOff`); не
   * перезапускает расширение. `NOT_FOUND` — нет такого расширения;
   * `INVALID_ARGUMENT` `{reason:'bundled'}` — расширение из поставки не
   * настраивается; не булево значение — `INVALID_ARGUMENT`.
   */
  setSchedulesEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ExtensionSettingsDto>;
  /** Вклады загруженных расширений для окна (только чтение). */
  contributions(): Promise<ContributionsDto>;
  /**
   * Каталог расширений. `refresh` — запросить индекс у сервера (иначе — кэш,
   * если он свежий). Нет сети: последний кэш и `stale: true`; кэша нет —
   * `CATALOG_UNAVAILABLE`.
   */
  catalog(options?: { refresh?: boolean }): Promise<CatalogDto>;
  /**
   * Устанавливает (или обновляет) расширение из каталога; `version` — точная
   * версия, иначе новейшая совместимая. `NOT_FOUND` — нет в каталоге;
   * `EXTENSION_INSTALL_FAILED` с `details.reason`:
   * `incompatible` | `network` | `integrity` | `limits` | `invalid` | `conflict`.
   * Установленное действует сразу: перед ответом движок и хост расширений
   * применили набор, окно получило событие `contributions-changed`.
   */
  install(id: string, version?: string): Promise<InstallResultDto>;
  /**
   * Удаляет расширение с origin `user`. `removeData` — удалить и данные
   * расширения (по умолчанию остаются). `NOT_FOUND`; `INVALID_ARGUMENT`
   * `{reason:'not-removable'}`.
   */
  uninstall(id: string, options?: { removeData?: boolean }): Promise<void>;
  /** Доступные обновления установленных из каталога расширений (по последнему известному индексу). */
  updates(): Promise<ExtensionUpdateDto[]>;
  /**
   * README и журнал изменений. Без `version` — установленной версии (из каталога расширения, без сети),
   * у не установленного — новейшей показанной версии каталога; с `version` — этой версии (установленной
   * или из каталога; файлы каталога проверяются по размеру и `sha256` и кэшируются на диске).
   * `NOT_FOUND` — нет такого расширения или версии; `EXTENSION_INSTALL_FAILED`
   * (`details.reason` `network` | `integrity` | `limits`) — файл недоступен; `CATALOG_UNAVAILABLE` — индекса нет.
   */
  docs(id: string, options?: { version?: string }): Promise<ExtensionDocsDto>;
  /**
   * Картинка README как `data:image/png|webp|jpeg;base64,…`: файл `png`/`webp`/`jpg`/`jpeg` до 256 КиБ из
   * файлов этой версии. `NOT_FOUND` — расширения, версии или файла нет; `INVALID_ARGUMENT` — путь,
   * тип или размер недопустимы.
   */
  docImage(id: string, version: string, path: string): Promise<string>;
  setCheckUpdates(enabled: boolean): Promise<ExtensionSettingsDto>;
  /**
   * Включает и выключает безопасный режим (настройка `safeMode`); действует
   * сразу, без перезапуска. Не булево значение — `INVALID_ARGUMENT`.
   */
  setSafeMode(enabled: boolean): Promise<ExtensionSettingsDto>;
  /** Здоровье расширений, состояние хоста расширений и безопасного режима. */
  diagnostics(): Promise<ExtensionsDiagnosticsDto>;
  /**
   * Запускает хост расширений заново, сбрасывает счётчик его падений (после
   * `gave-up` вернуть расширениям работу без перезапуска приложения).
   */
  restartHost(): Promise<void>;
  /**
   * Последние записи файлового журнала, самые новые последними. Читаются все
   * файлы журнала от новых к старым; нечитаемые строки пропускаются. Неверные
   * `limit`, `minLevel` или `extensionId` — `INVALID_ARGUMENT`.
   */
  readLogs(options?: ReadLogsOptions): Promise<ExtensionLogEntryDto[]>;
  /**
   * Действующие значения настроек расширения (определения — в
   * `contributions().settings`). `NOT_FOUND` — расширения нет;
   * `INVALID_ARGUMENT` `{reason:'disabled'}` — расширение отключено.
   */
  getSettingValues(id: string): Promise<ExtensionSettingValuesDto>;
  /**
   * Меняет одно значение; проверяет тип, границы, формат цвета, размер списка и `options` по определению; цвет сохраняется в нижнем регистре.
   * Неизвестный `settingId` и неверное значение — `INVALID_ARGUMENT`
   * (`details.reason`: `unknown-setting` | `type` | `range` | `integer` |
   * `max-length` | `option` | `format` | `max-items`). Расширение и окно узнают об изменении без перезапуска.
   */
  setSettingValue(
    id: string,
    settingId: string,
    value: JsonValue,
  ): Promise<ExtensionSettingValuesDto>;
  /** Возвращает значения по умолчанию (удаляет сохранённые). */
  resetSettingValues(id: string): Promise<ExtensionSettingValuesDto>;
  /** Сколько места занимают данные расширения; работает и для удалённого расширения, чьи данные остались. */
  dataUsage(id: string): Promise<ExtensionDataUsageDto>;
  /** Стирает хранилище и значения настроек; работающее расширение видит пустое хранилище и значения по умолчанию. */
  clearData(id: string): Promise<void>;
  /**
   * Выполняет объявленную команду расширения (код расширения; первый вызов
   * лениво его активирует). Вызов не занимает очередь команд движка.
   * `INVALID_ARGUMENT` — неверный `extensionId`/`commandId` или аргументы длиннее
   * `MAX_ANSWER_CHARS` (`details.reason`: `args-too-large`). Всё остальное —
   * `EXTENSION_COMMAND_FAILED` с `details` `{ extensionId, commandId, reason }`
   * (`ExtensionCommandFailureReason`): расширения или объявленной команды нет —
   * `unknown-command`, расширение отключено — `disabled`, `timeout` и
   * `host-down` допускают повтор.
   */
  invokeCommand(
    extensionId: string,
    commandId: string,
    args?: JsonValue,
  ): Promise<CommandResultDto>;
}

export type CatalogStatusDto =
  'available' | 'installed' | 'update' | 'incompatible';

export interface CatalogVersionDto {
  version: string;
  permissions: string[];
  /** ISO-время публикации. */
  publishedAt: string;
  /** Суммарный размер файлов, байты. */
  size: number;
  minAppVersion: string | null;
}

/** Версия в списке версий записи каталога (не больше 5, новейшие первыми). */
export interface CatalogListedVersionDto extends CatalogVersionDto {
  /** `true` — версию можно установить на этом приложении и платформе. */
  compatible: boolean;
  /** Почему нельзя установить; `null` у совместимой. */
  incompatible: {
    reason: CatalogIncompatibleDto['reason'];
    detail: string;
  } | null;
  /** В версии есть `CHANGELOG.md`. */
  hasChangelog: boolean;
}

export interface CatalogIncompatibleDto {
  reason: 'platform' | 'api' | 'app' | 'revoked';
  /** Человекочитаемая причина на английском (`requires app >= 1.2.0`). */
  detail: string;
  /** Ближайшая более старая совместимая версия; `null` — нет. */
  fallback: CatalogVersionDto | null;
}

export interface CatalogEntryDto {
  id: string;
  name: string;
  description: string;
  author: string;
  /** Адрес исходников (страница в репозитории каталога). */
  source: string;
  platforms: string[];
  contributes: ExtensionContributesDto;
  /** Значок показанной версии как `data:image/png|webp;base64,…`; `null` — значка нет (или каталог старого формата). */
  icon: string | null;
  /** Названия вкладов из записи индекса (`titles`); `{}` — нет (или каталог старого формата). */
  titles: ContributionTitlesDto;
  /** Теги показанной версии из записи индекса; `[]` — нет. */
  tags: string[];
  status: CatalogStatusDto;
  /** Версия, установленная из каталога; `null` — не установлено (или скопировано вручную). */
  installedVersion: string | null;
  /** Версия, которая будет установлена (новейшая совместимая); `null` у несовместимых. */
  latest: CatalogVersionDto | null;
  incompatible: CatalogIncompatibleDto | null;
  /** Версии записи индекса (до 5, новейшие первыми). */
  versions: CatalogListedVersionDto[];
  /** Пометка «устарело», действующая для показанной версии (`latest`, у несовместимых — новейшая); `null` — нет. */
  deprecated: DeprecationDto | null;
  /**
   * `true` — расширение с этим id уже есть, но установлено не из этого каталога (скопировано вручную,
   * из режима разработчика, из поставки или из другого каталога): установка невозможна без удаления прежнего.
   */
  elsewhere: boolean;
}

export interface CatalogDto {
  entries: CatalogEntryDto[];
  /** ISO-время получения индекса; `null` — индекса нет. */
  fetchedAt: string | null;
  /** Показан кэш, потому что свежий индекс получить не удалось. */
  stale: boolean;
  /** Причина, по которой не удалось обновить индекс; `null` — без ошибок. */
  error: string | null;
}

export interface ExtensionUpdateDto {
  id: string;
  name: string;
  installed: string;
  available: CatalogVersionDto;
}

/** Описание расширения: README и журнал изменений одной версии. */
export interface ExtensionDocsDto {
  /** Версия, к которой относятся тексты. */
  version: string;
  /** Содержимое `README.md` (первые 64 КиБ); `null` — файла нет. */
  readme: string | null;
  /** Содержимое `CHANGELOG.md` версии; `null` — файла нет. */
  changelog: string | null;
  /** Любой из текстов обрезан до 64 КиБ. */
  truncated: boolean;
  /**
   * Откуда тексты: `installed` — каталог установленного расширения; `catalog` — каталог (скачаны или
   * уже лежали в дисковом кэше); `cache` — дисковый кэш, потому что до каталога не дозвониться (индекс устарел).
   */
  source: 'installed' | 'catalog' | 'cache';
}

export interface InstallResultDto {
  id: string;
  version: string;
  /** Прежняя версия из каталога; `null` — новая установка. */
  previousVersion: string | null;
}

export interface LearningEngine {
  readonly library: LibraryService;
  readonly repositories: RepositoriesService;
  readonly practice: PracticeService;
  readonly curation: CurationService;
  readonly settings: SettingsService;
  readonly sync: SyncService;
  readonly plan: PlanService;
  readonly placement: PlacementService;
  readonly remediation: RemediationService;
  readonly extensions: ExtensionsService;
  diagnostics(): Promise<EngineDiagnosticsDto>;
  /** In-process. По RPC — сообщения `events.subscribe` / `events.unsubscribe` и push `EngineEvent`. */
  subscribe(listener: (event: EngineEvent) => void): () => void;
  close(): Promise<void>;
}

export interface RpcRequest {
  id: string;
  method: string;
  params?: unknown;
}
export type RpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: EngineErrorDto };
export interface RpcPush {
  event: EngineEvent;
}

export * from './rpc.ts';
