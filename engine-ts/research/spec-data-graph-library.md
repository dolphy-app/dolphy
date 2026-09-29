# Spec: data model, unit graph, course library, knowledge-base generator, errors, course builders (Trane v0.34.1 → TS)

Источник: `spike/trane-fsrs/trane-pristine/src/` (read-only). Ссылки `file:line` — на этот каталог. Все утверждения «наблюдено» подтверждены запуском зонда `engine-ts/spike/probes/spec-data-graph-library/` (Rust-крейт, зависит от `trane` по path; вывод — `probe-output.txt`, `cyclefuzz-output.txt`); «из кода» — прочитано в исходниках; `[НЕ ПОДТВЕРЖДЕНО]` — не проверено.

> **Путь (2026-09-29):** источник теперь `engine-ts/reference/trane-pristine/src/` (был `spike/trane-fsrs/trane-pristine/`), тестовый курс `spike/trane-mvp/lib_json/…` теперь `engine-ts/reference/sql-course/lib_json/…`; старые каталоги удалены. Ссылки `file:line` не изменились.
Условные обозначения: `Ustr` → `string`; время/RNG в этих модулях **не используются** (см. §5 каждого модуля).

Охват (LOC = строки файла; «тест» — от `#[cfg(test)]` до конца):

| Файл | всего | не-тест | тест | `#[test]` |
|---|---|---|---|---|
| `data.rs` | 1587 | 1122 (из них ≈250 — scheduler options, 836–1084, вне охвата) | 465 | 29 |
| `graph.rs` | 1335 | 777 | 558 | 17 |
| `course_library.rs` | 792 | 651 | 141 | 3 |
| `data/course_generator.rs` | 10 | 10 | 0 | 0 |
| `data/course_generator/knowledge_base.rs` | 1276 | 702 | 574 | 14 |
| `error.rs` | 158 | 158 | 0 | 0 |
| `course_builder.rs` | 337 | 216 | 121 | 4 |
| `course_builder/knowledge_base_builder.rs` | 996 | 432 | 564 | 6 |
| `data/course_generator/literacy.rs` (пропущен) | 1641 | 750 | 891 | 8 |
| `data/course_generator/transcription.rs` (+`transcription/constants.rs` 117 стр., `course_instructions.md` 83 стр.) (пропущен) | 1679 | 861 | 818 | 18 |

---
# A. `data.rs` — модель данных

## A.1 Назначение и публичная поверхность
Чистые данные + три трейта обработки путей/метаданных. Все типы `Clone, Debug, Deserialize, Serialize, PartialEq`; манифесты дополнительно `derive_builder::Builder` (только для Rust-тестов/`course_builder`; в TS — обычные фабрики/спред).

Предлагаемые TS-сигнатуры (zod 4 — источник истины, типы через `z.infer`):
```ts
export type UnitId = string;                       // Ustr
export type UnitType = 'Exercise' | 'Lesson' | 'Course';
export type Metadata = Record<string, string[]>;   // BTreeMap<String, Vec<String>>; сериализовать с отсортированными ключами
export type Encompassed = ReadonlyArray<readonly [UnitId, number]>;   // Vec<(Ustr, f32)> = JSON [["id", 0.5]]

export interface NormalizePaths<T> { normalizePaths(libraryRoot: LibPath, manifestRoot: LibPath): T }   // чистая, бросает Error
export interface VerifyPaths       { verifyPaths(root: LibPath): Promise<boolean> | boolean }           // I/O: см. §A.5
export const normalizePath: (libraryRoot: LibPath, manifestRoot: LibPath, pathStr: string) => string;
export const unitTypeOf: (m: CourseManifest | LessonManifest | ExerciseManifest) => UnitType;          // GetUnitType
export const metadataOf: (m: CourseManifest | LessonManifest) => Metadata | null;                     // GetMetadata (у Exercise метаданных НЕТ)
```
`GenerateManifests`/`CourseGenerator`/`GeneratedCourse` — §D. Вне охвата (другой спек): `SchedulerOptions`, `PassingScoreOptions`, `MasteryWindow`, `FULL_CANDIDATES_SCORE` (data.rs:836–1084), `data/filter.rs`.

## A.2 Состояние и коллaборанты
Состояния нет. Потребители: `course_library` (нормализация/верификация/парсинг), `graph` (только `UnitType`), генераторы, `practice_*`/`scheduler` (`ExerciseTrial/Delta/Reward/Score`, `MasteryScore`).

## A.3 Схемы JSON (wire-формат; serde без `deny_unknown_fields` — `grep deny_unknown_fields src` пуст)
**Общие правила serde (наблюдено, probe §2):**
- Неизвестные поля **молча игнорируются** на любом уровне (`{"id":"c","bogus":1}` → OK; подтверждено также `docs/research/trane-spike.md:130`) → в zod использовать обычный `z.object` (strip), НЕ `strictObject`.
- Enum — **externally tagged**: unit-вариант = JSON-строка (`"Procedural"`), newtype/struct-вариант = объект ровно с одним ключом-именем варианта (`{"FlashcardAsset":{…}}`). Два ключа/строка вместо объекта/неизвестный вариант → ошибка. Регистр важен (`"procedural"` → ошибка `unknown variant \`procedural\`, expected \`Declarative\` or \`Procedural\``).
- `#[serde(default)]` на поле = поле можно опустить; `null` для не-`Option` поля (`dependencies:null`, `name:null`) — **ошибка**. `Option<T>` принимает и отсутствие, и `null`.
- Кортежи `(A,B)` = JSON-массив ровно из 2 элементов (длина 1 → ошибка, 3 → ошибка); объектная форма `{"id":..}` → ошибка.
- `f32` принимает JSON-целые (`1` → `1.0`); `i64`/`usize` не принимают дробные (`timestamp:1.5` → ошибка `expected i64`). Сериализация f32 — кратчайшая десятичная (`0.1` → `0.1`, `1.0` → `1.0`).
- Порядок ключей при сериализации = порядок объявления полей (см. примеры); важно только для golden-файлов.
- Дубликаты в `Vec` сохраняются (`"dependencies":["a","a"]` → `["a","a"]`); дедупликация происходит в графе (set).

### A.3.1 `CourseManifest` (data.rs:358–438)
| поле | JSON-тип | serde default | обязательно | смысл |
|---|---|---|---|---|
| `id` | string | — | **да** | ID курса (`music::instrument::guitar::basic_jazz_chords`); пустая строка парсится, но loader отвергает (C.3 п.7) |
| `name` | string | `""` | нет | отображаемое имя |
| `dependencies` | string[] | `[]` | нет | ID курсов/уроков-пререквизитов |
| `encompassed` | [string, number][] | `[]` | нет | охватываемые юниты с весом; по умолчанию каждая зависимость охвачена с весом 1.0; запись нужна для (а) охвата не-зависимости, (б) зависимости с весом 0.0 |
| `superseded` | string[] | `[]` | нет | вытесняемые юниты |
| `description` | string\|null | `None` | нет | |
| `authors` | string[]\|null | `None` | нет | |
| `metadata` | {string: string[]}\|null | `None` | нет | теги для фильтров сессий |
| `course_material` | BasicAsset\|null | `None` | нет | |
| `course_instructions` | BasicAsset\|null | `None` | нет | |
| `generator_config` | CourseGenerator\|null | `None` | нет | если задан — loader вызывает генератор (§C) |

### A.3.2 `LessonManifest` (data.rs:488–554)
`id` (string, **обязательно**); `course_id` (string, **обязательно**); `dependencies` `[]`; `encompassed` `[]`; `superseded` `[]`; `name` `""`; `description` null; `metadata` null; `lesson_material` BasicAsset\|null; `lesson_instructions` BasicAsset\|null. Порядок сериализации: `id, dependencies, encompassed, superseded, course_id, name, description, metadata, lesson_material, lesson_instructions`.

### A.3.3 `ExerciseManifest` (data.rs:757–792)
| поле | тип | default | обяз. | смысл |
|---|---|---|---|---|
| `id` | string | — | да | |
| `lesson_id` | string | — | да | |
| `course_id` | string | — | да | |
| `name` | string | `""` | нет | |
| `description` | string\|null | None | нет | |
| `exercise_type` | `"Declarative"`\|`"Procedural"` | `Procedural` (`#[default]`, data.rs:353) | нет | |
| `exercise_asset` | ExerciseAsset | — | **да** (`missing field \`exercise_asset\``) | |
Метаданных/зависимостей у exercise нет (нельзя фильтровать по metadata упражнения).

### A.3.4 `BasicAsset` (data.rs:235–255), `ExerciseAsset` (data.rs:599–674) — точный wire
Все примеры — наблюдённый вывод serde_json (probe §1) либо реальные файлы (`tests/embedded_test_library/…`, `spike/trane-mvp/lib_json/…`).
| вариант | поля (default) | wire |
|---|---|---|
| `BasicAsset::MarkdownAsset` | `path` string (обяз.) | `{"MarkdownAsset":{"path":"course.material.md"}}` (реальный: embedded `course_manifest.json`) |
| `BasicAsset::InlinedAsset` | `content` string | `{"InlinedAsset":{"content":"x"}}` |
| `BasicAsset::InlinedUniqueAsset` | `content` `Ustr` | `{"InlinedUniqueAsset":{"content":"x"}}` (в TS = string; интернирование не нужно) |
| `ExerciseAsset::BasicAsset(BasicAsset)` (newtype → **двойная вложенность**) | — | `{"BasicAsset":{"InlinedAsset":{"content":"---\ncheck:…"}}}` (реальный: `trane-mvp/lib_json/sql_json/join/q3/exercise_manifest.json`) |
| `FlashcardAsset` | `front_path` string (обяз.), `back_path` string\|null (default None) | `{"FlashcardAsset":{"front_path":"front.md","back_path":"back.md"}}` (реальный: embedded `exercise_manifest.json`); без back: `"back_path":null` или ключ опущен |
| `InlineFlashcardAsset` | `front_content` string (обяз.), `back_content` string\|null (None) | `{"InlineFlashcardAsset":{"front_content":"F","back_content":null}}` |
| `LiteracyAsset` | `lesson_type` `"Reading"`\|`"Dictation"` (обяз.), `examples` `[string, string\|null][]` (`[]`), `exceptions` то же (`[]`) | `{"LiteracyAsset":{"lesson_type":"Reading","examples":[["a",null],["b","B"]],"exceptions":[]}}` |
| `SoundSliceAsset` | `link` string (обяз.), `description` string\|null, `backup` string\|null (путь MusicXML) | `{"SoundSliceAsset":{"link":"https://www.soundslice.com/slices/QfZcc/","description":"d","backup":null}}` |
| `TranscriptionAsset` | `content` string (`""`), `external_link` `TranscriptionLink`\|null | `{"TranscriptionAsset":{"content":"c","external_link":{"YouTube":"https://youtu.be/x"}}}`; `{"TranscriptionAsset":{}}` валиден |
Ошибка неизвестного варианта (наблюдено): ``unknown variant `SqlAsset`, expected one of `BasicAsset`, `FlashcardAsset`, `InlineFlashcardAsset`, `LiteracyAsset`, `SoundSliceAsset`, `TranscriptionAsset` ``. «Плоская» форма `{"MarkdownAsset":"m.md"}` → ошибка.

