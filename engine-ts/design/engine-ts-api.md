# engine-ts: контракт API слоя бизнес-логики (`@dolphy-app/engine-contract`)

Статус: проект v1, 2026-09-29 (v0 + слой F1–F7: `library.validate/compile`, `plan`, `placement`, `remediation`, конфликты и `folder` в `sync`, вердикт `outcome`/`reason`; трассировка F1–F7 — `engine-ts.md` §1.1). Основной документ: `engine-ts.md`. Тестирование: `engine-ts-testing.md`. Типы ниже — источник для пакета `@dolphy-app/engine-contract`. Все блоки ```` ```ts ```` (10 штук, в порядке файла) склеены в один модуль `contract.ts` и проверены командой `npx -y -p typescript@7.0.2 tsc --ignoreConfig --noEmit --target es2022 --module esnext --moduleResolution bundler --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --verbatimModuleSyntax --erasableSyntaxOnly --types "" --allowImportingTsExtensions contract.ts examples.ts` (TypeScript 7.0.2) — **0 ошибок** [ИЗМЕРЕНО 2026-09-29, повтор после сверки с `engine-ts.md` v1]. `examples.ts` — блоки ```` ```ts example ```` (§12), обёрнутые в `async function (engine: LearningEngine)` с `import type` из `contract.ts`; они тоже проходят без ошибок [ИЗМЕРЕНО]. Негативный контроль (проверка идёт «вживую»): обращение к удалённому полю `FrontierItemDto.newExercises` в копии модуля даёт `TS2353`, оценка `9` в примере placement — `TS2322`. Компиляция проверяет типы, а не поведение: семантика сервисов — в тексте и в `engine-ts.md`.
Пометки: **[ИЗМЕРЕНО]**, **[ВЫВОД]**, **[ОЦЕНКА]**, **[НЕ ПОДТВЕРЖДЕНО]** — как в основном документе.

## 1. Принципы контракта

- **Асинхронный и DTO-only.** Каждый метод возвращает `Promise`. Аргументы и результаты — plain-данные, безопасные для structured clone (в Electron 44 экземпляры классов превращаются в plain-объекты, функции и `Symbol` бросают `DataCloneError` [ИЗМЕРЕНО]). В DTO нет классов, функций, `Map`/`Set`; конечные числа; `undefined` допустим только как отсутствие необязательного поля.
- **Транспорт-агностичность.** Тот же интерфейс `LearningEngine` работает in-process (тесты, main) и через RPC (utilityProcess). `subscribe` — единственное место с функцией; по IPC он превращается в поток push-сообщений (§9).
- **Время** — `EpochMs` (мс от эпохи), интервалы — в мс. Оценки — `Grade` 1–5 (в Trane `MasteryScore` One…Five).
- **Идентификаторы юнитов** — строки; в курсах Trane по соглашению `course`, `course::lesson`, `course::lesson::exercise`, но контракт этого не гарантирует.
- **Ошибки** — исключения `EngineError` с `code` внутри процесса, `EngineErrorDto` по IPC. Ожидаемые проблемы данных (диагностики библиотеки) возвращаются данными, не исключениями.
- **Пагинация** — курсор (`Page`): непрозрачная строка, порядок стабилен. Лимиты в §10.
- **Идемпотентность.** `recordAttempt` — по `requestId` (он становится `id` события), `completeAttempt` — по `attemptId`, `placement.finish` — по `requestId`, `resetProgress` — по `requestId`, `import` — по `id` записи, `sync.folder.sync` — по содержимому сегментов (повтор даёт `duplicates`). Чтения без побочных эффектов (`plan.getDay` при заданном `seed`, `remediation.getPlan`, `library.validate`, `placement.nextProbe` до ответа на выданную пробу) безопасно повторять. Не идемпотентны: `getBatch` (RNG и счётчик показов), `startSession`, `beginAttempt`, `placement.start`, `placement.answer`, `sync.resolveConflict`. UI кэширует батч и не повторяет эти вызовы вслепую.
- **Версионирование.** `CONTRACT_VERSION` (целое) отдаётся в `library.getInfo()` и проверяется при рукопожатии хоста и renderer. Внутри версии — только аддитивные изменения (новые необязательные поля, новые значения перечислений; клиент обязан терпеть неизвестные значения).
- **Не экспортируется** (в Rust есть, в API нет): сырые записи в `practice_*` (`record_*`, `trim_*`), мутаторы графа (`add_*`), `invalidate_cached_score*`, `override_current_timestamp`, `get_scheduler_data`. Единственный путь записи попытки — `recordAttempt`/`completeAttempt`.
- **Пакет типов** `@dolphy-app/engine-contract` содержит только `export type` и константы; renderer импортирует его через `import type`, не подтягивая `ts-fsrs`, zod и fs.

## 2. Общие типы

```ts
export const CONTRACT_VERSION = 2 as const;
/** Кап длины SQL ученика в символах (`String.length`); хост применяет его до IPC раннера (§9). Длиннее — `failed/sqlite_limit` без запуска раннера. */
export const MAX_SQL_CHARS = 100_000 as const;

export type UnitId = string;
export type EpochMs = number;
export type Grade = 1 | 2 | 3 | 4 | 5;
export type UnitKind = 'course' | 'lesson' | 'exercise';

export interface PageRequest { limit?: number; cursor?: string }
export interface Page<T> { items: T[]; nextCursor?: string }

export type EngineErrorCode =
  | 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'ENGINE_CLOSED' | 'INCOMPATIBLE_CONTRACT'
  | 'LIBRARY_NOT_LOADED' | 'LIBRARY_INVALID' | 'ASSET_OUTSIDE_LIBRARY' | 'ASSET_TOO_LARGE'
  | 'ATTEMPT_NOT_FOUND' | 'ATTEMPT_CLOSED'
  | 'VERIFIER_UNAVAILABLE' | 'VERIFIER_TIMEOUT'
  | 'PLACEMENT_SESSION_NOT_FOUND' | 'PLACEMENT_SESSION_ACTIVE' | 'PLACEMENT_BUDGET_EXHAUSTED'
  | 'SYNC_DEVICE_ID_CLASH' | 'SYNC_CONFLICT_NOT_FOUND' | 'SYNC_FOLDER_NOT_CONFIGURED'
  | 'STORE_BUSY' | 'STORE_READONLY' | 'STORE_CORRUPT'
  | 'INTERNAL';

export interface EngineErrorDto {
  code: EngineErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

## 3. Библиотека курсов

```ts
export type Severity = 'error' | 'warning' | 'info';
/** Каталог компилятора: 36 кодов `report-compiler.md` §3.1 + `W_GRANULARITY`, `E_REFERENCE_FAILS` (engine-ts.md §1.1, F2) + `W_ORPHAN_EVENTS` (его выдаёт движок при открытии, не компилятор). Префикс = серьёзность по умолчанию. */
export type DiagnosticCode =
  // разбор и схема
  | 'E_IO' | 'E_JSON_PARSE' | 'E_SCHEMA' | 'W_UNKNOWN_KEY' | 'E_FRONTMATTER_UNTERMINATED' | 'E_FRONTMATTER_PARSE'
  | 'E_ENGINE_SCHEMA' | 'W_ENGINE_UNKNOWN_KEY' | 'E_ENGINE_DUPLICATE' | 'W_UNKNOWN_RUNNER'
  // идентификаторы
  | 'E_ID_EMPTY' | 'E_ID_DUPLICATE' | 'E_ID_MISMATCH'
  // граф
  | 'E_DEP_MISSING' | 'E_DEP_SELF' | 'E_DEP_KIND' | 'E_CYCLE_DEPENDENCY' | 'E_CYCLE_SUPERSEDED' | 'E_CYCLE_ENCOMPASSED'
  | 'W_REDUNDANT_EDGE' | 'E_ENC_WEIGHT' | 'E_ENC_MISSING' | 'E_ENC_NOT_ANCESTOR' | 'E_SUP_MISSING'
  | 'W_ORPHAN_LESSON' | 'W_FAN_IN'
  // расширение `engine`
  | 'E_KEYPREREQ_MISSING' | 'E_KEYPREREQ_NOT_ANCESTOR' | 'E_NO_VERIFICATION' | 'I_NO_VERIFICATION'
  // ассеты и раскладка
  | 'W_UNSUPPORTED_GENERATOR' | 'E_ASSET_MISSING' | 'E_ASSET_ESCAPES_ROOT' | 'E_ASSET_TYPE'
  | 'W_ASSET_KIND_UNSUPPORTED' | 'W_KB_STRAY_FILE'
  // сверх каталога спайка (компилятор)
  | 'W_GRANULARITY' | 'E_REFERENCE_FAILS'
  // выдаёт движок при открытии библиотеки: в журнале есть события юнитов, которых нет в библиотеке (engine-ts.md §9, курс переименовали)
  | 'W_ORPHAN_EVENTS';

