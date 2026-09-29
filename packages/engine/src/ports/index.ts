import type {
  EpochMs,
  SavedFilterDto,
  StudySessionWire,
  SubmissionDto,
  VerdictDto,
} from '@lms/engine-contract';
import type { LogEntry } from '../domain/journal.ts';
import type { ExerciseManifest, UserPreferences } from '../domain/manifest.ts';

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

export interface EventStore {
  readonly deviceId: string;
  lastSeq(): number; // кэш, обновляется append
  maxAt(): EpochMs; // максимальный увиденный at
  append(entries: readonly LogEntry[]): Promise<AppendResult>; // одна транзакция
  readAll(): AsyncIterable<LogEntry>; // ORDER BY at, device_id, seq
  close(): Promise<void>;
  // методы синхронизации и конфликтов — engine-ts.md §6a.6
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type RawVerdict = DistributiveOmit<
  VerdictDto,
  'attemptId' | 'attemptsUsed'
>;

export interface VerifyRequest {
  exercise: ExerciseManifest;
  submission: SubmissionDto;
  timeoutMs: number;
  authorMode: boolean;
}

export interface Verifier {
  readonly runner: string; // 'sql'
  check(request: VerifyRequest): Promise<RawVerdict>; // error-вердикт — данные, не исключение
  close(): Promise<void>;
}

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
 * Настройки ученика: `dataDir/settings/user_preferences.json`,
 * `filters/*.json`, `study_sessions/*.json` — wire Trane, запись атомарная
 * (engine-ts.md §5.3) [ВЫВОД: сигнатуры не были выписаны в дизайне].
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
}