### A.3.5 `ExerciseType`, `UnitType`, `MasteryScore`
- `ExerciseType`: `"Declarative" | "Procedural"`; default `Procedural`.
- `UnitType`: `"Exercise" | "Lesson" | "Course"`; `Display` = то же имя (data.rs:163–172) — используется в тексте ошибок графа.
- `MasteryScore`: `"One"|"Two"|"Three"|"Four"|"Five"`. `float_score()` → 1.0…5.0 (data.rs:61–69). `TryFrom<f32>`: `|score − k| < f32::EPSILON` (=1.1920929e-7) для k∈{1..5}, иначе `Err(())` (data.rs:80–98). TS: `Math.abs(s-k) < 1.1920929e-7` (НЕ `Number.EPSILON`).

### A.3.6 Практические DTO (не манифесты; хранятся в SQLite/возвращаются API)
| тип | поля | wire (наблюдено) |
|---|---|---|
| `ExerciseTrial` (`Default`) | `exercise_id` str, `score` f32, `timestamp` **i64 секунды** | `{"exercise_id":"e","score":4.5,"timestamp":1700000000}` |
| `ExerciseDelta` (`Default`) | `exercise_id`, `delta` f32, `timestamp` i64 | `{"exercise_id":"e","delta":-0.5,"timestamp":1}` |
| `UnitReward` | `unit_id`, `value` f32 (может быть <0), `weight` f32, `timestamp` i64 | `{"unit_id":"u","value":0.1,"weight":1.0,"timestamp":1}` |
| `ExerciseScore` | `value` f32 `#[serde(default)]` (0..5), `urgency` f32 default (0..1), `velocity` f32\|null default None | `{"value":3.0,"urgency":0.1,"velocity":null}`; `{}` → нули |
В порте: `timestamp` → epoch **ms** (конвенция порта); wire-совместимость нужна только для манифестов, не для этих DTO.

### A.3.7 Предпочтения (data.rs:1085–1121)
| тип.поле | тип | default | смысл |
|---|---|---|---|
| `SchedulerPreferences.batch_size` | usize\|null | None | переопределяет `SchedulerOptions.batch_size` |
| `RepositoryMetadata` `{id, url}` | string, string | обяз. оба | описание git-репозитория курсов (используется `RepositoryManager`, который в этот спек не входит) |
| `UserPreferences.transcription` | `TranscriptionPreferences`\|null | None | `{instruments:[{name,id}] ([]), download_path\|null, download_path_alias\|null}` |
| `UserPreferences.scheduler` | `SchedulerPreferences`\|null | None | |
| `UserPreferences.ignored_paths` | string[] | `[]` | пути относительно корня библиотеки; см. C.3 п.4 |
`UserPreferences::default()` сериализуется `{"transcription":null,"scheduler":null,"ignored_paths":[]}`; `{}` валиден.

## A.4 Алгоритмы

### A.4.1 `normalize_path(library_root, manifest_root, path_str)` (data.rs:186–207)
```ts
function normalizePath(libraryRoot: LibPath, manifestRoot: LibPath, pathStr: string): string {
  const resolved = join(manifestRoot, pathStr).asStr();                 // семантика vfs::VfsPath::join, ниже
  const lib = libraryRoot.asStr().replace(/\/+$/, '');                  // trim_end_matches('/')
  if (lib === '') return resolved.replace(/^\/+/, '');                  // корень VFS = корень библиотеки
  if (!resolved.startsWith(lib)) throw new Error(`asset path ${resolved} is outside the library root`);
  const rem = resolved.slice(lib.length);
  if (!(rem === '' || rem.startsWith('/'))) throw new Error(`asset path ${resolved} is outside the library root`);
  return rem.replace(/^\/+/, '');
}
```
`vfs 0.13 join_internal` (docs.rs/vfs/0.13.0/src/vfs/path.rs, стр. 48–92, прочитано): пустой `path` → `in_path`; `path` с `/` в начале → база `""` (абсолют = от корня VFS); `path.len()>1` и оканчивается на `/` → `InvalidPath` (наблюдено: `An error occurred for 'd/': The path is invalid`); компоненты `""`,`.` пропускаются; `..` снимает последний накопленный компонент, а если их нет — берёт `parent(base)` (у корня `parent("")==""`, т.е. **`..` на корне «залипает» без ошибки**); результат — `base + "/" + компонент…`; корень = `""`.
Наблюдено (probe §4): asset `../../x.md` из `c1/` при корне VFS = корень библиотеки **загружается успешно** (клэмп к корню → `x.md`); `/x.md` = относительно корня библиотеки (тест `soundslice_normalize_paths`: `"/backup"`→`"backup"`; `normalize_absolute_path`: `/absolute/path`→`absolute/path`). Ошибка «outside the library root» возможна только когда `library_root ≠ корень VFS` (тесты `normalize_bad_path`, `normalize_path_rejects_root_prefix_collision`: `/library_backup` vs `/library`). ⚠ **Решение для порта**: `LibraryFs` корнем VFS считает корень библиотеки ⇒ клэмп даёт «путь не выходит за корень» автоматически, но манифест может ссылаться на **чужие** файлы внутри библиотеки; выход за пределы корня невозможен. Сохранить клэмп-семантику (wire-совместимость с реальными курсами).

### A.4.2 `NormalizePaths` по типам
- `BasicAsset`: `MarkdownAsset{path}` → `MarkdownAsset{path: normalize_path(..)}`; Inlined* без изменений.
- `CourseManifest`: нормализует `course_instructions`, `course_material` (остальное — clone). `LessonManifest`: `lesson_instructions`, `lesson_material`. `ExerciseManifest`: `exercise_asset`.
- `ExerciseAsset`: `BasicAsset(a)`→нормализовать `a`; `FlashcardAsset` → `front_path` и (если есть) `back_path`; `SoundSliceAsset` → только `backup` (если есть); `InlineFlashcardAsset`, `LiteracyAsset`, `TranscriptionAsset` — без изменений.
- Нормализация **не проверяет существование** (тест `normalize_good_path` использует пустую tempdir).

### A.4.3 `VerifyPaths` (`root` = корень библиотеки; `is_file()`)
`MarkdownAsset` → `root.join(path).is_file()`; Inlined* → `true`; `FlashcardAsset` → front is_file AND (back is_file если задан); `InlineFlashcardAsset`/`Literacy`/`Transcription` → `true`; `SoundSliceAsset` → `true` без `backup`, иначе `backup` is_file. Course/Lesson: `instructions` AND `material` (None=true); Exercise: делегирует ассету. Каталог вместо файла → `false` (`is_file`, не `exists`). Ошибка `root.join(..)` (напр. путь с `/` на конце) → `Err` (а не `false`).

### A.4.4 Константы
В охватываемой части `data.rs` констант нет (единственная — `FULL_CANDIDATES_SCORE: f32 = 4.0`, data.rs:837, относится к scheduler options; `f32::EPSILON`-сравнения см. A.3.5). Имена файлов манифестов — `course_library.rs:26,29,32` (C.4).

## A.5 Граничные случаи и инварианты
- `id`/`lesson_id`/`course_id` синтаксически — любая строка; пустоту проверяет только loader (C.3 п.7, п.9c, п.9d).
- `encompassed` хранится как `[id, weight]`; диапазон веса проверяется **в графе**, не при парсинге (`encompassed:[["x",1.5]]` парсится; loader падает в `add_encompassed`, наблюдено).
- `GetMetadata` есть только у Course/Lesson. `GetUnitType` — у всех трёх.
- `GeneratedCourse { lessons: (LessonManifest, ExerciseManifest[])[]; updated_metadata: Metadata|null; updated_instructions: BasicAsset|null }` (data.rs:301–310; `PartialEq`, не `Serialize`).

## A.6 Randomness / time / I/O и швы
`verify_paths` — единственный I/O (синхронные `is_file`). Шов: интерфейс `LibraryFs` (§C.5). Нормализация — чистая функция строк, тестируется без FS (нужен лишь `libraryRoot.asStr()`).

## A.7 Rust-идиомы → решения
| идиома | решение |
|---|---|
| `Ustr` (интернирование, `Ord` = лексикографическое по `str` — `ustr` master `lib.rs` `impl Ord for Ustr`; версия 1.1.0 `[НЕ ПОДТВЕРЖДЕНО]`) | `string`; сортировка `a < b ? -1 : …` по UTF-16 code units совпадает с UTF-8-порядком, кроме символов вне BMP `[вывод]` |
| serde external tagging | zod `z.union` из `z.object({Variant: …})` (по одному ключу) + unit-варианты `z.enum([...])` |
| `#[serde(default)]` | `.default(...)`; `Option<T>` = `.nullish().transform(v => v ?? null)` (в канонической форме хранить `null`, не `undefined`, для golden-сравнения с Rust-выводом) |
| `(Ustr,f32)` | `z.tuple([z.string(), z.number()])` |
| `f32` | `number` (f64). Значения из JSON: `0.1` в f32 ≠ f64 — сравнения по `< 1.19e-7` только там, где Rust так делает |
| `derive_builder::Builder` | не переносить; фабрики в тестовых утилитах (§F) |
| `TryFrom<f32> for MasteryScore` | функция `masteryScoreFromFloat(x): MasteryScore \| null` |
| `anyhow::Result<bool>` в `verify_paths` | `boolean`, ошибки — исключения |
| `Display for UnitType` | строковое значение самого union |

## A.8 TEST INVENTORY — `data.rs` (29)
| `#[test]` | что проверяет | портируемость | vitest |
|---|---|---|---|
| `score_to_float` | One..Five → 1.0..5.0 | direct | `it.each` |
| `float_to_score` | 1.0..5.0 → варианты; вне диапазона → Err | direct | `it.each` + `null` для 0/6/NaN |
| `get_unit_type` | Course/Lesson/Exercise манифесты → UnitType | direct | `expect(unitTypeOf(m))` |
| `soundslice_normalize_paths` | backup None не меняется; `/backup` → `backup` (PhysicalFS tmp) | needs fixtures (FS) → in-memory `LibraryFs` | fake FS |
| `soundslice_verify_paths` | backup None → true; `./bad_file` → false | needs fixtures | fake FS |
| `flashcard_verify_paths` | front-only, front+back существуют → true; inline → true | needs fixtures | fake FS |
| `literacy_verify_paths` | LiteracyAsset → true | direct | |
| `unit_type_display` | имена | direct (тривиально; **пропустить** — union-строки) | skip |
| `normalize_good_path` | `asset.md` в `course/` → `course/asset.md` | direct (строки) | |
| `normalize_path_trims_library_root_prefix` | root `/library`, → `course/asset.md` | direct | |
| `normalize_absolute_path` | `/absolute/path` → `absolute/path` | direct | |
| `normalize_bad_path` | `../../outside` при root `/library` → ошибка | direct | `toThrow(/outside the library root/)` |
| `normalize_path_rejects_root_prefix_collision` | `/library_backup` vs `/library` → ошибка | direct | |
| `default_exercise_type` | default = Procedural | direct (тривиально) — покрыть через zod default | |
| `repository_metadata_clone`, `user_preferences_clone`, `exercise_trial_clone`, `unit_reward_clone` | `clone()==` (написаны для coverage) | **skip** (бессмысленны в TS) | — |
| 11 тестов scheduler options: `valid_default_scheduler_options`, `scheduler_options_invalid_{batch_size,relearn_fraction,mastered_window,new_window,percentage_sum,passing_score}`, `scheduler_options_gap_in_windows`, `verify_passing_score_options`, `verify_passing_score_options_invalid`, `verify_scheduler_options_zero_max_lessons` | валидация `SchedulerOptions::verify` | **вне охвата** (спек планировщика) | — |
**Нет в Rust, нужно добавить в TS (значения из зонда):** round-trip каждого варианта из A.3.4; ошибки zod для `null` в `dependencies`, неизвестный вариант, `back_path` опущен=null; unknown-поля отбрасываются; `[["a"]]`/3-элементные кортежи отвергаются; `..` на корне клэмпится; `d/` → InvalidPath.