/** Серьёзность по умолчанию: 36 значений из `spike/compiler/src/diagnostics.ts`; для трёх новых кодов — по префиксу [ВЫВОД]. */
export const DIAGNOSTIC_SEVERITY: Record<DiagnosticCode, Severity> = {
  E_IO: 'error', E_JSON_PARSE: 'error', E_SCHEMA: 'error', W_UNKNOWN_KEY: 'warning',
  E_FRONTMATTER_UNTERMINATED: 'error', E_FRONTMATTER_PARSE: 'error', E_ENGINE_SCHEMA: 'error',
  W_ENGINE_UNKNOWN_KEY: 'warning', E_ENGINE_DUPLICATE: 'error', W_UNKNOWN_RUNNER: 'warning',
  E_ID_EMPTY: 'error', E_ID_DUPLICATE: 'error', E_ID_MISMATCH: 'error',
  E_DEP_MISSING: 'error', E_DEP_SELF: 'error', E_DEP_KIND: 'error',
  E_CYCLE_DEPENDENCY: 'error', E_CYCLE_SUPERSEDED: 'error', E_CYCLE_ENCOMPASSED: 'error',
  W_REDUNDANT_EDGE: 'warning', E_ENC_WEIGHT: 'error', E_ENC_MISSING: 'error', E_ENC_NOT_ANCESTOR: 'error',
  E_SUP_MISSING: 'error', W_ORPHAN_LESSON: 'warning', W_FAN_IN: 'warning',
  E_KEYPREREQ_MISSING: 'error', E_KEYPREREQ_NOT_ANCESTOR: 'error', E_NO_VERIFICATION: 'error', I_NO_VERIFICATION: 'info',
  W_UNSUPPORTED_GENERATOR: 'warning', E_ASSET_MISSING: 'error', E_ASSET_ESCAPES_ROOT: 'error', E_ASSET_TYPE: 'error',
  W_ASSET_KIND_UNSUPPORTED: 'warning', W_KB_STRAY_FILE: 'warning',
  W_GRANULARITY: 'warning', E_REFERENCE_FAILS: 'error', W_ORPHAN_EVENTS: 'warning',
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
export interface DiagnosticSummary { errors: number; warnings: number; infos: number }

/** `fresh` — артефакт соответствует библиотеке (stat или content-`revision`); `stale` — `revision` отличается; `missing` — файла нет или он не читается; `compiling` — идёт фоновая компиляция. */
export type ArtifactState = 'fresh' | 'stale' | 'missing' | 'compiling';

export interface LibraryInfo {
  contractVersion: number;
  root: string;
  /** content-`revision` загруженной библиотеки (sha256 по отсортированным `path\0len\0bytes`). */
  revision: string;
  state: 'ready' | 'invalid';
  artifact: ArtifactState;
  counts: { courses: number; lessons: number; exercises: number; dependencyEdges: number };
  diagnostics: DiagnosticSummary;
  loadedAt: EpochMs;
  loadMs: number;
}

export interface AssetRef { unitId: UnitId; path: string }
export interface WeightedRef { id: UnitId; weight: number }

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

export interface VerificationSpecDto {
  runner: string;
  timeoutMs: number;
  params: Record<string, unknown>;
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
  verification?: VerificationSpecDto;
  keyPrerequisites: UnitId[];
}
export type UnitDto = CourseDto | LessonDto | ExerciseDto;

export interface GraphQuery { rootIds?: UnitId[]; depth?: number; kinds?: UnitKind[]; limit?: number }
export interface GraphNodeDto { id: UnitId; kind: UnitKind; name: string; parentId?: UnitId }
/** `from` зависит от `to` (dependency), охватывает `to` (encompassed) или заменяет `to` (superseded). */
export interface GraphEdgeDto { from: UnitId; to: UnitId; type: 'dependency' | 'encompassed' | 'superseded'; weight?: number }
export interface GraphDto { nodes: GraphNodeDto[]; edges: GraphEdgeDto[]; truncated: boolean }

export interface AssetContent { ref: AssetRef; mime: 'text/markdown' | 'text/plain'; text: string; bytes: number }

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
export interface CompileRequest { runChecks?: boolean }
export interface CompileResult {
  revision: string;
  diagnosticsSummary: DiagnosticSummary;
  /** false: есть ошибки (артефакт не пишется) или свежий артефакт уже лежит на диске. */
  artifactWritten: boolean;
}

export interface LibraryService {
  getInfo(): Promise<LibraryInfo>;
  getDiagnostics(req?: PageRequest & { minSeverity?: Severity }): Promise<Page<Diagnostic>>;
  validate(req?: ValidateRequest): Promise<ValidateResult>;
  compile(req?: CompileRequest): Promise<CompileResult>;
  reload(): Promise<LibraryInfo>;
  listCourses(req?: PageRequest): Promise<Page<CourseDto>>;
  listLessons(courseId: UnitId, req?: PageRequest): Promise<Page<LessonDto>>;
  listExercises(lessonId: UnitId, req?: PageRequest): Promise<Page<ExerciseDto>>;
  getUnit(id: UnitId): Promise<UnitDto>;
  matchPrefix(prefix: string, kind?: UnitKind, req?: PageRequest): Promise<Page<UnitId>>;
  getGraph(query?: GraphQuery): Promise<GraphDto>;
  readAsset(ref: AssetRef): Promise<AssetContent>;
}
```

Семантика:
- `reload()` берёт свежий артефакт (`loadCompiled`, без проверки циклов); иначе компилирует; при ошибках остаётся прежняя неизменяемая библиотека, диагностики видны в `getDiagnostics`; без ошибок артефакт пишется атомарно (temp + rename) и библиотека подменяется атомарно (engine-ts.md §6a.1). При `state: 'invalid'` (строгий режим) практика недоступна (`LIBRARY_INVALID`), библиотека и журнал читаются.
- `validate()` пересобирает диагностики из файлов, **не** подменяя граф и не трогая артефакт; все проблемы за один проход (Trane останавливался на первой ошибке). Курсор страницы привязан к результату последнего `validate`; следующий вызов делает прежние курсоры недействительными (`INVALID_ARGUMENT`) [ВЫВОД]. `getDiagnostics` отдаёт диагностики загруженной библиотеки (последний `reload`).
- `compile()` пишет или обновляет `.engine/compiled.json` и не подменяет граф (следующий `reload` возьмёт артефакт); `artifactWritten: false`, если найдены ошибки или свежий артефакт уже есть. Компиляция в хосте идёт в фоне при открытии (`LibraryInfo.artifact: 'compiling'`). Тот же код исполняет CLI `engine-cli validate|compile` (код выхода 1 при ошибках).
- `runChecks: true` (M5) запускает эталонные решения упражнений через `Verifier`; без раннера — `VERIFIER_UNAVAILABLE`. Пороги `W_GRANULARITY` (3 и 12 упражнений на урок) — предположения [НЕ ПОДТВЕРЖДЕНО, engine-ts.md §12.18]. `W_ORPHAN_EVENTS` (события юнитов, которых нет в библиотеке; `unitId` — сирота, `path` не задан) выдаёт **движок при открытии и `reload()`**, а не компилятор: артефакт `compiled.json` от журнала не зависит, `validate()` и `compile()` этот код не возвращают. События остаются в журнале, проекции пропускают неизвестные id (engine-ts.md §9).
- Списки отсортированы по коду символов id (как в Trane, `get_course_ids`); `getGraph` ограничен `limit` (по умолчанию 500, максимум 2 000), `truncated` сообщает об обрезке.
- `readAsset` принимает только `AssetRef`, выданный самим движком; путь проверяется на выход за корень библиотеки (включая симлинки), размер — не более 2 МБ. Тип — только текст; движок возвращает Markdown сырым, санитайзинг — на стороне UI.
- Отсутствующие метаданные — пустая запись, не `undefined`.

### 3.1 Репозитории курсов (`repositories`)

Курсы можно подгрузить из публичного git-репозитория (`http`/`https`, без учётных данных в URL). Состояние: `RepositoryDto { id, url, ref, commit, fetchedAt, status: 'ready' | 'updating' | 'error', courseIds, skippedCourseIds, lastError?, availableCommit?, checkedAt? }`. Методы: `list()`, `preview({url, ref?})` → `RepositoryPreviewDto`, `add({url, ref?, courseIds?})`, `update(id, {courseIds?}?)` → `{changed, repository}`, `remove(id)`, `cancel(id)`, `checkUpdates()` → `RepositoryDto[]`.

- На диске лежит **снимок** дерева коммита (`<libraryRoot>/repositories/<id>/`, без `.git`): только обычные файлы, без символических ссылок, путей с `..` и `.git`, коллизий регистра; лимиты — 20 000 файлов, 256 МиБ, 32 МиБ на файл, 60 с сети без байта. Сканер видит курсы штатно.
- `id` — slug нормализованного URL; уникальность по URL (`REPOSITORY_EXISTS`); `ref` — имя ветки или тега, `null` — ветка по умолчанию. Смена ветки — `remove` + `add`.
- `add`/`update` атомарны: снимок проверяется сканером во временном каталоге, затем подменяется каталог и вызывается `library.reload()`; отклонённый `reload` (например, `E_ID_DUPLICATE` с уже загруженным курсом) откатывает подмену, запись и граф остаются прежними (`REPOSITORY_REJECTED`, диагностики в `details`). Запись реестра — последний шаг.
- `update` сначала спрашивает у сервера только коммит ветки/тега; совпал — `changed: false`, объекты не скачиваются.
- Сетевая часть идёт вне очереди команд (остальные методы не ждут загрузку), подмена и `reload` — внутри очереди; события `repository-progress` уходят сразу. `cancel` прерывает операцию (вызов падает `GIT_FETCH_FAILED`, `details.reason: 'cancelled'`).
- `remove` удаляет снимок и запись, журнал не трогает: события пропавших курсов дают `W_ORPHAN_EVENTS`, повторное добавление возвращает прогресс.
- Реестр лежит в `engine.db` (таблица `repository`), устройства его не синхронизируют. Автообновления нет.
- **Проверка обновлений** (спека `course-updates`). `checkUpdates()` для каждого репозитория спрашивает у сервера только коммит `ref` (`resolve`, объекты не скачиваются) и возвращает то же, что `list()`. Если коммит сервера отличается от загруженного, у репозитория есть `availableCommit`; `checkedAt` — время последней успешной сверки в этом запуске. Результат хранится в памяти движка, в `engine.db` не пишется и после перезапуска пересчитывается. Недоступный репозиторий (сеть, `not-found`, таймаут) пропускается, его прежний результат остаётся, вызов не падает, причина — в журнал `warn`; репозиторий с идущей операцией не проверяется. `update` (успешный, в том числе `changed: false`) и `remove` сбрасывают результат. После каждой проверки, где сверен хотя бы один репозиторий, публикуется `repository-updates-checked { available }` (`id` репозиториев с обновлением, в порядке `list()`). Сразу после открытия движок запускает ту же проверку в фоне; запуск её не ждёт, сбой только в журнал. Метод не встаёт в очередь команд и не ждёт цепочку операций репозиториев.
- **Выбор курсов** (спека `repository-course-selection`). `preview({url, ref?})` скачивает репозиторий во временный каталог (`.staging/<opId>`), сканирует и возвращает `RepositoryPreviewDto { url, ref, commit, courses }`; ничего не устанавливает, библиотеку, реестр и каталоги библиотеки не меняет, событий `library-reloaded` нет (прогресс — `repository-progress`, отмена — `cancel(id)`). Курс предпросмотра: `RepositoryCourseDto { id, title, path, lessonCount, requires, errors, warnings, messages, installed, inLibrary }`; `requires` — курсы того же репозитория, без которых этот не загрузится (`dependencies`, `superseded`, `encompassed` на юниты других курсов и курсы-предки по каталогам), `errors`/`warnings` — диагностики сканера в каталоге курса, `inLibrary` — `id` занят курсом из другого источника. `add({url, ref?, courseIds?})` и `update(id, {courseIds?})`: с `courseIds` из снимка перед проверкой удаляются каталоги невыбранных курсов (корневые файлы и остальные каталоги остаются), `RepositoryDto.courseIds` — установленные курсы, `skippedCourseIds` — курсы коммита, которых нет в библиотеке из-за выбора. Выбор непустой и без повторов (`INVALID_ARGUMENT`, `details.field: 'courseIds'`), движок его не расширяет (`missing-requirement`), ошибки в невыбранном курсе добавление не блокируют. Запись реестра хранит `selected` (явный выбор; нет поля — все курсы, как у записей до фичи) и `skippedCourseIds`. `update` без `courseIds` берёт сохранённый выбор: новые курсы коммита не ставятся, исчезнувший выбранный курс просто пропадает (запомненный выбор не меняется), если выбранных курсов не осталось — `no-courses`. С `courseIds` тот же коммит скачивается заново (`changed: true`); тот же коммит с тем же выбором — `changed: false`. Журнал ученика выбор не трогает.

## 4. Практика

Фильтры и учебные сессии — **wire-формат Trane** (внешне тегированные enum, snake_case): тот же формат хранится в файлах настроек, поэтому отдельного маппинга нет. Единственное отличие — время старта сессии числом в мс (в файле RFC 3339).

```ts
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
export interface StudySessionWire { id: string; description?: string; parts?: SessionPartWire[] }
export type ExerciseFilterDto =
  | { UnitFilter: UnitFilterWire }
  | { StudySession: { startTimeMs: EpochMs; definition: StudySessionWire } };

export type MasteryWindowName = 'new' | 'target' | 'current' | 'easy' | 'mastered';
export interface UnitScoreDto {
  unitId: UnitId;
  kind: UnitKind;
  /** 0..5; null = нет валидной оценки. В `getBatch` (паритет Trane) зависимость без оценки считается выполненной; в `getFrontier` — закрытой (§4). */
  score: number | null;
  avgTrials: number | null;
  window: MasteryWindowName | null;
}

export type UnitStatus = 'locked' | 'ready' | 'in-progress' | 'mastered' | 'blacklisted' | 'superseded';
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
export interface AttemptRecordDto { eventId: string; exerciseId: UnitId; grade: Grade; at: EpochMs; source: AttemptSource }

export interface BatchRequest { filter?: ExerciseFilterDto }
/** `reasons[i]` — причина показа `exercises[i]`; массивы одной длины. */
export interface BatchDto { exercises: ExerciseDto[]; reasons: ItemReason[]; generatedAt: EpochMs; sessionId: string }

/** Причина позиции в батче и плане дня: `new` — попыток нет; `review` — есть попытки; `remediation` — вставлено ремедиацией (§4.3). */
export type ItemReason = 'review' | 'new' | 'remediation';

export interface AttemptDto { attemptId: string; exercise: ExerciseDto; startedAt: EpochMs; verifiable: boolean }
export type SubmissionDto =
  | { kind: 'text'; text: string }
  | { kind: 'sql'; sql: string }
  | { kind: 'json'; value: unknown };
export interface SubmitAnswerRequest { attemptId: string; submission: SubmissionDto }
export type FailedReason = 'mismatch' | 'sql_error' | 'forbidden' | 'row_limit' | 'byte_limit' | 'sqlite_limit';
export type ErrorReason = 'fixture_error' | 'expected_error' | 'timeout' | 'resource_kill' | 'worker_crash' | 'internal';
export type VerdictReason = FailedReason | ErrorReason;

interface VerdictBase {
  attemptId: string;
  /** Число вердиктов `passed`/`failed` по попытке; `error` не считается. */
  attemptsUsed: number;
  durationMs: number;
  rowCount?: number;
  feedback?: string;
}
export type VerdictDto =
  | (VerdictBase & { outcome: 'passed' })
  /** Вина ученика. `detail` (ожидаемые строки) — только при `EngineConfig.authorMode`. */
  | (VerdictBase & { outcome: 'failed'; reason: FailedReason; detail?: string })
  /** Не вина ученика: журнал не затрагивается, повтор `submitAnswer` разрешён. */
  | (VerdictBase & { outcome: 'error'; reason: ErrorReason });
export interface CompleteAttemptRequest { attemptId: string; grade?: Grade; outcome?: 'gave-up' }
export interface RecordAttemptRequest { requestId: string; exerciseId: UnitId; grade: Grade; at?: EpochMs; source?: AttemptSource }
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

export interface FrontierRequest extends PageRequest { courseId?: UnitId }
export interface FrontierItemDto { lessonId: UnitId; courseId: UnitId; exerciseCount: number }
export interface DueRequest extends PageRequest {
  minNeed?: number;
  /** Область курсов (§4.1): пусто или нет поля — все курсы; неизвестный курс — `NOT_FOUND`. */
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
  getBatch(req?: BatchRequest): Promise<BatchDto>;
  beginAttempt(req: { exerciseId: UnitId }): Promise<AttemptDto>;
  submitAnswer(req: SubmitAnswerRequest): Promise<VerdictDto>;
  completeAttempt(req: CompleteAttemptRequest): Promise<RecordResultDto>;
  recordAttempt(req: RecordAttemptRequest): Promise<RecordResultDto>;
  getUnitScore(unitId: UnitId): Promise<UnitScoreDto>;
  getAttempts(exerciseId: UnitId, req?: PageRequest): Promise<Page<AttemptRecordDto>>;
  getProgress(query?: ProgressQuery, req?: PageRequest): Promise<Page<ProgressNodeDto>>;
  getFrontier(req?: FrontierRequest): Promise<Page<FrontierItemDto>>;
  getDue(req?: DueRequest): Promise<Page<DueItemDto>>;
  resetProgress(req: { unitId: UnitId; requestId: string }): Promise<{ eventId: string; duplicate: boolean }>;
}
```

Семантика:
- **Сессия обучения.** `startSession()` сбрасывает эфемерное состояние Trane, которое по смыслу привязано к занятию, а не к жизни процесса: карту показов, relearn pile и success rate (последний сдвигает окна мастерства в `CandidateFilter`). Без вызова состояние живёт до перезапуска движка, как в Rust.
- **`getBatch`** возвращает батч Trane (размер `batchSize` опций, плюс до `relearnFraction × batchSize` повторов провалов, поэтому итог может превышать `batchSize`) и увеличивает счётчик показов; пустой батч — нормальный результат. Фильтр — как в Trane: курс, урок, метаданные, review list, dependents, dependencies или study session. `reasons[i]` объясняет `exercises[i]`; элементы `remediation` вставляются перед новым материалом, входят в `batchSize` и вытесняют самые низкоприоритетные новые [ВЫВОД, engine-ts.md §6a.5]. Продуктовый путь ежедневного плана — `plan.getDay` (§4.1).
- **Попытка с проверкой.** `beginAttempt` → `submitAnswer`\* → `completeAttempt`. Состояние попытки живёт в памяти хоста (TTL 24 ч, не более 100 открытых); при падении хоста теряется, тогда UI использует `recordAttempt` (самооценка). `completeAttempt` для проверяемого упражнения выводит оценку из вердиктов по `GradePolicy` (по умолчанию `pass@1 → 5`, `pass@2 → 4`, `pass@3+ → 3`, `gave-up → 1`; калибровка данными — M5 [НЕ ПОДТВЕРЖДЕНО]); для непроверяемого требует `grade`. Если по проверяемой попытке есть только вердикты `error` (ни `passed`, ни `failed`), `completeAttempt` требует `grade` (самооценку) или `outcome: 'gave-up'`, иначе `INVALID_ARGUMENT` [ВЫВОД]. Повторный `completeAttempt` возвращает прежний `RecordResultDto` с `duplicate: true`.
- **Вердикт** (engine-ts.md §6a.4). `passed`; `failed` — вина ученика, вердикт учитывается в `attemptsUsed` и в оценке (`mismatch`, `sql_error`, `forbidden`, `row_limit`, `byte_limit`, `sqlite_limit`); `error` — не вина ученика (`fixture_error`, `expected_error` — ошибка курса; `timeout`, `resource_kill`, `worker_crash`, `internal`): журнал не затрагивается, в `attemptsUsed` и оценку не входит, `submitAnswer` можно повторить. `timeout` и `resource_kill` не отличают бесконечный запрос ученика от медленной машины, поэтому это `error`; UI предлагает повтор или самооценку через `recordAttempt`. `submitAnswer` журнал не пишет ни при каком исходе: запись делает только `completeAttempt`. Ожидаемые строки (`detail` у `failed`) отдаются только при `EngineConfig.authorMode`, который задаёт хост, не renderer.
- **`recordAttempt`** — путь Trane `score_exercise`: единственная запись в журнал (`source: 'self'` по умолчанию). `at` вычисляется по HLC-правилу (§6): `max(min(now, now + 5 минут), maxAtУвиденный + 1, свойПрошлыйAt)`; переданное `at` участвует как `now`. `affected` — новые оценки упражнения, урока и курса. Если эта попытка — `remediation.failThreshold`-я неудача подряд на упражнении (§4.3), в результате есть `remediation`.
- **`getFrontier`** — уроки, которые **не начаты** (нет попыток по их упражнениям) и у которых все зависимости «проходят порог» Trane (среднее `value` ≥ `passingScore.minScore` = 3.0, среднее число попыток ≥ `passingScore.minAvgTrials` = 1.8, по данным `UnitScorer`). **Нет данных = закрыто**: зависимость без оценки блокирует урок. До дифференциального теста M3 против Rust `get_candidates` (сравнивается множество уроков-источников новых упражнений) `getBatch` (паритет Trane, `passes_threshold` при отсутствии данных пропускает) может показать урок, которого нет во фронтире; семантика `getFrontier` зафиксирована здесь [НЕ ПОДТВЕРЖДЕНО]. **`getDue`** — упражнения с состоянием и `R ≤ plan.targetRetention` (0.9) по убыванию `need = 1 − R` (Trane их публично не отдаёт [ИЗМЕРЕНО чтением аудита]); `minNeed` отсекает по `need`.
- **`resetProgress`** пишет `progress_reset` для курса, урока или упражнения (журнал не редактируется); повтор с тем же `requestId` безопасен.
- Статусы `ProgressNodeDto.status`: `locked` — есть неудовлетворённая зависимость; `ready` — фронтир без попыток; `in-progress` — есть попытки и оценка ниже верхней границы окна `target`; `mastered` — оценка в окне `mastered` или `easy`; `blacklisted`, `superseded` — по правилам Trane.

### 4.1 План дня

```ts
export interface PlanRequest {
  /** 1..200 (граница — самый большой замеренный размер плана, §10). */
  maxItems: number;
  /** uint32; при равных (состояние, seed, область) план одинаков. Без `seed` хост берёт его из `Rng` и возвращает в `DayPlanDto.seed`. */
  seed?: number;
  /** Область курсов (см. ниже): пусто или нет поля — все курсы; неизвестный курс — `NOT_FOUND`. */
  courseIds?: UnitId[];
}
export interface PlanCoverDto { exerciseId: UnitId; credit: number }
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
```

`getDay` (M6) — чистая функция состояния и `seed`: не меняет счётчик показов и `SessionState` (в отличие от `getBatch`). Состав: просроченные (`R ≤ plan.targetRetention`) по возрастанию R; резерв `ceil(plan.minNewFraction × maxItems)` позиций под новое — `getDay` берёт новое **только** из `getFrontier` и из начатых уроков с упражнениями без попыток (сначала недоделанные упражнения начатых уроков, затем уроки фронтира по кругу между курсами); `remediation` — перед новым материалом (§4.3), входит в `maxItems` и вытесняет самые низкоприоритетные новые [ВЫВОД]; затем интерливинг. При `implicitCredit.enabled` просроченные выбираются жадным покрытием (`covers`), иначе `covers` нет. `≤ maxItems` позиций; повторов `exerciseId` нет. План на 40 позиций из due-набора 500–5 000 — 1.6–2.7 мс без кредита [ИЗМЕРЕНО, `report-fire-plan.md`]. Что UI зовёт по умолчанию, `getDay` или `getBatch` — §13.

**Область курсов (`courseIds`).** Курсы можно учить параллельно, не смешивая: клиент передаёт выбранный курс в `plan.getDay` и `practice.getDue`, и в результате остаются только упражнения этого курса.
- Вне области то же, что в blacklist, но без записи в журнал: ни просроченных, ни нового, ни `remediation` — планировщик проверяет один предикат `isExcluded` для всех трёх источников. Порядок и интерливинг считаются внутри области (для одного курса `plan.maxSameCourseRun` не действует).
- Область — параметр запроса, а не состояние: переключение курса ничего не пишет в журнал, не синхронизируется и не влияет на другие устройства. План остаётся чистой функцией (состояние, `seed`, область).
- Зависимости не зависят от области: граф `getFrontier` и оценки считаются по всей библиотеке, урок, закрытый зависимостью, остаётся закрытым. Область только отфильтровывает результат.
- Просроченное и незавершённая `remediation` остальных курсов ждут: не забываются и не исчезают, а вернутся в план, когда курс снова окажется в области. Клиент может показать их счётчик из `getProgress` (`dueExercises` по курсам).
- Пусто (`[]`) или нет поля — все курсы вперемешку, вывод не отличается от вызова без области (тест). Как `placement.start`, а не «пустая область — пустой план».
- Какой курс сейчас в фокусе, хранит клиент: `UiSettingsDto.activeCourseId` (§5). `getBatch` область не принимает: у него свой `CourseFilter` (§4).

### 4.2 Диагностический вход-тест

```ts
export interface PlacementStartRequest {
  /** Пусто или нет поля — все курсы библиотеки. */
  courseIds?: UnitId[];
  /** Максимум проб, целое 1..200 (граница — предположение [ВЫВОД]); иначе `INVALID_ARGUMENT`. */
  budget: number;
  seed?: number;
}
export interface PlacementStartResult { sessionId: string; lessonCount: number; budget: number; seed: number }
export interface PlacementProbeDto { probeId: string; lessonId: UnitId; exerciseId: UnitId }
/** `grade` — самооценка («пройдено» ⇔ оценка ≥ 3, engine-ts.md §6a.3); `attempt` — итог открытой попытки с проверкой (последний `passed`/`failed`). */
export type PlacementResult =
  | { kind: 'grade'; grade: Grade }
  | { kind: 'attempt'; attemptId: string };
export interface PlacementAnswerRequest { probeId: string; result: PlacementResult }
export interface PlacementProgressDto {
  asked: number;
  budget: number;
  /** Темы, ещё не решённые (`p` между порогами); 0 — тест можно завершать. */
  unresolved: number;
}
export interface PlacementFinishRequest { sessionId: string; requestId: string }
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
```

Метод (engine-ts.md §6a.3): темы — уроки на транзитивной редукции; проба — середина самой длинной цепочки нерешённых тем; жёсткое замыкание (пройдено закрывает предков, не пройдено — потомков); тема решена при `p ≤ 0.15` или `p ≥ 0.85`; пробы не повторяются; детерминизм по (`seed`, ответы). Для проверок с угадыванием `known` требует двух независимых проходов (`minPass = 2`) — это внутреннее правило, в DTO не видно. Состояние сессии — только в памяти хоста; событий до `finish` нет. **Не более одной активной сессии на профиль** (второй `start` — `PLACEMENT_SESSION_ACTIVE`; `abort` или `finish` освобождают), `budget` 1..200, TTL сессии 24 ч (все три границы — предположения [ВЫВОД]); истёкшая сессия — `PLACEMENT_SESSION_NOT_FOUND`. `finish` пишет одной транзакцией по 2 попытки (`grade = 4`, `source: 'placement'`, шаг 1 с) на каждое упражнение `known`-уроков и идемпотентен по `requestId`: повтор с тем же `requestId` возвращает тот же итог с `duplicate: true`; другой `requestId` на завершённую сессию — `PLACEMENT_SESSION_NOT_FOUND`. `abort` неизвестной сессии — no-op. Падение хоста до `finish` теряет сессию (`PLACEMENT_SESSION_NOT_FOUND`), журнал не затронут. `answer` с `kind: 'attempt'` закрывает попытку без записи события; попытка должна относиться к упражнению пробы и содержать хотя бы один вердикт `passed`/`failed`, иначе `INVALID_ARGUMENT`. `answer` на пробу, которой ответ уже принят, или после исчерпания бюджета — `PLACEMENT_BUDGET_EXHAUSTED`. Измерено на синтетических учениках (известное множество — случайный downset, то есть замыкание угадывает структуру генератора — круговость): N = 3 000, шум 3%: 20 проб → accuracy 87.5%, 40 → 89.3%; выбор пробы ≤ 0.33 мс [ИЗМЕРЕНО, `report-diagnostic.md`]. На реальных учениках не проверялось.

### 4.3 Ремедиация

```ts
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
```

`RemediationTracker` — проекция журнала, своих событий нет (безопасна при синхронизации; `rebuild == incremental`). Триггер: `remediation.failThreshold` (2) неудач подряд на упражнении (оценка ≤ 2 или итог `failed`); попытки, покрытые `progress_reset`, в триггер не входят. Снятие — успех на каждом шаге после триггера. `getPlan` для упражнения без триггера возвращает `active: false` и пустые `steps`. При срабатывании порога попыткой хост отправляет событие `remediation-triggered`, а `RecordResultDto.remediation` содержит план. Элементы `reason: 'remediation'` попадают в `getBatch` и `plan.getDay` перед новым материалом, входят в `batchSize` и `maxItems` и вытесняют самые низкоприоритетные новые [ВЫВОД]. Пороги — предположения, спайка нет [НЕ ПОДТВЕРЖДЕНО, engine-ts.md §6a.5].

## 5. Кураторство и настройки

```ts
export interface FlagService {
  list(req?: PageRequest): Promise<Page<UnitId>>;
  has(unitId: UnitId): Promise<boolean>;
  add(unitId: UnitId): Promise<void>;
  remove(unitId: UnitId): Promise<void>;
  /** Раскрывает префикс в id на момент вызова и пишет по записи на юнит. */
  removePrefix(prefix: string): Promise<{ removed: UnitId[] }>;
}
export interface SavedFilterDto { id: string; description: string; filter: UnitFilterWire }
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

export interface MasteryWindowDto { percentage: number; range: [number, number] }
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
export interface RemediationOptionsDto { failThreshold: number; maxItems: number }
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
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface ScorerInfoDto {
  kind: 'fsrs-hybrid' | 'power-law';
  memoryModelId: string;
  ratingMap: 'runner' | 'anki';
  numTrials: number;
  parametersHash: string;
}
export interface PreferencesDto { ignoredPaths: string[]; schedulerBatchSize?: number }

export interface SettingsService {
  getScheduler(): Promise<SchedulerOptionsDto>;
  /** Валидирует (`verify` как при открытии), применяет ко всем компонентам сразу. */
  setScheduler(patch: DeepPartial<SchedulerOptionsDto>): Promise<SchedulerOptionsDto>;
  resetScheduler(): Promise<SchedulerOptionsDto>;
  getPreferences(): Promise<PreferencesDto>;
  setPreferences(prefs: PreferencesDto): Promise<{ restartRequired: boolean }>;
  getScorer(): Promise<ScorerInfoDto>;
  getUi(): Promise<UiSettingsDto>;
  /** Валидирует и сохраняет; возвращает итоговые настройки. */
  setUi(patch: UiSettingsPatch): Promise<UiSettingsDto>;
}

export type ThemeMode = 'system' | 'light' | 'dark';
/** `system` — язык системы; клиент сам выбирает из поддерживаемых. */
export type LocaleMode = 'system' | 'ru' | 'en';
/** Настройки интерфейса; хранятся вместе с остальными настройками в БД движка. */
export interface UiSettingsDto {
  theme: ThemeMode;
  locale: LocaleMode;
  /** Курс в фокусе: клиент передаёт его в `courseIds` плана и повторений (§4.1). Нет поля — все курсы. Движок не проверяет, что курс есть в библиотеке: курс могли убрать, клиент сверяет сам. */
  activeCourseId?: UnitId;
  /** Ширина панели теории в сессии и вход-тесте, px (`MATERIAL_WIDTH_RANGE`: 280…800). Нет поля — умолчание клиента. */
  materialWidth?: number;
  /** Панель теории скрыта. Нет поля — показана. */
  materialCollapsed?: true;
}
/** `activeCourseId: null` снимает фокус, `materialWidth: null` возвращает умолчание, `materialCollapsed: false` показывает панель. */
export type UiSettingsPatch = Partial<
  Omit<UiSettingsDto, 'activeCourseId' | 'materialWidth' | 'materialCollapsed'>
> & {
  activeCourseId?: UnitId | null;
  materialWidth?: number | null;
  materialCollapsed?: boolean;
};
```

Семантика:
- Изменения blacklist и review list — записи журнала (LWW), сбрасывают кэши оценок затронутых юнитов до ответа (порядок «запись → инвалидация», а не наоборот, как в Rust).
- `setScheduler` в Trane не вызывал `verify()` и не доходил до `UnitScorer`, `CandidateFilter`, `ReviewKnocker`, `RelearnPile` (у них клоны опций); в порте один holder, поведение покрыто тестом. Поля `numDeltas` в DTO нет: в Rust оно не читается.
- `setUi` меняет только переданные поля (`activeCourseId` — `null` снимает); пустой `activeCourseId`, `materialWidth` не целое или вне 280…800, `materialCollapsed` не логическое — `INVALID_ARGUMENT` (`details.field`); запись сопровождается событием `settings-changed` (`scope: 'ui'`). Настройки интерфейса не синхронизируются между устройствами.
- `ignoredPaths` применяется при следующем `library.reload()`; `setPreferences` возвращает `restartRequired`, если изменились пути данных.
- Настройки фильтров и сессий пишутся атомарно (tmp + rename) в `settings/`; читаются только `*.json`.
- `implicitCredit.*` меняет `MemoryIndex`: `setScheduler` пересобирает проекцию (событие `state-rebuilt`); rebuild 500k событий — 0.4 с без кредита, 1.1 с при разреженных явных `encompassed`, 17.6 с при «зависимость = охват @1.0» [ИЗМЕРЕНО в спайке], поэтому кредит идёт только по явно объявленным `encompassed`. Валидация (`verify`) как при открытии: диапазоны выше, `failThreshold`, `maxItems`, `maxSameCourseRun` — целые ≥ 1, `minTagDistance` — целое ≥ 0, `targetRetention` и `minNewFraction` в (0, 1) и [0, 1] [диапазоны — ВЫВОД].
- `durability` (`'full'` по умолчанию — WAL, `synchronous=FULL`, `fullfsync=ON` на macOS; `'normal'` — `NORMAL`) задаётся хостом в `EngineConfig` (§7) при открытии и через контракт не меняется.

## 6. Синхронизация

```ts
/** Вектор для дельта-экспорта: `{deviceId: contiguous}` — непрерывный префикс seq (1..contiguous без пропусков), не `maxSeq`. */
export type StateVector = Record<string, number>;
/** Дыры за префиксом по устройствам: seq, записи которых уже есть, но предыдущих нет. */
export type MissingSeqs = Record<string, number[]>;

/**
 * `at` — время события по HLC-правилу (engine-ts.md §5.1): `max(min(now, now + 5 мин), maxAtУвиденный + 1, свойПрошлыйAt)`.
 * Порядок везде `(at, deviceId, seq)`, при равных `(deviceId, seq)` — `id`. `recordedAt` — wall-clock записи, порядок не задаёт.
 */
interface LogEntryBaseDto { id: string; deviceId: string; seq: number; at: EpochMs; recordedAt: EpochMs }
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
export type LogEntryDto = AttemptEntryDto | UnitFlagEntryDto | ProgressResetEntryDto;

export interface SyncStateDto {
  deviceId: string;
  vector: StateVector;
  missing: MissingSeqs;
  entryCount: number;
  /** Неразрешённые конфликты. */
  conflictCount: number;
}
export interface ExportRequest { since?: StateVector; limit?: number }
export interface ExportResult { entries: LogEntryDto[]; next?: StateVector }
export interface ImportResult {
  inserted: number;
  duplicates: number;
  /** Структурно неверные записи. Конфликты (`id-content`, `seq-two-ids`, `clock-skew`) сюда не попадают. */
  rejected: Array<{ id: string; reason: string }>;
  /** Новые конфликты, обнаруженные этим импортом. */
  conflicts: number;
  rebuilt: boolean;
}
export interface RebuildResult { entries: number; ms: number }
export interface TraneImportResult { attempts: number; flags: number; skipped: number }

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
   * `'none'` — оставить скрытыми все. В `id-content` у сторон общий `id`: по `id` берётся первая сторона
   * в каноническом порядке `(at, deviceId, seq, id, entryHash)`, точную сторону выбирают по `entryHash`.
   */
  keep: string | 'none';
}
export interface ResolveConflictResult { conflictId: string; kept: string | null; rebuilt: boolean }

