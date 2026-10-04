import type {
  DeepPartial,
  EpochMs,
  MissingSeqs,
  SavedFilterDto,
  SchedulerOptionsDto,
  StateVector,
  StudySessionWire,
  ExtensionSettingsDto,
  LearningSettingsDto,
  UiSettingsDto,
  VerdictDto,
} from '@dolphy-app/engine-contract';
import type { LogEntry } from '../domain/journal.ts';
import type { UserPreferences } from '../domain/manifest.ts';

export interface Clock {
  now(): EpochMs;
}

export interface IdGenerator {
  next(): string; // uuidv7
}

export interface Logger {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

/** Источник псевдослучайности; все операции выводятся из `random`. */
export interface Rng {
  /** Равномерное f64 в [0, 1). */
  random(): number;
  /** Целое в [lo, hi). */
  range(lo: number, hi: number): number;
  /** Перемешивает массив на месте. */
  shuffle<T>(items: T[]): void;
  /** Выборка без возвращения: `min(amount, n)` элементов в случайном порядке. */
  sample<T>(items: Iterable<T>, amount: number): T[];
  /** Взвешенная выборка без возвращения; вес <= 0 не выбирается. */
  sampleWeighted<T>(
    items: readonly T[],
    amount: number,
    weight: (item: T) => number,
  ): T[];
}

export interface MemoryState {
  readonly stability: number;
  readonly difficulty: number;
}

/** Порт модели памяти; изолирует API ts-fsrs (engine-ts.md §6). */
export interface MemoryModel {
  /** `'fsrs-6/ts-fsrs@5.4.2/w:<hash>'` */
  readonly id: string;
  /** `wholeDays` — целые сутки от прошлого шага, первый шаг — 0. */
  step(
    state: MemoryState | null,
    wholeDays: number,
    rating: 1 | 2 | 3 | 4,
  ): MemoryState;
  /** `days` — дробные сутки с последней попытки. */
  retrievability(state: MemoryState, days: number): number;
}

export interface AppendResult {
  appended: readonly LogEntry[];
  duplicates: readonly string[]; // id уже был в журнале
}

/** Причина скрытия записи от проекций (engine-ts.md §5.1, `log_conflict`). */
export type ConflictReason = 'id-content' | 'seq-two-ids' | 'clock-skew';
export type ConflictState = 'open' | 'kept' | 'discarded';

/**
 * Строка `log_conflict`: запись, скрытая от проекций. Ключ — `(conflictId,
 * entryHash)`; `conflictId` = `<reason>:<id | deviceId#seq>`. Одна запись может
 * входить в несколько конфликтов (общий `entryHash`).
 */
export interface ConflictRow {
  conflictId: string;
  reason: ConflictReason;
  /** sha256 канонического JSON записи. */
  entryHash: string;
  state: ConflictState;
  entry: LogEntry;
  detectedAt: EpochMs;
}

/** Строка `imported_segment`: применённый сегмент FolderSync. */
export interface SegmentRecord {
  deviceId: string;
  name: string;
  sha256: string;
  firstSeq: number;
  lastSeq: number;
  importedAt: EpochMs;
}

/**
 * Синхронные примитивы внутри одной транзакции хранилища [ВЫВОД: в дизайне
 * порт назван без сигнатур]. Алгоритм слияния и решения конфликтов написан один
 * раз (`@dolphy-app/engine/sync`) поверх этих примитивов, адаптеры их только реализуют.
 * «Живые» записи — `log_entry`, скрытые — `log_conflict`; вместе они образуют
 * множество записей реплики.
 */
export interface StoreTx {
  findById(id: string): LogEntry | null;
  findByPair(deviceId: string, seq: number): LogEntry | null;
  /** Живая запись; нарушение уникальности `id` или `(deviceId, seq)` — ошибка. */
  insert(entry: LogEntry): void;
  /** Убирает живую запись (перенос в конфликт делает вызывающий). */
  remove(id: string): void;
  conflictRowsByHash(entryHash: string): readonly ConflictRow[];
  conflictRowsById(id: string): readonly ConflictRow[];
  conflictRowsByPair(deviceId: string, seq: number): readonly ConflictRow[];
  conflictRowsByGroup(conflictId: string): readonly ConflictRow[];
  /** Вставка или замена по `(conflictId, entryHash)`. */
  putConflictRow(row: ConflictRow): void;
  putSegment(segment: SegmentRecord): void;
}

export interface EventStore {
  /** Меняется только через `rotateDeviceId` (форк после восстановления). */
  readonly deviceId: string;
  /** Наибольший `seq` своего устройства среди живых и скрытых записей; 0 — записей нет. */
  lastSeq(): number;
  /** Наибольший `at` среди живых записей (скрытые в него не входят); 0 — записей нет. */
  maxAt(): EpochMs;
  /**
   * Одна транзакция. Запись с уже известным `id` (живая или скрытая) — в
   * `duplicates`; нарушение схемы, занятый `(deviceId, seq)` под другим `id` —
   * ошибка, ничего не записывается.
   */
  append(entries: readonly LogEntry[]): Promise<AppendResult>;
  /** Живые записи в порядке `(at, deviceId, seq)`. */
  readAll(): AsyncIterable<LogEntry>;
  close(): Promise<void>;
  /**
   * Одна транзакция записи (`BEGIN IMMEDIATE`); исключение из `work` откатывает
   * всё. `work` синхронна: адаптеры не отдают управление посреди транзакции.
   * Кэши (`lastSeq`, `maxAt`, вектор) обновляются только после фиксации.
   */
  transact<T>(work: (tx: StoreTx) => T): Promise<T>;
  /** Непрерывный префикс `seq` по устройствам (живые и скрытые записи). */
  vector(): StateVector;
  /** Дыры за префиксом (не более 1 000 `seq` на устройство). */
  missing(): MissingSeqs;
  /** Наибольший `seq` устройства (с дырами); 0 — записей нет. */
  maxSeq(deviceId: string): number;
  /** Число живых записей. */
  entryCount(): number;
  /**
   * Живые записи с `seq` больше `since[deviceId]` (для неуказанных — со всех),
   * по `(deviceId, seq)`; включая записи за дырами. Не более `limit`.
   */
  readSince(since: StateVector, limit: number): Promise<readonly LogEntry[]>;
  /** Живые записи устройства с `seq` из `[fromSeq, toSeq]`, по возрастанию `seq`. */
  readDevice(
    deviceId: string,
    fromSeq: number,
    toSeq?: number,
  ): Promise<readonly LogEntry[]>;
  /** Все строки `log_conflict` в любом состоянии. */
  conflicts(): Promise<readonly ConflictRow[]>;
  /** Реестр применённых сегментов (`imported_segment`). */
  segments(): Promise<readonly SegmentRecord[]>;
  /** Новый `deviceId` (форк); `lastSeq` нового устройства — 0. */
  rotateDeviceId(deviceId: string): Promise<void>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type RawVerdict = DistributiveOmit<
  VerdictDto,
  'attemptId' | 'attemptsUsed'
>;

export interface SourceEntry {
  name: string;
  /** Для симлинка — вид цели; висячая ссылка в список не попадает. */
  kind: 'file' | 'directory';
  /** Запись — символическая ссылка (M1: сканер проверяет корень). */
  symlink?: true;
}

export interface SourceStat {
  kind: 'file' | 'directory';
  bytes: number;
  mtimeMs: number;
  /** Время смены inode: пользовательские инструменты не могут его подделать. */
  ctimeMs?: number;
  ino?: number;
  /** Путь (с учётом симлинков) ведёт за корень библиотеки. */
  outsideRoot?: true;
  /** Идентификатор конечной цели симлинка (защита от петель); иначе не задан. */
  realPath?: string;
}

/**
 * Библиотека курсов: чтение каталога в раскладке Trane и артефакт
 * компилятора. Пути относительны корня библиотеки, разделитель `/`,
 * `''` — корень [ВЫВОД: сигнатуры не были выписаны в дизайне, M1 уточнил:
 * `readBytes`, `ctimeMs`, `ino`, `outsideRoot`, `realPath`, `symlink` —
 * аддитивные расширения для `isFresh` и проверки симлинков].
 */
export interface CourseSource {
  /** Идентификатор корня для диагностик и логов. */
  readonly root: string;
  /** Записи каталога, отсортированные по имени; нет каталога — отказ. */
  list(dir: string): Promise<readonly SourceEntry[]>;
  /** Текст UTF-8; нет файла — отказ. */
  readText(path: string): Promise<string>;
  /** Байты файла как есть (для content-`revision`); нет файла — отказ. */
  readBytes(path: string): Promise<Uint8Array>;
  /** `null`, если пути нет (в том числе висячая ссылка). */
  stat(path: string): Promise<SourceStat | null>;
  /** Артефакт `.engine/compiled.json`; `null`, если его нет. */
  readArtifact(): Promise<string | null>;
  /** Атомарная запись артефакта (tmp + rename). */
  writeArtifact(text: string): Promise<void>;
}

/**
 * Настройки ученика. Адаптеры: SQLite (`engine.db`, продукт), JSON-файлы
 * `dataDir/settings` (wire Trane, запись атомарная, engine-ts.md §5.3) и
 * память (тесты) [ВЫВОД: сигнатуры не были выписаны в дизайне].
 */
export interface SettingsStore {
  loadPreferences(): Promise<UserPreferences>;
  savePreferences(preferences: UserPreferences): Promise<void>;
  listFilters(): Promise<readonly SavedFilterDto[]>;
  saveFilter(filter: SavedFilterDto): Promise<void>;
  /** `false`, если фильтра не было. */
  deleteFilter(id: string): Promise<boolean>;
  listSessions(): Promise<readonly StudySessionWire[]>;
  saveSession(session: StudySessionWire): Promise<void>;
  /** `false`, если сессии не было. */
  deleteSession(id: string): Promise<boolean>;
  /** Отличия опций планировщика от умолчаний; `{}` — своих значений нет. */
  loadSchedulerOverrides(): Promise<DeepPartial<SchedulerOptionsDto>>;
  saveSchedulerOverrides(
    overrides: DeepPartial<SchedulerOptionsDto>,
  ): Promise<void>;
  /** Настройки интерфейса; без сохранённых — тема и язык `system`. */
  loadUi(): Promise<UiSettingsDto>;
  saveUi(ui: UiSettingsDto): Promise<void>;
  /** Настройки обучения; без сохранённых — правило оценки `passAtN`. */
  loadLearning(): Promise<LearningSettingsDto>;
  saveLearning(learning: LearningSettingsDto): Promise<void>;
  /** Настройки расширений; без сохранённых — ничего не отключено и не доверено. */
  loadExtensions(): Promise<ExtensionSettingsDto>;
  saveExtensions(extensions: ExtensionSettingsDto): Promise<void>;
  /** Время последней фоновой проверки обновлений расширений (epoch ms); `null` — не проверяли. */
  loadUpdateCheckedAt(): Promise<number | null>;
  saveUpdateCheckedAt(at: number): Promise<void>;
}

export * from './exercise-types.ts';
export * from './grade-policies.ts';
export * from './extension-commands.ts';
export * from './extension-installer.ts';
export * from './extension-policy.ts';
export * from './extension-reloader.ts';
export * from './extension-registry.ts';
export * from './repositories.ts';
export * from './extension-data.ts';
export * from './extension-health.ts';
export * from './log-reader.ts';
export * from './platform.ts';