---
# B. `graph.rs` — граф юнитов

## B.1 Назначение и поверхность
Трейт `UnitGraph` (graph.rs:59–177) + `InMemoryUnitGraph` (graph.rs:182–…). Граф строится только при открытии библиотеки; после — read-only (doc-комментарий трейта `UnitGraph`: новые курсы требуют перезапуска).
```ts
export interface UnitGraph {
  addCourse(courseId: UnitId): void;                                   // throws UnitGraphError
  addLesson(lessonId: UnitId, courseId: UnitId): void;
  addExercise(exerciseId: UnitId, lessonId: UnitId): void;
  addDependencies(unitId: UnitId, unitType: UnitType, dependencies: readonly UnitId[]): void;
  addEncompassed(unitId: UnitId, dependencies: readonly UnitId[], encompassed: Encompassed): void;
  setEncompassingEqualsDependency(): void;                             // set_encompasing_equals_dependency (опечатка в имени Rust: encompasing)
  encompassingEqualsDependency(): boolean;
  addSuperseded(unitId: UnitId, superseded: readonly UnitId[]): void;  // infallible
  updateStartingLessons(): void;
  checkCycles(): void;                                                 // throws UnitGraphError(CheckCycles)
  getUnitType(id): UnitType | undefined;
  getCourseLessons(courseId): ReadonlySet<UnitId> | undefined;
  getStartingLessons(courseId): ReadonlySet<UnitId> | undefined;
  getLessonCourse(lessonId): UnitId | undefined;
  getLessonExercises(lessonId): ReadonlySet<UnitId> | undefined;
  getExerciseLesson(exerciseId): UnitId | undefined;
  getDependencies(id): ReadonlySet<UnitId> | undefined;
  getDependents(id): ReadonlySet<UnitId> | undefined;
  getDependencySinks(): ReadonlySet<UnitId>;
  getEncompasses(id): Array<[UnitId, number]> | undefined;
  getEncompassedBy(id): Array<[UnitId, number]> | undefined;
  getSupersedes(id): ReadonlySet<UnitId> | undefined;
  getSupersededBy(id): ReadonlySet<UnitId> | undefined;
  generateDotGraph(coursesOnly: boolean): string;
}
```
`Option<…>` → `undefined` (важно: «нет записи» ≠ «пустое множество», см. B.5). `Arc<UstrSet>` → `ReadonlySet` (внутри мутируется только на этапе загрузки; копирование-при-записи Rust `Arc::make_mut` не нужно, если наружу отдаются read-only ссылки после `freeze`).

## B.2 Состояние (`InMemoryUnitGraph`, graph.rs:182–216) — 13 полей
`type_map: Map<id, UnitType>`; `course_lesson_map: Map<course, Set<lesson>>`; `starting_lessons_map: Map<course, Set<lesson>>`; `lesson_course_map: Map<lesson, course>`; `lesson_exercise_map: Map<lesson, Set<exercise>>`; `exercise_lesson_map: Map<exercise, lesson>`; `dependency_graph: Map<unit, Set<dep>>`; `dependent_graph: Map<dep, Set<unit>>`; `dependency_sinks: Set<id>`; `encompasses_graph: Map<unit, [id, w][]>`; `encompassed_by: Map<id, [unit, w][]>`; `supersedes_graph: Map<unit, Set>`; `superseded_by: Map<id, Set>`. `Serialize/Deserialize/PartialEq/Clone/Default` (для `SerializedCourseLibrary`, C.5). Жизненный цикл: пустой → `add_*` при загрузке → `update_starting_lessons` → `set_encompasing_equals_dependency` (условно) → `check_cycles` → read-only.

Коллaборанты: вызывается только `LocalCourseLibrary::process_results` (C.3 п.10–13); читается планировщиком (`scheduler.rs:222–223` — `get_dependency_sinks` как стартовые юниты; `get_starting_lessons` — `scheduler.rs:265,769,901`), `unit_scorer`, `reward_propagator`, `review_knocker`, `filter`.

## B.3 Алгоритмы и точные правила валидации / тексты ошибок
Обёртка: каждая ошибка хелпера оборачивается в `UnitGraphError` (E). Итоговый `Display` (наблюдено, probe §3):

| операция | условие ошибки | полный текст (`Display` верхнего уровня) |
|---|---|---|
| `add_course(id)` | `type_map` уже содержит `id` (любого типа) | `cannot add unit {id} of type Course to the unit graph: course with ID {id} already exists` |
| `add_lesson(l, c)` | `type_map` содержит `l` | `cannot add unit {l} of type Lesson to the unit graph: lesson with ID {l} already exists` |
| `add_lesson` | `c` уже зарегистрирован с типом ≠ Course | `cannot add unit {l} of type Lesson to the unit graph: cannot update unit type of unit {c} from type Lesson) to Course.` (опечатка с лишней `)` — точная строка из graph.rs:257–271; `{:#?}` для юнит-варианта печатает просто имя) |
| `add_exercise(e, l)` | `type_map` содержит `e` | `cannot add unit {e} of type Exercise to the unit graph: exercise with ID {e} already exists` |
| `add_exercise` | `l` зарегистрирован с типом ≠ Lesson | `…: cannot update unit type of unit {l} from type Course) to Lesson.` |
| `add_dependencies(u, Exercise, _)` | `unit_type == Exercise` | `cannot add dependencies for unit {u} of type Exercise to the unit graph: exercise {u} cannot have dependencies` |
| `add_dependencies` | `u ∈ dependencies` | `cannot add dependencies for unit {u} of type {T} to the unit graph: unit {u} cannot depend on itself` |
| `add_dependencies` | `u ∉ type_map` | `…: unit {u} of type {T} must be explicitly added before adding dependencies` (`{T}` — Rust `{:?}`, т.е. `Course`/`Lesson`) |
| `add_encompassed` | любой вес ∉ [0.0, 1.0] или NaN (`(0.0..=1.0).contains`) | `cannot add encompassed units for unit {u} to the unit graph: encompassed units of unit {u} must have weights within the range [0.0, 1.0]` |
| `check_cycles` | цикл | `checking for cycles in the unit graph failed: {msg}` |
Порядок проверок в `verify_dependencies` (graph.rs:327): (1) Exercise, (2) self-dependency, (3) наличие в `type_map`. Параметр `unit_type` **не сверяется** с `type_map` (наблюдено: `add_dependencies(a, Lesson, [])` для курса `a` → OK). `add_superseded` (graph.rs:569) — без валидаций (нет ошибок; пустой список → no-op; можно ссылаться на несуществующие юниты). Ошибка `add_encompassed` ничего не пишет для юнита. Осторожно с тестом «после неудачного вызова»: `get_encompasses(a)` = `Some([])` в зонде только потому, что `encompasses_graph` пуст (режим «равно зависимостям») и у `a` есть запись в `dependency_graph`; в тесте `encompassed_with_invalid_weights` записи зависимостей нет ⇒ `None`.

### B.3.1 Хелперы добавления
```ts
addCourseHelper(c):  ensure(!typeMap.has(c), `course with ID ${c} already exists`); updateUnitType(c, 'Course');
addLessonHelper(l,c): ensure(!typeMap.has(l), `lesson with ID ${l} already exists`);
                      updateUnitType(l,'Lesson'); updateUnitType(c,'Course');   // курс создаётся неявно, без add_course!
                      lessonCourse.set(l,c); courseLessons.getOrCreate(c).add(l);
addExerciseHelper(e,l): ensure(!typeMap.has(e), `exercise with ID ${e} already exists`);
                      updateUnitType(e,'Exercise'); updateUnitType(l,'Lesson');
                      lessonExercises.getOrCreate(l).add(e); exerciseLesson.set(e,l);
updateUnitType(id,t): existing===undefined → set; existing===t → ok; else throw
                      `cannot update unit type of unit ${id} from type ${existing}) to ${t}.`
```
Следствие (наблюдено): после `add_lesson("k::l","k")` вызов `add_course("k")` падает («already exists») — то есть `add_course` **обязан** предшествовать первому `add_lesson` курса (loader так и делает, C.3 п.11–12). Ключи `course_lesson_map`/`lesson_exercise_map` создаются **только** при добавлении дочернего юнита ⇒ `get_course_lessons(курс_без_уроков)` = `undefined`, `get_lesson_exercises(урок_без_упражнений)` = `undefined` (из кода, graph.rs:290 и далее). ID-коллизии между типами ловятся сообщением «already exists» первой ветки (проверка `contains_key`, а не типа).

### B.3.2 `add_dependencies_helper`
```
verifyDependencies(u, T, deps);                // B.3 порядок
updateDependencySinks(u, deps);
dependencyGraph.getOrCreate(u).addAll(deps);   // АДДИТИВНО (повторные вызовы объединяют; наблюдено {"b","c"})
for d of deps: dependentGraph.getOrCreate(d).add(u);
```
`updateDependencySinks(u, deps)` (graph.rs:226–255):
1. `current = dependencyGraph.get(u) ?? ∅`. Если `current.isEmpty() && deps.isEmpty()` → `sinks.add(u)`, иначе `sinks.delete(u)`.
2. Если `lessonCourse.has(u)` (урок с известным курсом) → `sinks.delete(u)` (уроки неявно зависят от курса).
3. Для каждого `d ∈ deps`: рекурсивно `updateDependencySinks(d, [])` — на пустом списке это добавит `d` в sinks, **если у него ещё нет зависимостей** (в т.ч. если `d` вообще не добавлен в граф — «отсутствующий» юнит становится sink, см. наблюдение `sinks with missing dependency: ["missing"]`), и сразу удалит, если `d` — урок с курсом.
Инвариант: «курс без зависимостей — sink», «курс с зависимостями — не sink, но каждая его зависимость без своих зависимостей — sink». Порядок вызовов `add_dependencies` влияет на промежуточный набор sinks, но не на финальный (комментарий внутри `update_dependency_sinks`, graph.rs:226–255). Нюанс (из кода): вызов с непустым `deps` для юнита, уже имевшего зависимости, оставляет его не-sink; вызов `add_dependencies(u,[])` для юнита, **уже** имевшего зависимости, тоже удаляет из sinks (условие требует обе пустые).