export interface FolderSyncConfigureRequest { dir: string }
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
```

Протокол «вручную» (транспорт вне области): устройство A вызывает `getState()`, отправляет B свой `vector`; B отвечает `exportSince({ since: vectorA })` (все записи с `seq` больше непрерывного префикса A, включая записи за дырами; дубли безвредны), при `next` продолжает с ним; A вызывает `import(entries)`. Слияние — объединение по `id` (идемпотентно), порядок применения не важен; если импортированные записи старше уже применённых, `rebuilt: true`. В `rejected` — только структурно неверные записи. Запись с тем же `id`, но другим содержимым, или с тем же `(deviceId, seq)`, но другим `id`, — **конфликт**: обе стороны уходят в карантин, скрыты от проекций, проекции пересобираются, отправляется событие `sync-conflict`; правило «отклонить входящую» не коммутативно (контрпример fast-check) [ИЗМЕРЕНО, `report-journal-sync.md`]. `importFromTrane` читает `practice_stats.db`, `blacklist.db`, `review_list.db` каталога `.trane` (секунды × 1000, `source: 'trane-import'`), `practice_deltas` и `practice_rewards` не переносятся (выводятся).

`resolveConflict` **локален**: решение живёт только в `log_conflict` этого устройства и на другие не реплицируется (в v1 репликации решений нет — другое устройство увидит свой конфликт и решит отдельно). Состояние строки `log_conflict.state`: `'open'` → `'kept'` (запись `keep` возвращается в журнал и проекции) или `'discarded'` (остальные записи, а при `keep: 'none'` — все); хэши отброшенных записей пропускаются при повторном импорте, поэтому конфликт не возвращается. Журнал ничего не удаляет. Неизвестный или уже решённый (`state ≠ 'open'`) `conflictId` — `SYNC_CONFLICT_NOT_FOUND`; `keep`, не входящий в `entries` конфликта, — `INVALID_ARGUMENT`. Записи с `at > recordedAt + 24 ч` попадают в конфликт `clock-skew` (`SyncConflictDto.reason`), а не в `rejected` [ВЫВОД]. Схема `log_conflict` не проверялась [НЕ ПОДТВЕРЖДЕНО, engine-ts.md §5.1].

### 6.1 Общая папка (`sync.folder`)

Транспорт F7 — `FolderSync` (engine-ts.md §6a.6): каждое устройство пишет только **свои** неизменяемые сегменты `<dir>/<deviceId>/seg-<first>-<last>.jsonl` и `head.json`; подходит папка файлового синхронизатора или Git. Сегмент применяется целиком или не применяется: неполные, обрезанные и пришедшие раньше `head` остаются в `pending`, `corruptSegments` — испорченные, `headErrors` — нечитаемые `head.json`; потерь нет (16 сценариев матрицы отказов [ИЗМЕРЕНО, `report-journal-sync.md`]). `folder.configure({ dir })` сохраняет путь в `dataDir/settings/sync.json` (JSON, запись атомарная, как остальные настройки); папка не должна совпадать с `dataDir` и каталогом БД, иначе `INVALID_ARGUMENT` [ВЫВОД]. `folder.sync()` без `configure` — `SYNC_FOLDER_NOT_CONFIGURED`. Если sha256 последнего объявленного сегмента не совпал с локальным (клон `deviceId`), `folder.sync()` бросает `SYNC_DEVICE_ID_CLASH`; UI вызывает `checkRestore()`. `checkRestore()` при старте: свой хвост в папке длиннее локального — `catch-up`; данных нет нигде — `fork` на новый `deviceId` (`newDeviceId`); иначе `none`. Незамеченное восстановление (пиры не видели, папка откатилась) не ловится: остаются конфликты `seq-two-ids`. iCloud, Syncthing, Dropbox и Git не проверялись [НЕ ПОДТВЕРЖДЕНО].

## 7. События и корневой интерфейс

```ts
export type EngineEvent =
  | { type: 'progress'; unitIds: UnitId[]; at: EpochMs }
  | { type: 'library-reloaded'; revision: string; errors: number; warnings: number }
  | { type: 'library-compiled'; revision: string; artifactWritten: boolean; errors: number; warnings: number }
  | { type: 'state-rebuilt'; entries: number; ms: number }
  | { type: 'sync-conflict'; conflictIds: string[]; unresolved: number }
  | { type: 'remediation-triggered'; exerciseId: UnitId; steps: number; at: EpochMs }
  | { type: 'settings-changed'; scope: 'scheduler' | 'preferences' | 'filters' | 'sessions' | 'blacklist' | 'reviewList' }
  | { type: 'repository-progress'; id: string; phase: 'resolve' | 'fetch' | 'export' | 'validate' | 'reload'; loaded?: number; total?: number }
  | { type: 'repository-updates-checked'; available: string[] };

