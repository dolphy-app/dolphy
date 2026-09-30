/**
 * Контекст движка (Context из engine-ts-electron.md §4): единственный объект,
 * который сервисы получают в `createXService(ctx)`. Здесь — интерфейсы; их
 * собирает `createContext` (`create-context.ts`). Сервисы вызывают друг друга
 * через `ctx`, а не через обёрнутый фасад.
 */
import type {
  DueItemDto,
  EngineConfig,
  EngineEvent,
  EpochMs,
  FrontierItemDto,
  RecordResultDto,
  RemediationDto,
  SavedFilterDto,
  UnitId,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import type { LibraryHolder } from '../authoring/library-holder.ts';
import type { AttemptEntry, LogEntry } from '../domain/journal.ts';
import type { Library } from '../domain/library.ts';
import type {
  AppendResult,
  Clock,
  CourseSource,
  EventStore,
  IdGenerator,
  Logger,
  MemoryModel,
  Rng,
  SettingsStore,
  GitSnapshotFetcher,
  RepositoryStore,
  SnapshotInstaller,
} from '../ports/index.ts';
import type { ExerciseTypes } from '../ports/exercise-types.ts';
import type { GradePolicies } from '../ports/grade-policies.ts';
import type { ExtensionInstaller } from '../ports/extension-installer.ts';
import type { ExtensionPolicy } from '../ports/extension-policy.ts';
import type { ExtensionRegistry } from '../ports/extension-registry.ts';
import type { FsrsScorer } from '../scoring/fsrs-scorer.ts';
import type {
  AttemptSource,
  RewardSource,
  UnitScorer,
} from '../scoring/unit-scorer.ts';
import type { BlacklistView } from '../scoring/graph.ts';
import type { DepthFirstScheduler } from '../scheduler/depth-first-scheduler.ts';
import type { AttemptCatalog, MemorySource } from '../scheduler/due.ts';
import type { ReviewListView } from '../scheduler/data.ts';
import type { SchedulerOptionsHolder } from '../scheduler/options.ts';
import type { SessionState } from '../scheduler/session-state.ts';
import type { FolderSync, FolderSyncOptions } from '../node/folder-sync.ts';
import type { Replica } from '../sync/replica.ts';
import type { TraneSource } from '../sync/trane-import.ts';
import type { EngineState, FacadeContext } from './context-types.ts';
import type { EventBus } from './event-bus.ts';
import type { ExpiringMap } from './expiring-map.ts';
import type { EntryFields, JournalWriter } from './journal-writer.ts';

export type { LibraryHolder } from '../authoring/library-holder.ts';

/* ------------------------------ зависимости ------------------------------ */

/**
 * Порт общей папки синхронизации. Реализация — `nodeFolderSyncPort(config)`
 * (`@dolphy-app/engine/node`): `dataDir/settings/sync.json` и `createFolderSync`.
 * Ядро `app/` от `node:fs` не зависит.
 */
export interface FolderSyncPort {
  /** Запомненная папка из `dataDir/settings/sync.json`; `null` — не настроена. */
  load(): Promise<string | null>;
  /**
   * Проверяет каталог (существует, не `dataDir` и не каталог БД — иначе
   * `INVALID_ARGUMENT`) и запоминает его атомарной записью.
   */
  save(dir: string): Promise<void>;
  open(options: FolderSyncOptions): FolderSync;
}

export interface EngineDeps {
  clock: Clock;
  rng: Rng;
  ids: IdGenerator;
  logger: Logger;
  courseSource: CourseSource;
  eventStore: EventStore;
  settings: SettingsStore;
  memoryModel: MemoryModel;
  /** Виды заданий из расширений (`@dolphy-app/extension-host`). */
  exerciseTypes: ExerciseTypes;
  /** Правила оценки из расширений (`@dolphy-app/extension-host`). */
  gradePolicies: GradePolicies;
  /** Обзор расширений для `extensions.list`. */
  extensionRegistry: ExtensionRegistry;
  /** Политика расширений (включено / изолировано); тот же экземпляр, что у реестра и клиентов хоста. */
  extensionPolicy: ExtensionPolicy;
  /** Установка расширений из каталога (`@dolphy-app/extension-install`). */
  extensionInstaller: ExtensionInstaller;
  /** Нет порта — `sync.folder.*` отвечает `SYNC_FOLDER_NOT_CONFIGURED`. */
  folderSync?: FolderSyncPort;
  /** Чтение каталога `.trane` (`readTraneDirectory` из `@dolphy-app/engine-sqlite`); нет — `importFromTrane` отказывает. */
  openTraneSource?: (traneDir: string) => TraneSource | Promise<TraneSource>;
  /** Реестр git-репозиториев (`repositories.*`); SQLite или память. */
  repositoryStore: RepositoryStore;
  /** Получение снимков по `http(s)`; `createIsomorphicGitFetcher` из `@dolphy-app/engine-git`. */
  snapshotFetcher: GitSnapshotFetcher;
  /** Подмена каталогов снимков; `createNodeSnapshotInstaller` из `@dolphy-app/engine/node`. */
  snapshotInstaller: SnapshotInstaller;
}

/* -------------------------------- проекции -------------------------------- */

/** Ключ порядка журнала `(at, deviceId, seq)`; при равенстве — `id`. */
export type EntryKey = Pick<LogEntry, 'at' | 'deviceId' | 'seq' | 'id'>;

/** Компактная запись попытки в `AttemptIndex`. */
export interface AttemptRecord extends EntryKey {
  readonly exerciseId: UnitId;
  readonly grade: AttemptEntry['grade'];
  readonly source: AttemptEntry['source'];
}

/**
 * Попытки по упражнениям (engine-ts.md §5.2). Хранит все записи попыток в
 * порядке ключа; «неотменённые» — с ключом строго больше самого позднего
 * `progress_reset` упражнения, его урока или курса (границы считаются при
 * чтении по графу текущей библиотеки). Применение записей идемпотентно и
 * не зависит от порядка прихода.
 */
export interface AttemptIndex extends AttemptCatalog {
  /** Новая запись попытки; `false` — запись с таким `id` уже применена. */
  applyAttempt(entry: AttemptEntry): boolean;
  /** Сброс прогресса; `false` — запись с таким `id` уже применена. */
  applyReset(unitId: UnitId, key: EntryKey): boolean;
  /** Не более `limit` новейших неотменённых попыток, от новых к старым. */
  getTrials: AttemptSource['getTrials'];
  /** Неотменённые попытки, от новых к старым. */
  getRecords(exerciseId: UnitId): readonly AttemptRecord[];
  /** Число неотменённых попыток упражнения. */
  count(exerciseId: UnitId): number;
  /** Ключ самого свежего сброса, покрывающего упражнение; `null` — сбросов нет. */
  cutOf(exerciseId: UnitId): EntryKey | null;
  /** Все неотменённые попытки всех упражнений по возрастанию ключа. */
  allInOrder(): AttemptRecord[];
  /** Запоминает юнит из записи флага (для `W_ORPHAN_EVENTS`). */
  noteUnit(unitId: UnitId): void;
  /** Все идентификаторы юнитов, встреченные в применённых записях (попытки, флаги, сбросы). */
  seenUnitIds(): Iterable<UnitId>;
  clear(): void;
}

export interface FlagState extends BlacklistView, ReviewListView {
  /** LWW по ключу; `false` — запись с таким `id` уже применена. */
  apply(entry: Extract<LogEntry, { kind: 'unit_flag' }>): boolean;
  has(flag: 'blacklist' | 'review', unitId: UnitId): boolean;
  /** Юниты во флаге по порядку добавления (ключ победившей записи `set`). */
  list(flag: 'blacklist' | 'review'): readonly UnitId[];
  clear(): void;
}

/** Награды по графу: производная проекция от неотменённых попыток и графа. */
export interface RewardProjection extends RewardSource {
  clear(): void;
}

/** Попытка в порядке ключа для `MemoryIndex`. */
export type EffectiveAttempt = AttemptRecord;

/**
 * Состояние памяти упражнений `{S, D, lastAt}` (engine-ts.md §5.2). Реализует
 * M6 (`planning/memory-index.ts`); без неявного повтора — реплей окна попыток
 * (`createReplayMemorySource` из планировщика). Состояние — функция множества
 * неотменённых попыток, поэтому `rebuild` дороже, но всегда достаточен.
 */
export interface MemoryIndex extends MemorySource {
  /** Полная пересборка: неотменённые попытки всех упражнений по возрастанию ключа. */
  rebuild(attempts: readonly EffectiveAttempt[], library: Library | null): void;
  /**
   * Одна попытка, чей ключ больше всех уже применённых (быстрый путь);
   * порядок иначе или сброс — вызывающий делает `rebuild`.
   */
  apply(attempt: EffectiveAttempt, library: Library | null): void;
  clear(): void;
}

/**
 * Ремедиация (engine-ts.md §6a.5): проекция журнала, событий не пишет.
 * Триггер — `remediation.failThreshold` неудач подряд (оценка ≤ 2) на
 * неотменённых попытках упражнения; план (шаги, упражнения шагов) — чистая
 * функция журнала и графа на момент триггера; `done` — успехи после триггера.
 */
export interface RemediationTracker {
  /** `active: false` и пустые `steps`, если триггера нет. */
  getPlan(exerciseId: UnitId): RemediationDto;
  /** Активные планы по убыванию `triggeredAt`, при равенстве — по `exerciseId`. */
  activePlans(): readonly RemediationDto[];
  /**
   * Упражнения невыполненных шагов активных планов без повторов (порядок:
   * планы по `activePlans()`, шаги по порядку), не более `limit`
   * (по умолчанию `remediation.maxItems`).
   */
  pendingExerciseIds(limit?: number): UnitId[];
  /**
   * План, если порог пересечён именно этой (только что применённой) попыткой:
   * число неудач подряд после неё равно `failThreshold`; иначе `null`.
   */
  onAttempt(entry: AttemptEntry): RemediationDto | null;
  /** Кэш планов устарел (новые записи, смена библиотеки или опций). */
  invalidate(): void;
}

export interface Projections {
  readonly attempts: AttemptIndex;
  readonly rewards: RewardProjection;
  readonly flags: FlagState;
  /** Обёртка: перед чтением досчитывает устаревшие производные проекции. */
  readonly memory: MemorySource;
  readonly remediation: RemediationTracker;
  /**
   * Применяет запись к проекциям в любом порядке, идемпотентно по `id`.
   * Быстрый путь — запись новее всех примененных; иначе производные
   * проекции (награды, память, ремедиация) досчитываются при чтении.
   * Возвращает юниты, чьи оценки могли измениться (упражнение, урок, курс и
   * награждённые юниты); пусто — запись уже была применена.
   */
  apply(entry: LogEntry): UnitId[];
  /** Очищает всё и складывает записи в порядке журнала; возвращает их число. */
  rebuildFrom(entries: AsyncIterable<LogEntry>): Promise<number>;
  /** Смена библиотеки, опций или настроек: награды, память и ремедиация досчитаются при чтении. */
  invalidateDerived(): void;
  /** Производные проекции помечены устаревшими и ещё не досчитаны: кэши оценок надо сбросить целиком. */
  isStale(): boolean;
  clear(): void;
}

/* --------------------------------- попытки -------------------------------- */

/** Открытая попытка с проверкой (`beginAttempt` → `submitAnswer`* → `completeAttempt`). */
export interface OpenAttempt {
  readonly attemptId: string;
  readonly exerciseId: UnitId;
  readonly verifiable: boolean;
  readonly startedAt: EpochMs;
  /** Только `passed`/`failed`: `error` в счёт и оценку не входит. */
  readonly verdicts: VerdictDto[];
  /** Идёт `submitAnswer`: критическая секция вокруг `await`. */
  busy: boolean;
  /** Итог `completeAttempt`; повтор возвращает его с `duplicate: true`. */
  result: RecordResultDto | null;
}

/* ------------------------------- запись журнала --------------------------- */

/** Одна запись, которую нужно внести в журнал. */
export interface CommitInput {
  fields: EntryFields;
  /** `requestId`; по умолчанию uuidv7. */
  id?: string;
  /** Запрошенное время; по умолчанию `now`. */
  at?: EpochMs;
}

export interface CommitResult extends AppendResult {
  /** Юниты, чьи оценки изменились (упражнение, урок, курс, награждённые); только для `appended`. */
  affectedUnitIds: UnitId[];
}

/** Запись сервисных метрик для `diagnostics()`. */
export interface EngineMetrics {
  readonly startedAt: EpochMs;
  openLibraryMs: number;
  rebuildMs: number;
  record(name: 'batch' | 'recordAttempt', ms: number): void;
  /** p50/p95 по последним замерам; нули, если замеров нет. */
  percentiles(name: 'batch' | 'recordAttempt'): {
    count: number;
    p50Ms: number;
    p95Ms: number;
  };
}

/* --------------------------------- контекст ------------------------------- */

export interface EngineContext extends FacadeContext {
  readonly config: EngineConfig;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly rng: Rng;
  readonly logger: Logger;
  readonly eventStore: EventStore;
  readonly courseSource: CourseSource;
  readonly settings: SettingsStore;
  readonly memoryModel: MemoryModel;
  readonly exerciseTypes: ExerciseTypes;
  readonly extensionRegistry: ExtensionRegistry;
  readonly extensionPolicy: ExtensionPolicy;
  readonly extensionInstaller: ExtensionInstaller;
  readonly folderSync: FolderSyncPort | null;
  readonly openTraneSource: EngineDeps['openTraneSource'];
  readonly repositoryStore: RepositoryStore;
  readonly snapshotFetcher: GitSnapshotFetcher;
  readonly snapshotInstaller: SnapshotInstaller;
  /** `current()` / `require()` / `swap()` — атомарная подмена. */
  readonly library: LibraryHolder;
  readonly projections: Projections;
  readonly replica: Replica;
  /** Единый источник опций планировщика, ремедиации и плана. */
  readonly options: SchedulerOptionsHolder;
  readonly session: SessionState;
  readonly fsrs: FsrsScorer;
  readonly scorer: UnitScorer;
  readonly scheduler: DepthFirstScheduler;
  /** Сохранённые фильтры в памяти (для планировщика: чтение синхронное). */
  readonly savedFilters: Map<string, SavedFilterDto>;
  readonly attempts: ExpiringMap<OpenAttempt>;
  readonly gradePolicies: GradePolicies;
  /** Настройки обучения в памяти (читаются при каждом закрытии попытки); пишет только `settings.setLearning`. */
  readonly learning: { gradePolicy: string };
  readonly journal: JournalWriter;
  readonly bus: EventBus;
  readonly state: EngineState;
  readonly metrics: EngineMetrics;
  /** Оценки и извлекаемость для `getFrontier` (без учёта `maxLessonsInProgress`). */
  getFrontier(courseId?: UnitId): FrontierItemDto[];
  /** Упражнения с `R ≤ plan.targetRetention`; `minNeed` отсекает по `need`. */
  getDue(minNeed?: number): DueItemDto[];
  /**
   * Пишет записи одной транзакцией: `build` (seq, HLC-`at`) → `append` →
   * `journal.commit` → проекции → сброс кэшей `UnitScorer`. Дубликаты (по
   * `id`) в проекции не попадают. Сбой проекций → `markDirty()` и
   * исключение (журнал уже записан); сбой `append` состояния не меняет.
   */
  commit(inputs: readonly CommitInput[]): Promise<CommitResult>;
  /** Сообщение подписчикам: уходит после завершения команды (`bus.flush`). */
  emit(event: EngineEvent): void;
  /**
   * Применяет записи, уже лежащие в журнале (импорт, синхронизация), к
   * проекциям и сбрасывает кэши `UnitScorer`; возвращает затронутые юниты.
   * Записи старше применённых и сбросы допустимы: производные проекции
   * досчитываются при чтении.
   */
  applyEntries(entries: readonly LogEntry[]): UnitId[];
  /** Полная перестройка проекций из журнала; `state-rebuilt` в шину; `dirty = false`. */
  rebuild(): Promise<void>;
  markDirty(): void;
  /** Проекции и кэши после смены библиотеки, опций или записей журнала. */
  invalidateDerived(): void;
}