### B.3.3 `add_encompassed_helper` (graph.rs:370–409)
1. Валидация весов (B.3). 2. `full = encompassed.clone()`; для каждой `dep ∈ dependencies`, которой **нет** среди `encompassed[*].0` → `full.push([dep, 1.0])`. 3. `encompassesGraph.getOrCreate(u).push(...full)` (запись создаётся даже при `full=[]` ⇒ граф «непуст», см. B.5); для каждого `[e,w] ∈ full`: `encompassedBy.getOrCreate(e).push([u, w])`. Дубликаты в `encompassed` **не** дедуплицируются; порядок = `encompassed` затем недостающие зависимости в порядке `dependencies`.

### B.3.4 `set_encompasing_equals_dependency` / `encompasing_equals_dependency`
`set…` = `encompasses_graph.clear(); encompassed_by.clear()` (graph.rs:559). `…equals…` = обе карты пусты (graph.rs:565). Вызывается loader-ом, если **ни один** манифест курса/урока не имеет непустого `encompassed` (C.3 п.10–13).

### B.3.5 `get_encompasses / get_encompassed_by` (graph.rs:659–678)
```ts
getEncompasses(u) { return encompassesGraph.size === 0
    ? getDependencies(u)?.map(d => [d, 1.0])      // режим «равно зависимостям»: ГЛОБАЛЬНЫЙ переключатель
    : encompassesGraph.get(u) }                  // иначе — только явная запись (undefined если юнит не добавлялся через add_encompassed)
getEncompassedBy(u) { return encompassedBy.size === 0 ? getDependents(u)?.map(d => [d, 1.0]) : encompassedBy.get(u) }
```
Условие «режима» — `map.isEmpty()` **всей** карты, не наличие ключа `u`. Наблюдено (KB-пример): `kb::intro` → `getEncompassedBy = [["kb::advanced",0.5]]`; `kb::advanced` → `getEncompasses = [["kb::intro",0.5],["other::x",1.0]]` (явное + недостающая зависимость с весом 1.0); юнит без записи → `None` (тест `encompassing_graph`: `get_encompassed_by(course3)` = None).

### B.3.6 `update_starting_lessons` (graph.rs:594–…; тесты `courses_with_starting_dependencies_not_in_sinks`, `generate_dot_graph`)
Для каждого `course ∈ courseLessons.keys()`:
1. `lessons = courseLessons[course]`.
2. `starting = { l ∈ lessons : dependencies(l) отсутствует ∨ lessons ∩ dependencies(l) = ∅ }` (урок стартовый, если **не зависит ни от одного урока того же курса**; зависимость от курса или чужого/несуществующего юнита не мешает — наблюдено: урок с зависимостью на `elsewhere` стартовый).
3. Если `sinks.has(course)`: `hasStartingDeps = ∃ l ∈ starting: dependencies(l) непусто ∧ ∀ d ∈ dependencies(l): typeMap.has(d)` → тогда `sinks.delete(course)` (курс не sink, если его стартовые уроки зависят от **существующих** юнитов; тест `courses_with_starting_dependencies_not_in_sinks`: sinks = {course1}).
4. `startingLessonsMap.set(course, starting)`.
Вызывать один раз после добавления всех юнитов. Курс без уроков в `courseLessons` отсутствует ⇒ `getStartingLessons` = `undefined`.

### B.3.7 `check_cycles` (`check_graph_cycles` graph.rs:411–460; `check_cycles_helper` graph.rs:462–…)
Три независимые проверки по порядку: (1) dependency↔dependent, msg `cycle in dependency graph detected`; (2) supersedes↔superseded_by, `cycle in superseded graph detected`; (3) encompasses↔encompassed_by, `cycle in encompassed graph detected`. Ключи обхода = ключи прямой карты (`dependency_graph`, `supersedes_graph`, `encompasses_graph`) (порядок HashMap — недетерминирован; в TS брать порядок вставки Map).
```ts
checkGraphCycles(keys, neighbors: id => id[]|undefined, checkReverse: (cur, nb) => void, cycleMsg) {
  const visited = new Set<UnitId>();
  for (const start of keys) {
    if (visited.has(start)) continue;
    const stack: UnitId[][] = [[start]];
    while (stack.length) {
      const path = stack.pop()!;
      const cur = path[path.length - 1];
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const nb of neighbors(cur) ?? []) {
        checkReverse(cur, nb);                                   // консистентность прямой и обратной карт
        if (path.includes(nb)) throw new Error(`${cycleMsg}: ${[...path, nb].join(' -> ')}`);
        stack.push([...path, nb]);
      }
    }
  }
}
```
Тексты `checkReverse`:
- deps: `unit {current} lists unit {dep} as a dependency but the dependent relationship does not exist` (если `dependents(dep)` нет или не содержит `current`);
- superseded: `unit {current} lists unit {sup} as a superseded unit but the superseding relationship does not exist`;
- encompassed: `unit {current} lists unit {enc} as an encompassed unit but the encompassing relationship does not exist`.
Формат пути цикла (наблюдено): `cycle in dependency graph detected: b -> c -> a -> b` (путь от точки входа DFS; **какая** ротация цикла — зависит от порядка ключей). Полный текст: `checking for cycles in the unit graph failed: cycle in superseded graph detected: b -> a -> b`.
Корректность: fuzz `probes/…/cyclefuzz-output.txt`: `graphs=20000 with_cycle=5850 missed=0 false_positive=0` (n≤8, граф зависимостей, эталон — алгоритм Кана). Для TS допустима стандартная 3-цветная DFS при сохранении текста и стрелки `" -> "`; тесты не должны утверждать конкретную ротацию цикла.
Замечание: при `encompassing_equals_dependency` обе карты пусты ⇒ проверка (3) — no-op (дублирует (1)).

### B.3.8 `generate_dot_graph(courses_only)` (graph.rs:692–…; тест `generate_dot_graph`, graph.rs:1121)
```
out = "digraph dependent_graph {\n"
for course of sorted(courseLessons.keys()):                       // ТОЛЬКО курсы, у которых есть уроки
  out += `    "${course}" [color=red, style=filled]\n`
  deps = [...(getDependents(course) ?? [])]
  if (coursesOnly) deps = deps.filter(d => getUnitType(d) === 'Course')
  else deps.push(...(getStartingLessons(course) ?? []))
  for d of sorted(deps): out += `    "${course}" -> "${d}"\n`
  if (coursesOnly) continue
  for lesson of sorted(getCourseLessons(course)):
    out += `    "${lesson}" [color=blue, style=filled]\n`
    for d of sorted(getDependents(lesson) ?? []): out += `    "${lesson}" -> "${d}"\n`
out += "}\n"
```
`sorted` — лексикографическая по `str`. Курсы без уроков (нет ключа в `course_lesson_map`) в DOT **не** попадают `[из кода; в зонде все курсы имели уроки]`. Пример точного вывода — тест B.8 и KB-пример D.5.

## B.4 Крайние случаи / инварианты
- Юниты, упомянутые как зависимости, но не добавленные («висячие»): `getUnitType` = `undefined`, `getDependencies` = `undefined`, `getDependents` = `Some`; попадают в `sinks` (B.3.2). Планировщик заменяет их зависимыми (`scheduler.rs:219–237`).
- **Неявная зависимость урок→курс НЕ хранится** ни в `dependency_graph`, ни в `dependent_graph` (наблюдено: манифест урока `dependencies:["c"]` на собственный курс и курса на собственный урок оба загружаются без цикла). Она реализована: (а) исключением урока-с-курсом из `dependency_sinks` (B.3.2 п.2); (б) в планировщике: курс → его `starting_lessons` (`scheduler.rs:769–772,901–905`); (в) в DOT: ребро курс→стартовые уроки. TS-порт обязан сохранить это, а не добавлять ребро явно (иначе изменятся sinks/циклы).
- Дубликаты ID разных типов ловятся `contains_key` (текст по типу вызываемой операции).
- `get_dependents` для юнита, никем не используемого, = `None` (не пустое множество); `get_dependencies` для курса без зависимостей = `Some(∅)` (запись создаётся `entry().or_default()` при `add_dependencies(id, [])`).

## B.5 Randomness / time / I/O
Нет. Единственная недетерминированность: порядок обхода HashMap/HashSet (`UstrMap` — ahash) → порядок ключей в `check_cycles` и порядок элементов `get_encompasses` при `is_empty`-ветке (`dependencies.iter()`). TS: `Map`/`Set` сохраняют порядок вставки; тесты сравнивать как множества/отсортированно.

## B.6 Rust-идиомы → решения
| идиома | решение |
|---|---|
| `Arc<UstrSet>` + `Arc::make_mut` | `Set` + `ReadonlySet` в API; клонирование не нужно |
| `Result<(), UnitGraphError>` с `map_err` | `throw new UnitGraphError(kind, {unitId, unitType}, cause)`; `message` строго по таблице B.3 |
| `f32` веса | `number`; `(0.0..=1.0).contains(w)` ⇒ `!(w >= 0 && w <= 1)` (NaN отвергается) |
| `&[Ustr]` | `readonly string[]` |
| `Option<Vec<(Ustr,f32)>>` | `Array<[string,number]> \| undefined` (копия при возврате) |
| `Clone/PartialEq/Serialize` графа | нужен только снимок для `SerializedCourseLibrary` (C.5); для structured-clone — `Map`→`Array<[k,v]>` |
| `#[cfg_attr(coverage, …)]`/`grcov-excl` | игнорировать |
| `usize` арифметики нет | — |

## B.7 (LOC) не-тест 777 / тест 558.

## B.8 TEST INVENTORY — `graph.rs` (17)
| `#[test]` | что проверяет | портируемость | vitest |
|---|---|---|---|
| `get_unit_type` | тип курса после `add_course` | direct | |
| `get_course_lessons_and_exercises` | course→lessons, lesson→exercises, обратные маппинги | direct | |
| `dependency_graph` | 5 курсов, dependents/dependencies, `None` для листьев, sinks={course1}, `check_cycles` ok | direct | |
| `courses_with_starting_dependencies_not_in_sinks` | sinks={course1} после `update_starting_lessons` | direct | |
| `encompassing_graph` | явный encompassed, вес 0.5 vs 1.0 по умолчанию, `None` для отсутствующих | direct | `toContainEqual(['c3',0.5])` |
| `encompassed_with_invalid_weights` | -0.1, 1.1, NaN → ошибка; `get_encompasses`=None | direct (`NaN` в TS-массиве, не в JSON) | `it.each([-0.1,1.1,NaN])` |
| `encompassing_equals_dependencies` | fallback на dependency graph (вес 1.0) | direct | |
| `superseding_graph` | supersedes/superseded_by | direct | |
| `generate_dot_graph` | точный DOT для `courses_only=false/true` (см. ниже) | direct | `toBe(indoc)` |
| `duplicate_ids` | повторные add_* → err (значения проверок отброшены `let _ =`) | direct — **усилить**: сравнивать текст | |
| `update_unit_type_different_types` | приватный `update_unit_type` Course→Lesson → err | direct (открыть как внутренний экспорт или через `add_lesson`) | |
| `dependencies_cycle` | цикл course1→…→course5→course1 → err | direct | |
| `encompassed_cycle` | цикл в encompassed (без `add_course`) → err | direct | |
| `superseded_cycle` | цикл в superseded | direct | |
| `missing_dependent_relationship` | ручная порча `dependent_graph` → err (и `None`-ветка) | **needs internals seam** — в TS: тестовый хелпер/`@internal` для порчи карт, либо unit-тест `checkGraphCycles` отдельно | |
| `missing_encompasing_relationship` | то же для encompassed_by | needs internals seam | |
| `missing_superseding_relationship` | то же для superseded_by (второй assert портит `dependency_graph`, не superseded — вероятная опечатка теста, `[вывод]`) | needs internals seam | |
Ожидаемый DOT (graph.rs `generate_dot_graph` тест, `courses_only=false`): `digraph dependent_graph {` / `    "1" [color=red, style=filled]` / `    "1" -> "1::1"` / `    "1" -> "2"` / `    "1::1" [color=blue, style=filled]` / `    "1::1" -> "1::2"` / `    "1::2" [color=blue, style=filled]` / … / `}` + `\n`; `courses_only=true`: только `"1" [red]`, `"1" -> "2"`, `"2" [red]`, `"2" -> "3"`, `"3" [red]`.
**Добавить в TS** (наблюдено): точные тексты ошибок из B.3; `add_course` после `add_lesson` падает; `add_dependencies` аддитивно; sinks для висячей зависимости = {missing}; стартовый урок с зависимостью на чужой юнит; `getStartingLessons(не-курс)`=undefined.