/** Конфигурация хоста при открытии движка (`createEngine`); через RPC не передаётся и renderer её не меняет. */
export interface EngineConfig {
  libraryRoot: string;
  dataDir: string;
  /** По умолчанию `'full'`: WAL + `synchronous=FULL` + `fullfsync=ON` на macOS (≈ 3 мс на коммит [ИЗМЕРЕНО]); `'normal'` — `NORMAL`, может откатить последние коммиты. */
  durability?: 'full' | 'normal';
  /** Авторский режим: вердикт `failed` содержит `detail` (ожидаемые строки). По умолчанию false. */
  authorMode?: boolean;
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

export interface LearningEngine {
  readonly library: LibraryService;
  readonly practice: PracticeService;
  readonly curation: CurationService;
  readonly settings: SettingsService;
  readonly sync: SyncService;
  readonly plan: PlanService;
  readonly placement: PlacementService;
  readonly remediation: RemediationService;
  diagnostics(): Promise<EngineDiagnosticsDto>;
  /** In-process. По RPC — сообщения `events.subscribe` / `events.unsubscribe` и push `EngineEvent`. */
  subscribe(listener: (event: EngineEvent) => void): () => void;
  close(): Promise<void>;
}
```

События отправляются после завершения команды, батчами для одной команды (`progress.unitIds` содержит упражнение, урок и курс, оценки которых изменились). Слушатель не должен вызывать команды синхронно из обработчика. `library-compiled` — после `compile()` и после фоновой компиляции при открытии; `sync-conflict` — когда импорт (`import` или `folder.sync`) создал конфликты; `remediation-triggered` — когда попытка пересекла порог ремедиации (тот же план возвращается в `RecordResultDto.remediation`).

## 8. Коды ошибок

| Код | Когда | `retryable` |
|---|---|---|
| `INVALID_ARGUMENT` | Не прошла валидация аргументов (диапазон оценки, лимиты, `verify` опций) | нет |
| `NOT_FOUND` | Неизвестный юнит, фильтр, сессия | нет |
| `ENGINE_CLOSED` | Вызов после `close()` или до готовности хоста | да (после переподключения) |
| `INCOMPATIBLE_CONTRACT` | `CONTRACT_VERSION` хоста и renderer различаются | нет |
| `LIBRARY_NOT_LOADED`, `LIBRARY_INVALID` | Практика без библиотеки; библиотека с ошибками в строгом режиме | нет (после исправления курса — `reload`) |
| `ASSET_OUTSIDE_LIBRARY`, `ASSET_TOO_LARGE` | Путь вышел за корень; ассет больше 2 МБ | нет |
| `ATTEMPT_NOT_FOUND`, `ATTEMPT_CLOSED` | Попытка потеряна (TTL, рестарт хоста) или уже завершена другим исходом | нет |
| `VERIFIER_UNAVAILABLE` | Нет раннера для `runner` (`retryable: false`) либо пул раннера не поднят или остановлен (`retryable: true`); признак — `details.cause` | зависит |
| `VERIFIER_TIMEOUT` | Общий дедлайн `submitAnswer` (`timeoutMs` + запас пула, включая ожидание очереди) истёк до вердикта [ВЫВОД]. Проверка, превысившая `timeoutMs`, — **не исключение**, а `VerdictDto { outcome: 'error', reason: 'timeout' }` (повтор разрешён, журнал не затронут) | да |
| `PLACEMENT_SESSION_NOT_FOUND` | Сессия вход-теста неизвестна, завершена или потеряна при рестарте хоста | нет |
| `PLACEMENT_SESSION_ACTIVE` | `placement.start` при уже активной сессии профиля (одна сессия на профиль, [ВЫВОД]) | нет (`abort` или `finish` активной) |
| `PLACEMENT_BUDGET_EXHAUSTED` | `answer` после исчерпания бюджета проб или на пробу, ответ на которую уже принят | нет |
| `SYNC_DEVICE_ID_CLASH` | Папка синхронизации содержит другой последний сегмент этого `deviceId` (клон или бэкап); нужен `folder.checkRestore()` | нет |
| `SYNC_CONFLICT_NOT_FOUND` | Конфликт неизвестен или уже решён | нет |
| `SYNC_FOLDER_NOT_CONFIGURED` | `folder.sync()` или `folder.checkRestore()` до `folder.configure()` | нет |
| `STORE_BUSY` | `SQLITE_BUSY`: второй процесс-писатель | да |
| `STORE_READONLY`, `STORE_CORRUPT` | БД только для чтения; порча (движок остаётся в режиме чтения журнала) | нет |
| `INTERNAL` | Ошибка движка; состояние помечено `dirty`, перестройка при следующем чтении | да |
| `REPOSITORY_EXISTS` | `repositories.add` для URL, который уже в реестре (`details.id`) | нет |
| `REPOSITORY_REJECTED` | Снимок нарушает правила (`details.reason`: `symlink`, `path-escapes`, `git-segment`, `unsafe-name`, `case-collision`, `special-file`, `too-many-files`, `too-large`, `file-too-large`), в нём нет курсов или ни одного из выбранных (`no-courses`), сканер нашёл ошибки (`invalid-library`, `reload-rejected`; `details.diagnostics` ≤ 50), каталог `repositories/<id>` занят (`path-conflict`), выбранных курсов нет в коммите (`unknown-course`, `details.courseIds`) или выбранным нужны невыбранные (`missing-requirement`, `details.requirements`: `id` выбранного → недостающие `id`) | нет |
| `GIT_FETCH_FAILED` | Сеть или сервер; `details.reason`: `not-found`, `auth-required`, `ref-not-found`, `timeout`, `network`, `too-large`, `cancelled` | да для `network`, `timeout`, `cancelled` |

## 9. Транспорт (справочно; обвязка вне области)

Требования к хосту: один `MessagePort` на клиента; вызовы сериализуются в порядке получения (движок однопоточен и внутри команды синхронен); ответы содержат `id` запроса. Рекомендуемое размещение — `utilityProcess` (официальная рекомендация Electron для CPU-нагрузки и «SQLite-сервера»; нативные модули и ESM в нём работают [ИЗМЕРЕНО]); при падении хоста main перезапускает его (авто-перезапуска нет), renderer повторяет идемпотентные запросы.

```ts
export interface RpcRequest { id: string; method: string; params?: unknown }
export type RpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: EngineErrorDto };
export interface RpcPush { event: EngineEvent }
```

`method` — `"<сервис>.<метод>"`, например `practice.getBatch`, `curation.blacklist.add`. Валидация входящих параметров — схемами zod на стороне хоста (renderer не доверенный вход).

**Раннер SQL не часть контракта.** Пул проверок — дочерние процессы (`child_process.fork`; в Electron `utilityProcess`), живущие рядом с хостом движка; renderer до них не достаёт, по RPC видны только `beginAttempt`/`submitAnswer` и `VerdictDto` (протокол пула — внутренний: `{type:'check'}` → `{type:'verdict'}`). Откуда хост порождает процессы (внутри `utilityProcess` или через main) не проверено в Electron 44 [НЕ ПОДТВЕРЖДЕНО, §13]. Кап `MAX_SQL_CHARS = 100_000` символов хост применяет **до IPC** раннера: длиннее — `failed/sqlite_limit` с `durationMs: 0`, раннер не запускается. Молчание процесса дольше `timeoutMs + 100 мс` — kill и `outcome: 'error'`, `reason: 'timeout'`. `submitAnswer` с `outcome: 'error'` ничего не пишет и `attemptsUsed` не увеличивает; журнал пишет только `completeAttempt`. Сессии `placement` и открытые попытки живут в памяти хоста и теряются при его падении; после перезапуска renderer повторяет только идемпотентные вызовы (`placement.finish` по `requestId`).

RPC-имена новых методов: `plan.getDay`, `placement.start`, `placement.nextProbe`, `placement.answer`, `placement.finish`, `placement.abort`, `remediation.getPlan`, `library.validate`, `library.compile`, `sync.getConflicts`, `sync.resolveConflict`, `sync.folder.configure`, `sync.folder.sync`, `sync.folder.checkRestore`. Длинные вызовы (`library.compile` с `runChecks`, `folder.sync`) хост не выполняет синхронно в одной итерации: остальные команды ждут в очереди порядка получения [ВЫВОД].

## 10. Лимиты

| Параметр | Значение |
|---|---|
| Страница списка | по умолчанию 100, максимум 500 |
| `getGraph` | по умолчанию 500 узлов, максимум 2 000 |
| `readAsset` | ≤ 2 МБ текста |
| Открытые попытки | ≤ 100, TTL 24 ч |
| `exportSince` | ≤ 5 000 записей за вызов |
| Манифест | ≤ 1 МБ |
| Размер `getBatch` | по опциям (по умолчанию 50 + relearn ≤ 5) |
| `plan.getDay` | `maxItems` от 1 до 200 (замерены 40 и 200) |
| `validate` | страница диагностик — как у списков (100 / 500) |
| `placement.start` | `budget` — целое 1..200; одна активная сессия на профиль; TTL сессии 24 ч; сессии только в памяти хоста [ВЫВОД] |
| SQL ученика | ≤ `MAX_SQL_CHARS` = 100 000 символов; по умолчанию раннера `timeoutMs 2000`, `maxRows 10 000`, `maxBytes 1 МБ` |

## 11. Соответствие методам Trane

| Rust (`Trane`) | API |
|---|---|
| `new_local*`, `library_root` | `createEngine(...)`, `library.getInfo().root` |
| `get_{course,lesson,exercise}_manifest`, `get_*_ids`, `get_all_exercise_ids` | `library.getUnit`, `list*` |
| `get_matching_prefix` | `library.matchPrefix` |
| `get_unit_type`, `get_dependencies`, `get_dependents`, `get_encompasses`, `get_superseded_by`… (16 читающих методов графа) | поля `UnitDto` и `library.getGraph` |
| `check_cycles`, `generate_dot_graph` | `library.getDiagnostics`, `library.validate` (циклы с путём `E_CYCLE_*`); DOT не экспортируем |
| `get_exercise_batch(filter)` | `practice.getBatch` |
| `score_exercise` | `practice.recordAttempt` / `completeAttempt` |
| `get_unit_score` | `practice.getUnitScore` |
| `get_scores` | `practice.getAttempts` |
| `remove_scores_with_prefix` | `practice.resetProgress` (запись `progress_reset`) |
| `add/remove/removePrefix`, `blacklisted`, `get_blacklist_entries` | `curation.blacklist.*` |
| `add_to_review_list`, `remove_from_review_list`, `get_review_list_entries` | `curation.reviewList.*` |
| `get_filter`, `list_filters` (+ новое `save`, `delete`) | `curation.filters.*` |
| `get_study_session`, `list_study_sessions` (+ `save`, `delete`) | `curation.sessions.*` |
| `get/set/reset_scheduler_options` | `settings.getScheduler/setScheduler/resetScheduler` |
| `get_user_preferences`, `set_user_preferences` | `settings.getPreferences/setPreferences` |
| `override_current_timestamp` | заменён инъекцией `Clock` в `createEngine` |
| `record_*`, `trim_*`, мутаторы графа, `invalidate_*`, `get_scheduler_data` | не экспортируются |
| нет (в Trane нет; расширение engine-ts) | `library.validate`, `library.compile` |
| нет (Trane не отдаёт фронтир и due) | `practice.getFrontier`, `practice.getDue` |
| нет (детерминированная проверка; Trane оценки не выводит) | `practice.beginAttempt/submitAnswer/completeAttempt` |
| нет | `plan.getDay` |
| нет | `placement.start/nextProbe/answer/finish/abort` |
| нет (в Trane ремедиации нет, аудит v0.34.1) | `remediation.getPlan`, `RecordResultDto.remediation` |
| нет (у Trane нет синхронизации) | `sync.getConflicts`, `sync.resolveConflict`, `sync.folder.*` |
| — (нового нет в Rust; прочее) | `practice.startSession`, `sync.getState/exportSince/import/rebuild`, `diagnostics` |

## 12. Пример сценария (справочно)

```ts example
const { sessionId } = await engine.practice.startSession();
const { exercises } = await engine.practice.getBatch();
const first = exercises[0]!;
const attempt = await engine.practice.beginAttempt({ exerciseId: first.id });
if (attempt.verifiable) {
  const verdict = await engine.practice.submitAnswer({ attemptId: attempt.attemptId, submission: { kind: 'sql', sql: 'select 1' } });
  if (verdict.outcome !== 'error') await engine.practice.completeAttempt({ attemptId: attempt.attemptId });
} else {
  await engine.practice.completeAttempt({ attemptId: attempt.attemptId, grade: 4 });
}
```

Вход-тест (placement) и план дня:

```ts example
const { sessionId } = await engine.placement.start({ courseIds: ['sql'], budget: 40, seed: 1 });
for (let probe = await engine.placement.nextProbe(sessionId); probe !== null; probe = await engine.placement.nextProbe(sessionId)) {
  const unit = await engine.library.getUnit(probe.exerciseId);
  if (unit.kind === 'exercise' && unit.verification !== undefined) {
    const attempt = await engine.practice.beginAttempt({ exerciseId: probe.exerciseId });
    const verdict = await engine.practice.submitAnswer({ attemptId: attempt.attemptId, submission: { kind: 'sql', sql: 'select 1' } });
    if (verdict.outcome !== 'error') {
      await engine.placement.answer({ probeId: probe.probeId, result: { kind: 'attempt', attemptId: attempt.attemptId } });
      continue;
    }
    // error не считается ответом: самооценка вместо проверки (открытая попытка истечёт по TTL)
  }
  await engine.placement.answer({ probeId: probe.probeId, result: { kind: 'grade', grade: 2 } });
}
const summary = await engine.placement.finish({ sessionId, requestId: 'placement-1' });
const plan = await engine.plan.getDay({ maxItems: 40, seed: 1 });
```

## 13. Открытое

1. Нужен ли `getBatch({ peek: true })` без увеличения счётчика показов (для предзагрузки в UI)?
2. Форма `getGraph` для визуализации больших графов: серверная кластеризация или только окрестность `rootIds` с `depth`?
3. **Решено (2026-09-30):** `GradePolicy` по умолчанию `passAtN` (`pass@1 → 5`, `pass@2 → 4`, `pass@3+ → 3`, отказ → 1), без настройки в курсе и в UI. Конфигурируемость (`engine-ts.md` §12.4) — после калибровки на реальных ответах.
4. Нужен ли `library.searchText` (полнотекстовый поиск): сейчас только префикс id.
5. **Решено (2026-09-30):** экран «сегодня» зовёт `getDay`; `getBatch` — свободная практика с фильтрами и сессиями (паритет Trane). Контракт держит оба. `getFrontier` проверен против Rust (T-49): эталон — `get_exercise_batch`, а не `get_candidates`.
6. **Решено (2026-09-30):** `resolveConflict` остаётся локальным, UI не строится, репликации решений нет (v1); из контракта метод не убираем. Сторона `id-content` выбирается по `entryHash` (`SyncConflictDto.entryHashes`).
7. DDL/DML-уроки SQL (engine-ts.md §12.16): `SubmissionDto` `{kind:'sql'}` — одна проба; режим «скрипт + проба» не спроектирован, такие уроки пока без автопроверки.
8. **Решено (2026-09-30):** placement на проверках с угадыванием — `minPass = 2` скрыт в движке (фиксируется на `start`: 2, если у пробы хоть одной темы нет `engine.verification`, иначе 0); признак в `PlacementProbeDto` не добавляем, при необходимости добавляется аддитивно.
9. **Принято:** `placement.answer` для проверяемых проб принимает `{ kind: 'attempt' }` (результат открытой попытки), а не вердикт, чтобы renderer не подделывал `passed`. `placement.finish` эмитит событие `progress` (журнал изменился) — отличие от первоначального «placement событий не эмитит».
10. Порог `clock-skew`: реализовано два правила — `at > recordedAt + 24 ч` (дизайн) и `at > now получателя + 24 ч` при импорте (ловит устройство с часами 2099, у которого `at ≈ recordedAt`). Недостаток: при честном перекосе двух устройств на ≥ 24 ч записи здорового устройства, поднятые HLC-правилом, тоже попадают в карантин; сходимость проверена при перекосе ±10 ч, на ±1 сутки — только порядок ключей (T-23а) [ИЗМЕРЕНО тестами M4; поведение реальных файловых синхронизаторов не проверялось].
11. Лимиты placement (одна сессия на профиль, `budget` 1..200, TTL 24 ч), вытеснение новых элементов ремедиацией и папка `sync.json` — предположения основного документа [ВЫВОД]; пересмотреть по реальному использованию.