---
# C. `course_library.rs` — загрузка библиотеки

## C.1 Поверхность
```ts
export const COURSE_MANIFEST_FILENAME = 'course_manifest.json';
export const LESSON_MANIFEST_FILENAME = 'lesson_manifest.json';
export const EXERCISE_MANIFEST_FILENAME = 'exercise_manifest.json';

export interface CourseLibrary {   // все — синхронные, in-memory
  getCourseManifest(id): CourseManifest | undefined;
  getLessonManifest(id): LessonManifest | undefined;
  getExerciseManifest(id): ExerciseManifest | undefined;
  getCourseIds(): UnitId[];                          // отсортировано
  getLessonIds(courseId): UnitId[] | undefined;      // отсортировано; undefined если у курса нет уроков в графе
  getExerciseIds(lessonId): UnitId[] | undefined;    // отсортировано; undefined если у урока нет упражнений
  getAllExerciseIds(unitId?: UnitId): UnitId[];      // отсортировано
  getMatchingPrefix(prefix: string, unitType?: UnitType): Set<UnitId>;
}
export class LocalCourseLibrary implements CourseLibrary {
  static open(fs: LibraryFs, prefs: UserPreferences): Promise<LocalCourseLibrary>;   // async только из-за I/O; внутри — sync-домен
  static fromSerialized(s: SerializedCourseLibrary, prefs: UserPreferences): LocalCourseLibrary;
  readonly unitGraph: InMemoryUnitGraph; readonly courseMap/lessonMap/exerciseMap: ReadonlyMap<UnitId, …>;
}
export interface SerializedCourseLibrary { unitGraph: GraphSnapshot; courseMap: Array<[UnitId, CourseManifest]>; lessonMap: …; exerciseMap: … }
```
Трейт `GetUnitGraph` (pub(crate)) → просто публичное поле `unitGraph`.

## C.2 Состояние и коллaборанты
Поля (course_library.rs:154–166): `unit_graph: Arc<RwLock<InMemoryUnitGraph>>`, `course_map/lesson_map/exercise_map: UstrMap<Arc<Manifest>>`, `user_preferences`. После конструктора неизменяемо (кроме `unit_graph` под RwLock, но писатель — только конструктор). Использует `data::{NormalizePaths, VerifyPaths, GenerateManifests}`, `graph`. Используется `Trane::new_local*` (`lib.rs:320–376`), scheduler/filters/`unit_scorer`.

## C.3 Алгоритм загрузки `LocalCourseLibrary::new(library_root, prefs)` (`new` course_library.rs:422–488; хелперы 173–420: `open_manifest` 173, `process_lesson_manifest` 235, `process_course_manifest` 286, `process_results` 346) — пошагово
**Фаза 1 — обход (последовательно, fail-fast):**
1. `ignored = prefs.ignored_paths.map(p => libraryRoot.join(p.trim_matches('/')))` (обрезка `/` с обоих концов ⇒ трейлинг-слэш не даёт `InvalidPath`).
2. `for entry in libraryRoot.walk_dir()`: рекурсивно все файлы и каталоги (vfs `WalkDirIterator`: порядок — порядок `read_dir` ОС, не сортирован; включая `.git`, `.trane` и т.п. — фильтра скрытых нет `[из кода]`). Ошибка итератора → весь `new` завершается ошибкой.
3. Фильтры по порядку: (а) `filename == "course_manifest.json"` (точное имя; `filename` пуст → ошибка `cannot get file name from VfsPath`, тест `rejects_root_path_without_filename`); (б) `entry.is_dir()` → пропуск (каталог с таким именем не манифест; наблюдено); (в) `entry.parent() == libraryRoot` → пропуск (манифест **прямо в корне библиотеки игнорируется**; наблюдено); (г) игнор по префиксу: для каждого `ignored`: `prefix = ignoredPath.asStr().trimEnd('/') + '/'`; если `entry.asStr().startsWith(prefix)` → пропуск. Наблюдено: `"course_0/"` и `"/course_0"` одинаково игнорируют `course_0/…`; `"group"` — всё под `group/`; `"group/course_2"` НЕ задевает `group/course_22`; `"course_"` (частичное имя) ничего не игнорирует; `"../x"` ничего; **`""` и `"/"` игнорируют ВСЮ библиотеку** (prefix=`"/"`) — ловушка, `[из кода+наблюдено]`.
4. `open_manifest::<CourseManifest>(entry)`: чтение + `serde_json::from_reader`; ошибки: `cannot open manifest file {path}` / `cannot parse manifest file {path}: {serde error}` (наблюдено: `cannot parse manifest file /c1/course_manifest.json: EOF while parsing an object at line 1 column 1`; путь — VFS-путь с ведущим `/`). Любая ошибка → падает **вся** загрузка (нет пропуска битого курса). Запрос `{course_root: entry.parent(), course_manifest}` в список.

**Фаза 2 — обработка курсов (в Rust параллельно `rayon::into_par_iter`, результат `collect::<Result<Vec<_>>>` сохраняет порядок входа; первая ошибка отменяет результат):** для каждого курса `process_course_manifest(course_root, manifest)`:
5. `library_root = course_root.root()`; `manifest' = manifest.normalize_paths(libraryRoot, courseRoot)` (нормализуются `course_instructions`/`course_material`, A.4.2).
6. `manifest'.verify_paths(libraryRoot)` иначе `asset path in course {id} does not exist`.
7. `verify_course_manifest`: `id` непуст, иначе `ID in manifest is empty` (наблюдено — без указания пути).
8. Если `generator_config` задан: `generated = config.generate_manifests(courseRoot, manifest', prefs)?` (§D; ошибка → падает вся загрузка); `lessons.push(...generated.lessons)`; если `updated_metadata` Some → **заменяет** `manifest'.metadata`; если `updated_instructions` Some → **заменяет** `course_instructions`. Порядок: **генератор вызывается ПОСЛЕ нормализации/верификации курса и ДО сканирования ручных уроков**; сгенерированные уроки идут в `lessons` первыми и **не проходят** `process_lesson_manifest` (нет verify_paths / сверки `course_id` / проверки пустого ID для урока/упражнений — их гарантирует генератор).
9. Ручные уроки: `for lessonRoot of courseRoot.read_dir()` (порядок ОС): пропуск не-каталогов и каталогов без файла `lesson_manifest.json` (`is_file`); открыть `LessonManifest`; `process_lesson_manifest`:
   a. `normalize_paths(libraryRoot, lessonRoot)` (`lesson_instructions`, `lesson_material`); b. `verify_paths` иначе `asset path in lesson {id} does not exist`; c. `verify_lesson_manifest`: `id` непуст (`ID in manifest is empty`), `lesson.course_id == course.id` иначе `course_id in manifest for lesson {lid} does not match the manifest for course {cid}`;
   d. упражнения: `for exerciseRoot of lessonRoot.read_dir()` — **только прямые дочерние каталоги** урока с файлом `exercise_manifest.json` (наблюдено: глубже — игнорируется, урок глубже `course/x/l/` — игнорируется); открыть `ExerciseManifest`, `normalize_paths(libraryRoot, exerciseRoot)`, `verify_paths` иначе `asset path in exercise {id} does not exist`; `verify_exercise_manifest`: `id` непуст, `lesson_id == lesson.id` (`lesson_id in manifest for exercise {eid} does not match the manifest for lesson {lid}`), `course_id == lesson.course_id` (`course_id in manifest for exercise {eid} does not match the manifest for course {cid}`).
   Наблюдено: каталог `course_manifest.json/…`, вложенный курс внутри каталога урока (`c1/l/inner/course_manifest.json`) — грузится как отдельный курс `inner` (walk рекурсивен).

**Фаза 3 — вставка (последовательно, `process_results`, порядок курсов = порядок walk):**
10. `encompassingEqualsDependency = true`.
11. Для каждого курса: `graph.add_course(id)`; `add_dependencies(id, Course, deps)`; `add_encompassed(id, deps, encompassed)`; `add_superseded(id, superseded)`; если `manifest.encompassed` непуст → `encompassingEqualsDependency=false`; `courseMap.set(id, manifest)`.
12. Для каждого урока курса (порядок: сгенерированные, затем ручные): `add_lesson(id, course_id)`; `add_dependencies(id, Lesson, deps)`; `add_encompassed`; `add_superseded`; при непустом `encompassed` флаг → false; `lessonMap.set`; для каждого упражнения: `add_exercise(id, lesson_id)`; `exerciseMap.set`.
13. После всех курсов: `graph.update_starting_lessons()`; если флаг true → `graph.set_encompasing_equals_dependency()`; `graph.check_cycles()`.
`SerializedCourseLibrary::from(&lib)` / `new_from_serialized` — клон графа+карт (postcard в тесте; в TS — structured-clone/JSON-снимок; postcard не переносить).

### Поведение при частичном отказе (наблюдено, probe §4/5b)
**All-or-nothing.** Любая ошибка (парсинг любого манифеста, verify, несовпадение ID, дубликат ID, вес вне [0,1], self-dependency, цикл, ошибка генератора, ошибка чтения KB-файла) → `Err` из `new`, частично построенной библиотеки нет. Дубликат ID курса/урока/упражнения обнаруживается **только** в фазе 3 (`add_*`) и даёт двойную сообщение-цепочку в `{:#}` (`…already exists: course with ID dup already exists`) — верхний `Display` содержит текст один раз (B.3). Какая из нескольких ошибок будет возвращена — зависит от порядка walk/параллелизма `[недетерминировано]`. Висячие зависимости — **не ошибка**. Решение для порта: сохранить fail-fast; собирать сразу все ошибки — осознанное отклонение (не входит в задачу).

Примеры (наблюдено): `ID in manifest is empty`; `asset path in course c does not exist`; `asset path in lesson c::l does not exist`; `asset path in exercise c::l::e does not exist`; `checking for cycles in the unit graph failed: cycle in dependency graph detected: b -> a -> b`; `cannot add dependencies for unit c of type Course to the unit graph: unit c cannot depend on itself`.

## C.4 Константы
`COURSE_MANIFEST_FILENAME="course_manifest.json"`, `LESSON_MANIFEST_FILENAME="lesson_manifest.json"`, `EXERCISE_MANIFEST_FILENAME="exercise_manifest.json"` (course_library.rs:26,29,32). Структура на диске: `<любая глубина>/<course>/course_manifest.json`; `<course>/<любой_каталог>/lesson_manifest.json`; `<lesson>/<любой_каталог>/exercise_manifest.json`; имена каталогов произвольны. (Doc-комментарий структуры с дефисами `course-manifest.json` — устарел; в коде подчёркивания.)

## C.5 Запросы (`impl CourseLibrary`, course_library.rs:516–660)
- `get_course_ids` — ключи `course_map`, сортировка по `Ustr` (лексикографически). `get_lesson_ids(c)` / `get_exercise_ids(l)` — через граф (`?` ⇒ `None` при отсутствии записи), сортировка.
- `get_all_exercise_ids(unit_id)`: `Some(id)` → по `graph.get_unit_type`: `Course` → упражнения всех уроков курса (`unwrap_or_default` для отсутствующих); `Lesson` → упражнения урока; `Exercise` → `[id]`; неизвестный → `[]`; `None` → все ключи `exercise_map`. Результат сортируется.
- `get_matching_prefix(prefix, type)`: `starts_with(prefix)` по ключам соответствующей карты; `None` → объединение трёх карт. Возвращает set. Пустой prefix → все.
Шов `LibraryFs` (для TS):
```ts
interface LibraryFs {                       // корень = корень библиотеки; пути '/'-разделённые, '' = корень
  readDir(dir: string): Promise<string[]>;                       // имена детей (порядок — сортировать лексикографически в реализации, чтобы устранить недетерминизм)
  stat(path: string): Promise<'file' | 'dir' | 'missing'>;
  readText(path: string): Promise<string>;
}
```
Из-за async I/O предложить: фаза 1–2 (walk + чтение) собирает в память `RawCourse[]` асинхронно (можно `Promise.all` по курсам — эквивалент rayon), фаза 3 — синхронная чистая функция `buildLibrary(rawCourses, prefs)`, что даёт детерминированные тесты без FS. `generate_manifests` тоже получает `LibraryFs` и в TS — `async`.

## C.6 Randomness/time/I/O
I/O: walk/read_dir/is_dir/is_file/open_file. Время/RNG — нет. Недетерминизм: порядок `walk_dir`/`read_dir` и rayon. Порт: сортировать имена детей ⇒ детерминированные ID-порядки и текст ошибки цикла.

## C.7 Rust-идиомы → решения
`Arc<RwLock<InMemoryUnitGraph>>` → обычный экземпляр (писатель один, во время конструктора); `rayon` → `Promise.all` (или последовательно); `anyhow::Context` → `new Error(msg, {cause})` с точными префиксами; `VfsPath` → `LibPath`(строка+fs) с `join` по A.4.1; `postcard` → не переносить; `UstrMap` → `Map`. Отмечено: `Trane::new_local_with_vfs`, embedded FS (`rust_embed`) — в порте не нужен (Electron: `app.getAppPath()`-каталог через `NodeFs`); `[вне охвата]`.

## C.8 LOC: не-тест 651 / тест 141.

## C.9 TEST INVENTORY — `course_library.rs` (3) + интеграционные, затрагивающие загрузку
| тест | что проверяет | портируемость | vitest |
|---|---|---|---|
| `rejects_root_path_without_filename` | `get_file_name(root)` → Err | direct (приватная fn; в TS — реализуется как `basename` с ошибкой при пустом) | |
| `rejects_invalid_course_during_parallel_processing` | курс с `id:""` → `new` = Err | needs fixtures (MemoryFS) | in-memory `LibraryFs` |
| `skips_directories_without_exercise_manifests` | манифест в корне игнорируется; каталог `course_manifest.json/` не манифест; вложенный курс `category/course`; пустой каталог упражнения пропускается; `get_course_ids`, `get_exercise_ids` | needs fixtures | in-memory FS |
| `tests/basic_tests.rs::ignored_paths` | `ignored_paths=["course_0/","course_5/"]` → нет упражнений `0::…`, `5::…` | needs fixtures + `TestCourse` builder (F) | |
| `tests/basic_tests.rs::serialized_course_library` | round-trip `SerializedCourseLibrary` (postcard) и равенство карт/графа | needs fixtures; postcard → заменить на JSON/structured-clone deep-equal | |
| `tests/embedded_fs.rs::loads_embedded_course_library` | загрузка с embedded FS: ID, пути ассетов нормализованы (`raw_course/course.material.md`), содержимое читается | needs fixtures: `tests/embedded_test_library/` (9 файлов) — **скопировать как фикстуру** | in-memory FS из файлов |
| `tests/embedded_fs.rs::opens_trane_with_embedded_course_library` | верхнеуровневый `Trane` + `.trane` каталог | skip (уровень facade; не этот модуль) | |
| `tests/generated_courses.rs::knowledge_base_course_generator_assets` | KB-курс: 2 упражнения достижимы планировщиком, пути `knowledge_base_course/lesson_0.lesson/…`, без ведущего `/` | needs fixtures; часть с симуляцией планировщика — отдельный спек | |
**Добавить** (значения наблюдены): все 30+ проб из probe §4 как таблица `it.each` (пустая библиотека, вложенность, дубликаты, несоответствия ID, порог ignored_paths, клэмп `../../x.md`, `d/`→InvalidPath).

---
# D. `data/course_generator.rs`, `knowledge_base.rs` — генераторы курсов

## D.1 Поверхность
`course_generator.rs` (10 строк) — `pub mod knowledge_base; pub mod literacy; pub mod transcription;`. Диспетчер: `impl GenerateManifests for CourseGenerator` (data.rs:323–342): `KnowledgeBase(c)|Literacy(c)|Transcription(c)` → `c.generate_manifests(course_root, course_manifest, prefs)`.
```ts
export type CourseGenerator = { KnowledgeBase: KnowledgeBaseConfig } | { Literacy: LiteracyConfig } | { Transcription: TranscriptionConfig };
export interface GenerateManifests { generateManifests(fs: LibraryFs, courseRoot: LibPath, course: CourseManifest, prefs: UserPreferences): Promise<GeneratedCourse> }
export interface KnowledgeBaseConfig { inlined: boolean }          // #[serde(default)] → false;  {"KnowledgeBase":{}} валидно
```
**Literacy/Transcription** (не разбираются; размер кода — таблица в начале): `LiteracyConfig{generate_dictation: bool=false, exercise_type: ExerciseType=Procedural}` (literacy.rs:674–684); `TranscriptionConfig{transcription_dependencies: string[]=[], passage_directory: string="", inlined_passages: TranscriptionPassages[]=[], skip_singing_lessons=false, skip_advanced_lessons=false}` (transcription.rs:200–232); `TranscriptionPassages{asset: {Track:{short_id, track_name, artist_name?, album_name?, duration?, external_link?: {YouTube: url}}}, intervals: {"<usize>": [start,end]} ({})}`; `Instrument{name,id}`; `TranscriptionPreferences` (A.3.7). Реальный пример: `tests/large_test_library/improvise_for_real/jam_tracks_1/a/course_manifest.json` (`"generator_config":{"Transcription":{…,"inlined_passages":[{"asset":{"Track":{…}},"intervals":{"1":["Beginning of song","End of song"]}}]}}}`). Для порта: `TranscriptionAsset` в `ExerciseAsset` схеме zod нужен (wire-совместимость), сами генераторы — вне первого этапа `[решение Main]`.

## D.2 Состояние и коллaборанты
Stateless. Вызывается только из `process_course_manifest` (C.3 п.8). Читает FS напрямую (`read_dir`, `read_to_string`, JSON-файлы). `KnowledgeBaseConfig::generate_manifests` **игнорирует** `preferences`.

## D.3 Таблица файловых конвенций KB-урока (константы `knowledge_base.rs:19–61`, `TryFrom<&str> for KnowledgeBaseFile` knowledge_base.rs:122–…)
Курс: каталог с `course_manifest.json` (`generator_config: {"KnowledgeBase": {}}`); уроки — **прямые дочерние каталоги** `<short_lesson_id>.lesson` (суффикс `.lesson`, `LESSON_SUFFIX`; файл с таким именем — игнорируется; каталог без суффикса — игнорируется).

| Файл в `<X>.lesson/` | Разбор (порядок сопоставления — сверху вниз, точные имена раньше суффиксов) | Содержимое | Куда попадает / умолчание |
|---|---|---|---|
| `lesson.dependencies.json` | точное имя | JSON `string[]` | `LessonManifest.dependencies` (`[]`) |
| `lesson.superseded.json` | точное | `string[]` | `superseded` (`[]`) |
| `lesson.encompassed.json` | точное | `[string, number][]` | `encompassed` (`[]`) |
| `lesson.name.json` | точное | JSON-строка | `name`; умолч. `"Lesson {short_id}"` |
| `lesson.description.json` | точное | JSON-строка | `description` (None) |
| `lesson.metadata.json` | точное | `{string: string[]}` | `metadata` (None) |
| `lesson.material.md` | точное | markdown (**не** JSON; только факт наличия) | `lesson_material = MarkdownAsset{path:"lesson.material.md"}` → нормализуется |
| `lesson.instructions.md` | точное | markdown (только наличие) | `lesson_instructions = MarkdownAsset{path:"lesson.instructions.md"}` → нормализуется |
| `lesson.default_exercise_type.json` | точное | `"Declarative"`\|`"Procedural"` | умолчание типа для упражнений урока |
| `<id>.front.md` | суффикс `.front.md`, `<id>` = имя без суффикса | markdown | **обязателен** для упражнения `<id>` |
| `<id>.back.md` | суффикс `.back.md` | markdown | необязателен (open-ended) |
| `<id>.name.json` | суффикс `.name.json` | JSON-строка | `ExerciseManifest.name`; умолч. `"Exercise {id}"` |
| `<id>.description.json` | суффикс `.description.json` | JSON-строка | `description` (None) |
| `<id>.type.json` | суффикс `.type.json` | `"Declarative"`\|`"Procedural"` | `exercise_type` (приоритет: файл упражнения > `lesson.default_exercise_type.json` > `Procedural`; тест `exercise_type_resolution`) |
| любой другой файл/каталог | `Err("Not a valid knowledge base file name: …")`, **молча отбрасывается** (`flat_map` по `Result`) | | игнор |
Тонкости (наблюдено): `<id>` может содержать точки (`x.y.front.md` → id `x.y`); `lesson.front.md` — это упражнение `lesson` (точные `lesson.*` имена проверяются раньше); пустой `<id>` (`.front.md`) отбрасывается (`exercise_files.remove("")`); `<id>.back.md` **без** `.front.md` — упражнение отбрасывается целиком (`filter_matching_exercises`); каталог с именем `x.back.md` считается back-файлом (для `inlined:true` — ошибка чтения).

## D.4 Алгоритм генерации (`KnowledgeBaseConfig::generate_manifests`, knowledge_base.rs:645–…; `convert_to_full_ids` 587, `open_lesson` 490, `create_lesson` 428, `create_exercise` 277, `filter_matching_exercises` 412, `to_exercise_manifest` 216)
1. `course_root.read_dir()` → только каталоги (`is_dir().unwrap_or(false)`); для имени с суффиксом `.lesson`: `short_id = name.strip_suffix(".lesson")` → `open_lesson(path, course, short_id)`; результат в `lessons: Map<short_id, (KbLesson, KbExercise[])>` (ошибка → вся генерация `Err`).
2. `open_lesson`: `read_dir` каталога урока → для каждого имени `KnowledgeBaseFile::try_from` (не распознанные пропускаются); файлы упражнений группируются по `<id>` в `HashMap<id, files[]>`, остальные — `lesson_files`. `create_lesson`: инициализация умолчаниями, затем для каждого распознанного файла — чтение JSON (`KnowledgeBaseFile::open`, ошибка: `cannot open knowledge base file {path}` / `cannot parse knowledge base file {path}: {serde}`, наблюдено `…/c/l.lesson/lesson.name.json: expected ident at line 1 column 2`); `LessonInstructions/Material` → лишь флаги `has_*`.
3. `exercise_files.remove("")`; `filter_matching_exercises` — удалить `<id>` без `Front`-файла. `create_exercise` для каждого: `front_file = lessonRoot.join("{id}.front.md").as_str()` (**абсолютный VFS-путь** вида `/kb_course/intro.lesson/a.front.md`), `back_file` аналогично если `.back.md` есть; поля name/description/type — чтение соответствующих JSON.
4. `convert_to_full_ids`: `short_ids` = множество коротких ID **уроков этого курса**; для каждого урока в `dependencies`, `encompassed[*].0`, `superseded`: если элемент ∈ `short_ids` → `"{course.id}::{elem}"`, иначе без изменений (тест `convert_to_full_ids`: `"lesson2"`→`"course1::lesson2"`, `"other::lesson1"` остаётся). ⚠ Коллизия (наблюдено): если зависимость `intro` совпадает и с коротким ID урока, и с ID чужого курса `intro` — она **всегда** превращается в `c::intro`.
5. Для каждого `(short_id, (lesson, exercises))`: `lessonRoot = courseRoot.join("{short_id}.lesson")`; `LessonManifest::from(lesson)` (id=`"{course_id}::{short_id}"`, `course_id`, `dependencies`, `encompassed`, `superseded`, `name = name ?? "Lesson {short_id}"`, `description`, `metadata`, instructions/material — `MarkdownAsset{path:"lesson.instructions.md"|"lesson.material.md"}` либо None) `.normalize_paths(lessonRoot.root(), lessonRoot)` → пути становятся `"<путь курса>/<short>.lesson/lesson.instructions.md"` (относительно корня библиотеки); для каждого упражнения `to_exercise_manifest(lessonRoot, lesson.default_exercise_type, self.inlined)`.
6. `to_exercise_manifest`: `id = "{course_id}::{short_lesson_id}::{short_id}"`, `lesson_id = "{course_id}::{short_lesson_id}"`, `course_id`, `name = name ?? "Exercise {short_id}"`, `description`, `exercise_type = type ?? default ?? Procedural`; ассет: `inlined=false` → `FlashcardAsset{front_path: normalize_path(root, lessonRoot, front_file), back_path: … (None если нет)}` (пути относительно корня библиотеки, без ведущего `/`); `inlined=true` → читает файлы (`failed to read exercise front file {front}` / `… back file {path}` при ошибке) → `InlineFlashcardAsset{front_content, back_content}` (содержимое файла дословно, без trim).
7. Возврат `GeneratedCourse{lessons, updated_instructions:None, updated_metadata:None}`. Порядок `lessons` и упражнений — порядок итерации HashMap (**не определён**); библиотека потом сортирует ID — в TS сортировать по `short_id` для детерминизма.
Ошибок валидации ID нет: пустой короткий ID урока (`.lesson`) даёт урок `"c::"` и упражнение `"c::::e"` (наблюдено); дублей коротких ID нет (уникальность имён каталогов ФС); конфликт с ручным `lesson_manifest.json` того же ID → ошибка графа `lesson with ID c::l already exists` (наблюдено); уроки KB **не проверяются** на веса `encompassed` при генерации (вес 2.0 → ошибка в графе: `cannot add encompassed units for unit c::l …`).

## D.5 Пример: каталог → сгенерированные манифесты (полностью наблюдённый вывод probe §5, `LocalCourseLibrary::new`)
Каталог библиотеки:
```
kb_course/course_manifest.json    {"id":"kb","name":"KB Course","generator_config":{"KnowledgeBase":{}},"course_instructions":{"MarkdownAsset":{"path":"course.instructions.md"}}}
kb_course/course.instructions.md
kb_course/intro.lesson/{lesson.name.json ("Introduction"), lesson.instructions.md, lesson.default_exercise_type.json ("Declarative"),
                         a.front.md, a.back.md, a.name.json ("First card"), a.description.json ("About A"),
                         b.front.md, c.back.md, d.front.md, d.type.json ("Procedural"), .front.md, notes.txt}
kb_course/advanced.lesson/{lesson.dependencies.json (["intro","other::x"]), lesson.encompassed.json ([["intro",0.5]]),
                            lesson.superseded.json (["intro"]), lesson.metadata.json ({"topic":["adv"]}), e1.front.md, e1.back.md}
kb_course/plain.notlesson/x.front.md      (игнор: нет суффикса .lesson)
kb_course/stray.lesson                    (ФАЙЛ, игнор)
kb_inl/course_manifest.json       {"id":"kbi","generator_config":{"KnowledgeBase":{"inlined":true}}}
kb_inl/l.lesson/{q.front.md ("Q front"), q.back.md ("Q back")}
```
Результат (JSON строки — дословно из вывода):
```
COURSE  {"id":"kb","name":"KB Course",…,"course_instructions":{"MarkdownAsset":{"path":"kb_course/course.instructions.md"}},"generator_config":{"KnowledgeBase":{"inlined":false}}}
LESSON  {"id":"kb::advanced","dependencies":["kb::intro","other::x"],"encompassed":[["kb::intro",0.5]],"superseded":["kb::intro"],"course_id":"kb","name":"Lesson advanced","description":null,"metadata":{"topic":["adv"]},"lesson_material":null,"lesson_instructions":null}
  EX    {"id":"kb::advanced::e1","lesson_id":"kb::advanced","course_id":"kb","name":"Exercise e1","description":null,"exercise_type":"Procedural","exercise_asset":{"FlashcardAsset":{"front_path":"kb_course/advanced.lesson/e1.front.md","back_path":"kb_course/advanced.lesson/e1.back.md"}}}
LESSON  {"id":"kb::intro","dependencies":[],…,"name":"Introduction",…,"lesson_instructions":{"MarkdownAsset":{"path":"kb_course/intro.lesson/lesson.instructions.md"}}}
  EX    {"id":"kb::intro::a","name":"First card","description":"About A","exercise_type":"Declarative","exercise_asset":{"FlashcardAsset":{"front_path":"kb_course/intro.lesson/a.front.md","back_path":"kb_course/intro.lesson/a.back.md"}}}
  EX    {"id":"kb::intro::b","name":"Exercise b","exercise_type":"Declarative","exercise_asset":{"FlashcardAsset":{"front_path":"kb_course/intro.lesson/b.front.md","back_path":null}}}
  EX    {"id":"kb::intro::d","name":"Exercise d","exercise_type":"Procedural","exercise_asset":{"FlashcardAsset":{"front_path":"kb_course/intro.lesson/d.front.md","back_path":null}}}
COURSE  {"id":"kbi",…,"generator_config":{"KnowledgeBase":{"inlined":true}}}
LESSON  {"id":"kbi::l","name":"Lesson l",…}
  EX    {"id":"kbi::l::q","name":"Exercise q","exercise_type":"Procedural","exercise_asset":{"InlineFlashcardAsset":{"front_content":"Q front","back_content":"Q back"}}}
```
Граф: `dependency sinks = ["kb","kbi","other::x"]`; `kb::advanced`: deps=`["kb::intro","other::x"]`, `getEncompasses=[("kb::intro",0.5),("other::x",1.0)]`, `supersedes=["kb::intro"]`; `kb::intro`: `getEncompassedBy=[("kb::advanced",0.5)]`, `superseded_by=["kb::advanced"]`; starting lessons `kb` = `["kb::intro"]`; `encompasing_equals_dependency = false`; DOT:
```
digraph dependent_graph {
    "kb" [color=red, style=filled]
    "kb" -> "kb::intro"
    "kb::advanced" [color=blue, style=filled]
    "kb::intro" [color=blue, style=filled]
    "kb::intro" -> "kb::advanced"
    "kbi" [color=red, style=filled]
    "kbi" -> "kbi::l"
    "kbi::l" [color=blue, style=filled]
}
```
Реальный минимальный KB-курс из репозитория (без back): `tests/large_test_library/improvise_for_real/sing_the_numbers_1/` — `course_manifest.json` c `"generator_config":{"KnowledgeBase":{}}`, `10.lesson/{1.front.md, lesson.dependencies.json=["9"]}`, `10_transposed.lesson/{…, lesson.dependencies.json=["10"], lesson.superseded.json=["10"]}` (111 `lesson.dependencies.json`, 63 `lesson.superseded.json` во всём `large_test_library`).

## D.6 Граничные случаи и ошибки (сводка)
Ошибки: `cannot open knowledge base file {path}`, `cannot parse knowledge base file {path}: {serde}` (тип name — не строка → `invalid type: integer \`1\`, expected a string at line 1 column 1`; неизвестный тип → ``unknown variant `Weird`, expected `Declarative` or `Procedural` …``), `failed to read exercise front/back file …` (только `inlined`). Любая → падает вся библиотека. Урок без упражнений валиден (`c::l` в `getLessonIds`, `getExerciseIds`→undefined). Ассеты урока/курса, помеченные, но отсутствующие — для урока KB невозможно (флаг ставится по факту наличия). `course_instructions` курса из `course_manifest.json` верифицируется loader-ом до генерации.

## D.7 Randomness/time/I/O
Только чтение FS (sync в Rust; в TS async через `LibraryFs`). Нет RNG/времени.

## D.8 Rust-идиомы → решения
`HashMap<String, Vec<KnowledgeBaseFile>>` → `Map<string, KbFile[]>` (+ сортировка при выходе); `flat_map(TryFrom)` (тихий отброс) → `parseKbFileName(name): KbFile | null`; `KnowledgeBaseFile` enum → discriminated union `{kind:'ExerciseFront', shortId}`; `Ustr::from(&format!(..))` → строка; absolute-path в `front_file` — внутреннее представление, в TS хранить относительный путь урока.

## D.9 LOC: `knowledge_base.rs` не-тест 702 / тест 574; `course_generator.rs` 10/0.

## D.10 TEST INVENTORY — `knowledge_base.rs` (14)
| `#[test]` | что проверяет | портируемость | vitest |
|---|---|---|---|
| `open_knowledge_base_file` | JSON-файл читается (`["lesson1"]`) | needs fixtures (FS) | in-memory FS |
| `open_knowledge_base_file_bad_format` | битый JSON → Err | needs fixtures | |
| `open_knowledge_base_file_bad_permissions` | chmod 000 → Err | **skip** (POSIX-права; заменить `readText` reject на fake FS) | |
| `to_knowledge_base_file` | имена → варианты KnowledgeBaseFile; `"ex1"` → Err | direct | `it.each` (+добавить `default_exercise_type`, точные-имена-до-суффиксов) |
| `lesson_to_manifest` | KbLesson → LessonManifest (id, флаги → MarkdownAsset) | direct | |
| `exercise_to_manifest` | KbExercise → ExerciseManifest, `inlined=false` (пути как есть, root `.`) | direct с fake FS | |
| `exercise_to_manifest_inlined` | inlined читает содержимое | needs fixtures | |
| `exercise_to_manifest_inlined_missing_front` | нет файла → Err | direct | |
| `manifests_with_invalid_back_file` | `ex1.back.md` — каталог, `inlined` → Err | needs fixtures | |
| `lesson_with_invalid_exercise_metadata` | `ex1.name.json` не JSON → `open_lesson` Err | needs fixtures | |
| `exercise_type_resolution` | приоритет type > default > Procedural | direct | |
| `convert_to_full_ids` | короткие → полные для deps/encompassed/superseded | direct | |
| `filter_matching_exercises` | без front — удалить; front-only оставить | direct | |
| `open_lesson_dir` | полный каталог урока: все файлы разобраны; `front_file=="/lesson1.lesson/ex1.front.md"` | needs fixtures | in-memory FS |
`tests/generated_courses.rs::{literacy_course_generator, transcription_course_generator}` — вне охвата (Literacy/Transcription).
**Добавить** (наблюдено): пример D.5 как golden; коллизия `intro`; `.lesson` пустой ID; файл `*.lesson`; `x.y.front.md`; дубликат с `lesson_manifest.json`; веса вне диапазона.

---
# E. `error.rs` — таксономия ошибок (thiserror, 158 строк)
`Ustr` → `string`. Каждый вариант имеет `#[source] anyhow::Error` (кроме отмеченных) и форматируется `{0}…: {N}` (последнее — текст источника).
| enum | вариант → формат |
|---|---|
| `BlacklistError` | `AddUnit(id, src)` = `cannot add unit {0} to the blacklist: {1}`; `GetEntries` = `cannot get entries from the blacklist: {0}`; `RemovePrefix(prefix, src)` = `cannot remove entries with prefix {0} from the blacklist: {1}`; `RemoveUnit` = `cannot remove unit {0} from the blacklist: {1}` |
| `ExerciseSchedulerError` | `GetExerciseBatch` = `cannot retrieve exercise batch: {0}`; `ScoreExercise` = `cannot score exercise: {0}`; `GetUnitScore(id)` = `cannot get score for unit {0}: {1}` |
| `PracticeRewardsError` | `GetRewards(id)` = `cannot get rewards for unit {0}: {1}`; `RecordRewards` = `cannot record rewards: {0}`; `TrimReward` = `cannot trim rewards: {0}`; `RemovePrefix` = `cannot remove rewards from units matching prefix {0}: {1}` |
| `PracticeStatsError` | `GetScores(id)` = `cannot get scores for unit {0}: {1}`; `RecordScore` = `cannot record scores: {0}`; `TrimScores` = `cannot trim scores: {0}`; `RemovePrefix` = `cannot remove scores from units matching prefix {0}: {1}` |
| `PracticeDeltasError` | `GetDeltas(id)` = `cannot get deltas for unit {0}: {1}`; `RecordDelta` = `cannot record deltas: {0}`; `TrimDeltas` = `cannot trim deltas: {0}`; `RemovePrefix` = `cannot remove deltas from units matching prefix {0}: {1}` |
| `PreferencesManagerError` | `GetUserPreferences` = `cannot get user preferences: {0}`; `SetUserPreferences` = `cannot set user preferences: {0}` |
| `RepositoryManagerError` | `AddRepo(url)` = `cannot add repository with URL {0}: {1}`; `ListRepos` = `cannot list repositories: {0}`; `RemoveRepo(id)` = `cannot get repository with ID {0}: {1}` (**текст «get» у RemoveRepo — опечатка оригинала**); `UpdateRepo(id)` = `cannot update repository with ID {0}: {1}`; `UpdateRepos` = `cannot update repositories: {0}` |
| `ReviewListError` | `AddUnit` = `cannot add unit {0} to the review list: {1}`; `GetEntries` = `cannot retrieve the entries from the review list: {0}`; `RemoveUnit` = `cannot remove unit {0} from the review list: {1}` |
| `TranscriptionDownloaderError` | `DownloadAsset(id)` = `cannot download asset for exercise {0}: {1}` |
| `UnitGraphError` | `AddDependencies(id, UnitType, src)` = `cannot add dependencies for unit {0} of type {1} to the unit graph: {2}`; `AddEncompassed(id, src)` = `cannot add encompassed units for unit {0} to the unit graph: {1}`; `AddUnit(id, UnitType, src)` = `cannot add unit {0} of type {1} to the unit graph: {2}`; `CheckCycles(src)` = `checking for cycles in the unit graph failed: {0}` |
Предложение TS: базовый `class TraneError extends Error { constructor(kind: string, message: string, cause?: unknown) }`; по подклассу на enum (`UnitGraphError`, `BlacklistError`, …) с полем `kind` (имя варианта) и структурированными полями (`unitId`, `unitType`, `prefix`); `message` = дословный формат выше; `cause` = источник. Ошибки загрузки библиотеки (C.3) — обычные `Error` без enum (в Rust это `anyhow::Error` с контекстом; `UnitGraphError` в них через `?`). Для IPC — `structured-clone`-безопасный DTO `{kind, message, unitId?, …}` (не пересылать `cause`-объект). Тестов в `error.rs` нет.

---
# F. `course_builder.rs`, `course_builder/knowledge_base_builder.rs` — тестовые утилиты (**test utility**, не часть движка)
Что должен повторить TS-построитель фикстур (`test_utils.rs:37–320` — потребитель):
- `TestId(course, lesson?, exercise?)` → строка `"{c}"`, `"{c}::{l}"`, `"{c}::{l}::{e}"` (числа); обратный разбор по `::`. Каталоги: `course_{c}/`, `lesson_{l}/`, `exercise_{i}/`. Курс: `id`, `name="Course {id}"`, `description="Description for course {id}"`, `course_material=MarkdownAsset{path:"material.md"}`, `course_instructions=MarkdownAsset{path:"instructions.md"}` + файлы `material.md`("material"), `instructions.md`("instructions"). Урок: `name="Lesson {id}"`, `description="Description for lesson {id}"`, `metadata`, те же material/instructions; упражнение: `name="Exercise {id}"`, `description="Description for exercise {id}"`, `exercise_type=Procedural`, `FlashcardAsset{front_path:"question.md", back_path:"answer.md"}`, файлы `question.md`("question"), `answer.md`("answer").
- Манифесты пишутся `JSON.stringify(m, null, 2) + "\n"` под именами C.4; после записи — `verify_paths`; `AssetBuilder.build` падает, если файл уже существует (`asset path {p} already exists`), создаёт родительские каталоги (`create_dir_all`).
- KB-построитель: `SimpleKnowledgeBaseCourse{manifest, encompassed?, lessons:[{short_id, dependencies, superseded, encompassed, exercises:[{short_id, front: string[], back: string[]}], metadata, additional_files}]}`; записывает `<short>.lesson/` с файлами D.3 (`front` склеивается `"\n"`; `back` пуст → файл не создаётся); JSON-файлы для непустых deps/superseded/encompassed/metadata; проверки: `short ID of lesson cannot be empty`, `short ID {id} of lesson is not unique`, `short ID cannot be empty` (упражнение), `short ID {id} of exercise is not unique`; при повторной сборке каталог урока удаляется; манифест курса пишется последним (`serde_json::to_string_pretty`, без trailing `\n`).
- `TraneMetadata::Skill` → строка `"skill"` (strum snake_case).
Рекомендация: в TS реализовать один `buildFixtureLibrary(specs): InMemoryFs`-построитель (без диска) + опционально запись на диск для e2e; `RandomCourseLibrary` (test_utils.rs:331+) — использует `rand::rng()`, переносить только с seedable `Rng`.
LOC: `course_builder.rs` 216/121; `knowledge_base_builder.rs` 432/564.

**TEST INVENTORY (утилиты, 10):** `course_builder.rs`: `asset_builer` (запись файла), `asset_builer_existing` (существующий файл → Err), `course_builder` (структура каталога/манифестов), `trane_metadata_display` (для coverage — skip); `knowledge_base_builder.rs`: `course_builder`, `build_simple_course` (файлы KB на диске), `duplicate_short_lesson_ids`, `duplicate_short_exercise_ids`, `empty_short_lesson_ids`, `empty_short_exercise_ids` (проверки ensure!). Портировать **только если** TS-код построителя повторяет эти проверки; иначе не нужно (тесты утилиты, не движка).

---
# G. Сводка рисков и неоднозначностей
1. **`ignored_paths` `""`/`"/"`** игнорируют всю библиотеку (наблюдено). Решить: повторить или валидировать при `setUserPreferences`.
2. **Клэмп `..` на корне VFS**: ассеты могут ссылаться на любой файл внутри библиотеки (`../../x.md`). Сохранить для wire-совместимости; выход за пределы `LibraryFs` невозможен по конструкции.
3. **Порядок walk/read_dir не определён** → порядок ошибок и текст цикла недетерминированы; в TS сортировать имена (отклонение, безопасное).
4. **Неявное ребро урок→курс не хранится** (B.4) — легко ошибиться, добавив его в `dependency_graph`.
5. **Сгенерированные уроки обходят `verify_lesson_manifest`/`verify_paths`** (C.3 п.8); ошибки ID для них ловятся только графом.
6. **Пустой короткий ID урока/`.lesson`** порождает `"course::"` (D.4). Валидировать в TS? — отклонение от Rust `[решение Main]`.
7. Коллизия «короткий ID урока = ID чужого курса» разрешается в пользу короткого (D.4 п.4).
8. Тест `missing_superseding_relationship` портит `dependency_graph` во втором assert (вероятная опечатка) — не копировать слепо.
9. Уровень `Ustr::Ord` для версии `ustr 1.1.0` подтверждён по master `[НЕ ПОДТВЕРЖДЕНО для 1.1.0]`.
10. `KnowledgeBaseExercise.exercise_type` doc-комментарий: «metadata» в `EXERCISE_TYPE_SUFFIX` (копипаст в doc) — на поведение не влияет.
11. Не проверялось: поведение `walk_dir` на симлинках, `Ustr`-дедупликация с NUL-символами, `read_dir` на не-UTF-8 именах `[НЕ ПОДТВЕРЖДЕНО]`.
12. Doc-комментарий `LocalCourseLibrary` в `course_library.rs` (структура каталога) использует дефисы (`course-manifest.json`) — устарел; факт — подчёркивания (константы C.4, реальные файлы).

Воспроизведение: `cd engine-ts/spike/probes/spec-data-graph-library && CARGO_TARGET_DIR=$PWD/target cargo run --release -q [--bin cyclefuzz]` (~20 с первая сборка; `target/` удалён после работы).
