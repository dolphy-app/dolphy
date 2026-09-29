# Спека: фильтры, сессии, хранилища, фасад `Trane`, тест-харнесс (Trane v0.34.1 → TS)

Источник (read-only): `spike/trane-fsrs/trane-pristine/` (`src/…`, `tests/…`). Все `file:line` — относительно него, если не сказано иное.

> **Путь (2026-09-29):** источник теперь `engine-ts/reference/trane-pristine/` (был `spike/trane-fsrs/trane-pristine/`).
Метки: `[ИЗМЕРЕНО]` — получено запуском (см. §0), `[НЕ ПОДТВЕРЖДЕНО]` — не проверено.
Соглашения порта: время — epoch **мс** (Trane: секунды `i64`), id — `string`, `Clock`/`Rng` — внедряемые, домен синхронный, `Arc<RwLock<dyn Trait>>` → constructor-injected interface.

## 0. Как проверялось (воспроизводимые пробы)

Каталог `specs/spec-filters-stores-facade.probes/` (исходники + `Cargo.lock` + `*.out.txt`; `target/` удалён):
- `wire_probe/` — `src/data/filter.rs` скопирован дословно (до `#[cfg(test)]`; код AGPL, не для распространения), сериализован `serde_json` 1.x: реальные wire-примеры (§1.5). Вывод: `wire_probe.out.txt`, `prefs_probe.out.txt`.
- `db_probe/` — миграции всех 5 БД скопированы дословно, прогнаны `rusqlite =0.40.2 (bundled)` + `rusqlite_migration =2.6.0` (версии из `Cargo.toml`): реальные схемы, `user_version`, pragma, поведение `LIKE`/trim/cap. Вывод: `db_probe.out.txt`.
- Порядок при равных `timestamp` проверен CLI `sqlite3` 3.51.0 (не bundled-версия rusqlite → для bundled `[НЕ ПОДТВЕРЖДЕНО]`): `ORDER BY timestamp DESC` по индексу `(unit_uid, timestamp)` отдаёт равные timestamp в порядке **rowid DESC** (вставленные `1,2,3,4@99,5@100`… → `5,3,2,1,4`).

Ключевые измеренные факты:
| факт | результат |
|---|---|
| user_version после миграций | blacklist=3, review_list=3, practice_stats=7, practice_rewards=5, practice_deltas=3 |
| итоговые таблицы | blacklist(unit_id TEXT NOT NULL UNIQUE); review_list(то же); uids(unit_uid INTEGER PK, unit_id TEXT NOT NULL UNIQUE); practice_stats(id INTEGER PK, unit_uid NOT NULL REFERENCES uids, score REAL, timestamp INTEGER)+index `trials(unit_uid,timestamp)`; practice_rewards(id, unit_uid, reward REAL, weight REAL, timestamp INTEGER)+index `rewards(unit_uid,timestamp)`; practice_deltas(id, unit_uid, delta REAL, timestamp INTEGER)+index `deltas_trials(unit_uid,timestamp)` |
| pragma | `journal_mode=wal`, `synchronous=0` (OFF), `foreign_keys=1` (дефолт bundled-сборки; `utils.rs` его не выставляет) |
| `LIKE 'a%'` над `{a::b, A::c, axb, a_b, a%b, ab}` | вернул **все шесть** (регистронезависимо; `%` внутри — wildcard) |
| `LIKE 'a_b%'` | `{a%b, a_b, axb}` (`_` = любой символ) |
| trim: 6 строк (ts 1,2,3,3,3,3), `trim(2)` | остались 4 строки с ts=3 (`NOT IN (SELECT timestamp … LIMIT 2)` сравнивает по **значению** timestamp) |
| cap наград: 25 вставок ts 0..24 | осталось 20, самый старый ts=5 |
| `0.05f32` в REAL → чтение | f64: `0.05000000074505806`, f32: `0.05` |
| `weighted_average([1,2,3],[.2,.3,.5])` | f32 и f64 оба дают `== 2.3` |

## 1. `src/data/filter.rs` — фильтры и учебные сессии

### 1.1 Публичная поверхность и TS-сигнатуры
Rust (`filter.rs:19-384`): `FilterOp{All,Any}`, `FilterType{Include,Exclude}`, `KeyValueFilter{CourseFilter,LessonFilter,CombinedFilter}`, `UnitFilter{CourseFilter,LessonFilter,MetadataFilter,ReviewListFilter,Dependents,Dependencies}`, `SavedFilter`, `SessionPart{UnitFilter,SavedFilter,NoFilter}`, `StudySession`, `StudySessionData`, `ExerciseFilter{UnitFilter,StudySession}`; методы `KeyValueFilter::apply_to_course/apply_to_lesson`, `UnitFilter::passes_course_filter/passes_lesson_filter`, `SessionPart::duration`, `StudySessionData::get_part`.

Решение: wire-форма (serde externally tagged) — единственная форма DTO; zod-схемы = кодеки; внутренних «нормализованных» типов не заводить (меньше маппинга). Время: DTO `startTimeMs:number`, кодек ⇄ wire `start_time` RFC3339.
```ts
type FilterOp = 'All' | 'Any';
type FilterType = 'Include' | 'Exclude';
type KeyValueFilter =
  | { CourseFilter: { key: string; value: string; filter_type: FilterType } }
  | { LessonFilter: { key: string; value: string; filter_type: FilterType } }
  | { CombinedFilter: { op: FilterOp; filters: KeyValueFilter[] } };
type UnitFilter =
  | { CourseFilter: { course_ids: string[] } }
  | { LessonFilter: { lesson_ids: string[] } }
  | { MetadataFilter: { filter: KeyValueFilter } }
  | 'ReviewListFilter'                          // unit-variant = голая строка
  | { Dependents: { unit_ids: string[] } }
  | { Dependencies: { unit_ids: string[]; depth: number /* uint */ } };
interface SavedFilter { id: string; description: string; filter: UnitFilter }   // все 3 поля обязательны
type SessionPart =
  | { UnitFilter: { filter: UnitFilter; duration: number /* uint32, минуты */ } }
  | { SavedFilter: { filter_id: string; duration: number } }
  | { NoFilter: { duration: number } };
interface StudySession { id: string; description?: string /* default "" */; parts?: SessionPart[] /* default [] */ }
interface StudySessionData { start_time: string /*RFC3339*/; definition: StudySession }   // wire
type ExerciseFilter = { UnitFilter: UnitFilter } | { StudySession: StudySessionData };
// чистые функции (sync, без I/O):
function keyValueApplyToCourse(f: KeyValueFilter, courseMeta: Metadata | undefined): boolean;
function keyValueApplyToLesson(f: KeyValueFilter, courseMeta: Metadata | undefined, lessonMeta: Metadata | undefined): boolean;
function sessionPartAt(s: {startMs: number; definition: StudySession}, nowMs: number): SessionPart;
type Metadata = Record<string, string[]>;   // Rust: BTreeMap<String, Vec<String>>
```

### 1.2 Состояние и коллабораторы
Чистые данные, состояния нет. Потребители: `scheduler.rs:975-1040` (`get_initial_candidates`), `scheduler/data.rs:268-338` (`unit_passes_filter`, `get_session_filter`), `filter_manager.rs`, `study_session_manager.rs`.

### 1.3 Алгоритмы (точные семантики)

**`passes_filter(meta, key, value, type)`** (`filter.rs:79-92`): `has = meta[key]?.some(v => v === value)`; Include→`has`; Exclude→`!has`. Отсутствующий ключ ⇒ `has=false` ⇒ Exclude **проходит** (test `apply_course_filter_to_course_no_match`). Отсутствующие метаданные = пустая мапа (`unwrap_or(&default)`).

**`apply_to_lesson(course, lesson)`** (`:160-198`):
- `CourseFilter` → `passes_filter(courseMeta)` (урок наследует решение курса);
- `LessonFilter` → `passes_filter(lessonMeta)`;
- `CombinedFilter{op,filters}` → `All`: `filters.every(f => apply_to_lesson(f))`, `Any`: `.some(...)` (рекурсивно; пустой список: All=`true`, Any=`false`).

**`apply_to_course(course)`** (`:95-156`):
- `CourseFilter` → `passes_filter(courseMeta)`;
- `LessonFilter` → **всегда `false`** («решение примет урок»);
- `CombinedFilter{op,filters}`: разделить `filters` на `courseFilters` (только вариант `CourseFilter`) и `other` (всё остальное, **включая вложенные Combined**); `courseResult = op==All ? courseFilters.every(apply_to_course) : courseFilters.some(...)`; `otherResult` аналогично по `other`; если `other.length===0` → `courseResult`; иначе `op==All ? courseResult && otherResult : false` (для `Any` курс с «чужими» под-фильтрами всегда `false`, решают уроки).
  Следствия: `All[CourseFilter ok, LessonFilter]` → `false` (test `…with_lesson_filter_to_course`); `All[CourseFilter, CourseFilter, Combined(All[CourseFilter])]` → `true`; вложенный Combined в `other` вычисляется через `apply_to_course` (то есть внутри него тоже действует правило LessonFilter→false).

**`passes_course_filter(id)`**/**`passes_lesson_filter(id)`** (`:244-258`): `CourseFilter`→`course_ids.contains`, иначе `false`; аналогично Lesson. В планировщике не используются (там `course_ids` берутся деструктуризацией) — нужны только для тестов.

**`get_part(time)`** (`:348-372`), время в минутах, `num_minutes()` усекает к нулю:
1. `parts.length===0` → `NoFilter{duration:0}`;
2. `m = trunc((time - start)/60_000)`; `m < 0` → `parts[0]`;
3. `acc=0; for p of parts { acc += p.duration; if (m < acc) return p }`; иначе — `parts.at(-1)`.
Свойства `[ИЗМЕРЕНО]` (`wire_probe.out.txt`, парты 15/30/5): −1 мин→p0; 0,14→p0; 15,44→p1; 45,50,1000→p2; 14м59с→p0; −59с→p0. **Части с `duration=0` пропускаются** (первая часть 0-длит., `t=0` → вторая часть `b`). `acc` — `u32`: переполнение в Rust — паника в debug/wrap в release; в TS — safe-integer, валидировать `duration ≤ 2^31`.

**Как планировщик исполняет фильтры** (`scheduler.rs:975-1040`, `None` → весь граф с `get_initial_stack(None)`):
| фильтр | стартовый стек / кандидаты | ссылки |
|---|---|---|
| `CourseFilter{course_ids}` | для каждого курса: **все** `get_starting_lessons` (даже если их зависимости не выполнены), `visited∋course`; поиск с `allow_course_traversal=false, allowed_courses=course_ids, metadata=None`; чужие уроки (не из `allowed_courses`) пропускаются (`continue`), но помечаются `visited`. Неизвестный курс → нет стартовых уроков → пусто. | `scheduler.rs:893-909, 792-798` |
| `LessonFilter{lesson_ids}` | `get_candidates_from_lesson` **напрямую**, без проверки зависимостей и `passes_threshold`; blacklisted урок/курс → пусто (`all_valid_exercises_in_lesson`); неизвестный урок → пусто | `:990-996, 912-918`, `data.rs:342-361` |
| `MetadataFilter{filter}` | `get_initial_stack(Some(f))` + полный DFS с `metadata_filter=Some(f)`; см. «мосты» ниже | `:997-1000` |
| `ReviewListFilter` | для каждого id из `review_list.get_review_list_entries()`: Course→`get_candidates_from_course([id])`; Lesson→`get_candidates_from_lesson`; Exercise→кандидат напрямую (depth 0, БЕЗ проверки blacklist); неизвестный id → `Err` (`get_unit_type_strict`) ⇒ весь `get_exercise_batch` падает | `:922-965` |
| `Dependents{unit_ids}` | стек = `unit_ids` (depth 0) → обычный DFS **без** metadata; юнит сам проходит обычную обработку (курс→его стартовые уроки; урок→кандидаты), затем `get_valid_dependents` (только те, чьи ВСЕ зависимости удовлетворены). Exercise-id в `unit_ids` молча игнорируется (тип Exercise в DFS не обрабатывается) | `:1002-1011, 751-877` |
| `Dependencies{unit_ids,depth}` | `get_dependencies_at_depth(unit, depth)` для каждого, стек = результат (depth 0), далее обычный DFS **вперёд** (к dependents) | `:1012-1027`, `data.rs:176-213` |
| `ExerciseFilter::StudySession(d)` | `part = d.get_part(Utc::now())` (**wall clock, не `override_current_timestamp`**) → `NoFilter`→`None`; `UnitFilter{f}`→`f`; `SavedFilter{id}`→`filter_manager.get(id).filter` (нет → `Err "no saved filter with ID {id} exists"`); затем рекурсивно `get_initial_candidates` | `:1029-1035`, `data.rs:317-338` |
После любого фильтра: `deduplicate_candidates` (первый по `exercise_id`, порядок сохраняется) — `scheduler.rs:968-972, 1039`. StudySession-ветка делает `return` **до** дедупликации, но рекурсивный вызов её выполняет.

**`get_dependencies_at_depth(unit, depth)`** (`data.rs:176-213`): DFS-стек `(id, d)`; `d===depth` → в результат; иначе `deps=graph.get_dependencies(id)`; `Some(non-empty)` → push `(dep,d+1)`; `Some(empty)`/`None` → **сам узел в результат** (то есть depth больше глубины графа возвращает листья-источники); в конце `retain(graph.get_unit_type(x).is_some())` (убирает ссылки на отсутствующие юниты; неизвестный `unit` → `[]`). Результат без дедупа (ромб даёт дубль; ниже кандидаты дедуплицируются). Порядок: LIFO стека (для HashSet-итерации всё равно не определён).
Тесты: `Dependencies{5::1, depth=1}` ⇒ уроки `5::0,5::1` (зависимость `3::3` отсутствует и отфильтрована); `Dependencies{course 2, depth=5}` ⇒ курсы `0,1,2,7,8`; `Dependencies{20, 5}` ⇒ ничего.

**Metadata-фильтр в DFS — «мосты» для отфильтрованных юнитов** (`scheduler.rs:429-520`, `data.rs:268-305`):
- `unit_passes_filter(unit, f)`: `f=None`→`true`; тип Exercise → `Err` (метаданных нет); Course→`f.apply_to_course(course)`; Lesson→`f.apply_to_lesson(course_of_lesson, lesson)`. В `skip_course`/`skip_lesson` `Err` трактуется как `true` (`unwrap_or(true)`), в мостах и `last_matching_lessons` — как `false`.
- `skip_course`: `blacklisted || !passes_filter || pending_lessons==0 || superseded`; `skip_lesson`: `blacklisted || !passes_filter || lesson_superseded || course_superseded` (`:623-691`). Скипнутый юнит **не даёт кандидатов**, но его `valid_dependents` кладутся в стек (поиск идёт сквозь него). Курс с одним `LessonFilter`-only фильтром всегда skip-ается (`apply_to_course=false`), решают уроки.
- `satisfied_dependency(dep)` (`:575-589`): `targets = resolve_effective_dependencies(dep, f, visited)`; `targets.empty` ⇒ `true`; иначе `all(satisfied_effective_dependency)`.
- `resolve_effective_dependencies(dep)` (`:429-520`): `visited` (общий на один вызов, защита от циклов; повторный вход → `∅`); если `passes_filter(dep)` → `{dep}`; иначе по типу:
  - **Lesson**: `next = deps(lesson) ∪ (isStartingLesson(course) ? deps(course) : ∅)` → объединение `resolve(next_i)`;
  - **Course**: `last = last_matching_lessons_in_course(course)` (уроки курса, проходящие фильтр и не имеющие dependents среди проходящих уроков этого курса, `:394-426`); если `last≠∅` → `last`; иначе объединение `resolve(dep_i)` по `deps(course)`;
  - иное (Exercise/неизвестный) → `∅`.
- `satisfied_effective_dependency(t)` (`:538-571`): blacklisted `t` → `true`; урок из blacklisted курса → `true`; `t` заменён (`superseded`) → `true`; иначе `passes_threshold(passing_score, get_unit_score(t), get_avg_trials(t))`: обе величины `Some` ⇒ `score >= min_score && avg_trials >= min_avg_trials`; хоть одна `None` ⇒ **`true`** (нет данных не блокирует).
- Тесты `scheduler_bridges_filtered_dependency_chain` (цепь `0::0(keep)→1::0→2::0→3::0(keep)`; при оценках 1 `3::0` не планируется, при 5 — планируется) и `scheduler_bridges_filtered_course_dependencies` (§8) фиксируют поведение.

**Успешность сессии и время** (`scheduler/data.rs:402-420`): `trial_counts:(ok,fail)` живёт весь срок жизни объекта `Trane` (не сбрасывается, не персистится, не привязан к StudySession); `score_exercise`→`update_success_rate`: One,Two→fail; Three,Four,Five→ok; `rate = total==0 ? 1.0 : ok/total` (f32). Применение — `scheduler/filter.rs:217-254`: `rate>0.90`→`shift=+0.05`; `0.75≤rate≤0.90`→без изменений; `0.50≤rate<0.75`→`−0.05`; `rate<0.50`→`−0.10`; `new% += shift`, `target% += shift`, `easy% −= shift`, `mastered% −= shift`, каждый `clamp(0.05, 0.50)`; `current% = max(1 − (new+target+easy+mastered), 0.05)`. Пороги 0.90/0.75/0.50 и шаги — литералы без doc-обоснования кроме комментария «optimal zone 75-90 %».
Время: `now` для скоринга = `UnitScorer.override_timestamp ?? Utc::now().timestamp()` (`unit_scorer.rs:103-110`, секунды), `override_current_timestamp` не влияет на StudySession (`scheduler.rs:1032`).

### 1.4 Крайние случаи и инварианты
- `StudySession.description`/`parts` — `#[serde(default)]`; `SavedFilter` — без default: `{"id":..}` без `description` невалиден.
- serde **не** `deny_unknown_fields` `[ИЗМЕРЕНО]`: лишние ключи принимаются; `Dependencies` без `depth` → ошибка; `depth:-1` → ошибка (`usize`); `duration:-1` → ошибка (`u32`). Unit-variant принимается как `"ReviewListFilter"` **и** `{"ReviewListFilter":null}`; выдаётся как голая строка. zod: `z.union([z.literal('ReviewListFilter'), …])`, для приёма `{ReviewListFilter:null}` добавить preprocess.
- `start_time` `[ИЗМЕРЕНО]`: принимает `…Z`, `+02:00`, наносекунды; **без** смещения (`"2026-09-29T12:00:00"`) — ошибка.
- `ExerciseFilter`/`UnitFilter` содержат `Ustr` (интернированные строки) — в TS обычные строки; равенство по значению.
- Нет валидации: несуществующие `course_ids/lesson_ids/unit_ids` молча дают пустой результат (кроме review-list, где unknown → `Err`).

### 1.5 Wire-примеры `[ИЗМЕРЕНО]` (`wire_probe.out.txt`)
```json
{"CourseFilter":{"course_ids":["c1","c2"]}}
{"LessonFilter":{"lesson_ids":["c1::l1"]}}
"ReviewListFilter"
{"Dependents":{"unit_ids":["c1::l1"]}}
{"Dependencies":{"unit_ids":["c1::l1"],"depth":2}}
{"MetadataFilter":{"filter":{"CombinedFilter":{"op":"All","filters":[{"CourseFilter":{"key":"k","value":"v","filter_type":"Include"}},{"CombinedFilter":{"op":"Any","filters":[{"LessonFilter":{"key":"k2","value":"v2","filter_type":"Exclude"}}]}}]}}}}
// SavedFilter (файл в .trane/filters/)
{"id":"f1","description":"d","filter":"ReviewListFilter"}
// StudySession (файл в .trane/study_sessions/)
{"id":"s","description":"desc","parts":[{"UnitFilter":{"filter":{"CourseFilter":{"course_ids":["0"]}},"duration":15}},{"SavedFilter":{"filter_id":"f1","duration":30}},{"NoFilter":{"duration":5}}]}
// ExerciseFilter (аргумент get_exercise_batch)
{"UnitFilter":"ReviewListFilter"}
{"StudySession":{"start_time":"2026-09-29T12:00:00Z","definition":{"id":"s","description":"desc","parts":[…]}}}
```
Примеров в `tests/*.rs` и README нет (Rust-тесты строят фильтры структурами; JSON-файлов фильтров в репозитории нет — `grep` по `tests/`, `README.md`: 0). Книга Trane (online) в доступных страницах примеров не показала `[НЕ ПОДТВЕРЖДЕНО]` для остальных страниц.

### 1.6 Швы и идиомы
Randomness: нет (шаффл стека — в планировщике). Time: `get_part(time)` принимает время параметром — порт: `Clock.now()` вместо `Utc::now()` в `scheduler.rs:1032` (иначе StudySession-тест не воспроизводим). Rust→TS: externally-tagged enum → union по единственному ключу (нужен guard `Object.keys(x).length===1`); `BTreeMap` → `Record` (порядок ключей не значим для семантики); `usize`→`number` ≥0 целое; `Ustr`→`string`; `f32` не используется.

### 1.7 Тесты `filter.rs` (22 `#[test]`, `filter.rs:406-1207`)
| тест | что проверяет | портируемость | vitest |
|---|---|---|---|
| passes_course_filter / passes_lesson_filter | `CourseFilter` пропускает свой id, чужой нет, на Lesson-вариант → false | direct | `it.each` |
| apply_course_filter_to_course | Include→true, Exclude→false для существующей пары | direct | table |
| apply_lesson_filter_to_course | LessonFilter на курсе → false (и Include, и Exclude) | direct | table |
| apply_course_filter_to_course_no_match | нет ключа: Include false, Exclude true | direct | table |
| apply_course_filter_to_lesson / …lesson_to_lesson (+ `_no_match` ×2) | CourseFilter на уроке смотрит метаданные курса, LessonFilter — урока | direct | table |
| apply_combined_all_filter_to_course (+`_with_lesson_filter`, `_with_combined_filter`, `_no_match`) | правило course/other-разделения для All | direct | table |
| apply_combined_any_filter_to_course (+`_no_match`, `_with_combined_filter`) | Any на курсе | direct | table |
| apply_combined_{all,any}_filter_to_lesson (+`_no_match` ×2) | рекурсивные every/some на уроке | direct | table |
| unit_filter_clone | `clone()==` (для покрытия) | skip: тавтология | — |
| get_session_part | пустая сессия→NoFilter{0}; отриц. минуты→parts[0]; границы 0/1/2 мин; после конца→последняя | direct (с фикс. `startMs`) | `it.each` + свойства из §1.3 (zero-duration, усечение секунд) |

Доп. тесты порта (нет в Rust): zod round-trip wire-примеров §1.5; `{"ReviewListFilter":null}`; отказ `depth:-1`; `Any` смешанный course+lesson на курсе → false.
### 1.8 LOC: filter.rs — 385 нетестовых / 823 тестовых.

## 2. `filter_manager.rs` и `study_session_manager.rs` — сохранённые фильтры и сессии

### 2.1 Поверхность
```ts
interface FilterManager { getFilter(id: string): SavedFilter | undefined; listFilters(): Array<[id: string, description: string]> }
interface StudySessionManager { getStudySession(id: string): StudySession | undefined; listStudySessions(): Array<[string, string]> }
// конструкторы (async: чтение каталога — I/O граница)
async function openFilterManager(dir: string): Promise<FilterManager>;
async function openStudySessionManager(dir: string): Promise<StudySessionManager>;
```
Rust: трейты `FilterManager`/`StudySessionManager` — **только чтение** (`filter_manager.rs:14-20`, `study_session_manager.rs:14-20`); реализации `LocalFilterManager{filters: HashMap<String,Arc<SavedFilter>>}`, `LocalStudySessionManager{sessions: HashMap}`. Записи нет ни в трейте, ни в `Trane` — файлы создаёт пользователь/приложение вручную.

### 2.2 Состояние
Мапа id→объект, построена **один раз** в конструкторе (`scan_filters`, `filter_manager.rs:30-54`; `scan_sessions`, `study_session_manager.rs:30-54`). Изменения файлов после старта не видны до пересоздания `Trane`.

### 2.3 Алгоритм скана
1. `read_dir(dir)` (ошибка → `"Failed to read filter directory"`); **каждая** запись каталога (без фильтра по расширению/типу, включая скрытые `.DS_Store`, подкаталоги) — `File::open` → `serde_json::from_reader` в `SavedFilter`/`StudySession`;
2. любая ошибка открытия/парсинга → **весь конструктор падает** (а с ним `Trane::new_*`);
3. дубль `id` (между разными файлами) → `bail!("Found multiple filters with ID {id}")`; порядок обхода `read_dir` не определён, но исход не зависит от него;
4. `list_*` = `(id, description)` отсортировано `a.0.cmp(b.0)` (байтовое сравнение UTF-8 = порядок кодовых точек; JS `Array.sort()` сравнивает UTF-16 code units — использовать компаратор по code points).
Имена файлов произвольны (`{id}_{ts_ns}.json` в тестах — не контракт); id берётся **из содержимого**.

### 2.4 Крайние случаи
Дубликаты/битый JSON/нечитаемый файл/отсутствующий каталог → ошибка конструктора (тесты `read_bad_*`). Для Electron/macOS: `.DS_Store` в каталоге сломает открытие библиотеки `[вывод из кода: нет фильтра по имени, filter_manager.rs:32-45; на macOS не запускалось]` — порт **должен** фильтровать `*.json` и игнорировать dot-файлы (осознанное расхождение; зафиксировать как decision).

### 2.5 Швы
I/O: `fs.readdir/readFile` (async, только при открытии). `Clock`/`Rng` не нужны. `Arc<SavedFilter>`→иммутабельный объект (`Object.freeze`).

### 2.6 Идиомы
`HashMap` + сортировка при выдаче — единственное место, где порядок определён (сохранить); `anyhow::Context` → `Error` с `cause` и путём файла.

### 2.7 Тесты (5 + 5)
| тест | что проверяет | портируемость | vitest |
|---|---|---|---|
| filter_manager::filter_manager | запись 2 фильтров в tmp, `list` отсортирован, `get` равен исходному | direct (tmpdir) | `mkdtemp` |
| filters_repeated_ids | 3 файла с одним id → конструктор `Err` | direct | `rejects` |
| read_bad_directory | несуществующий каталог → `Err` | direct | `rejects` |
| read_bad_file_format | `"bad json"` → `Err` | direct | `rejects` |
| read_bad_file_permissions | chmod 000 → `Err` | needs fixtures (POSIX; на CI под root не работает) | skip на Windows/root |
| study_session_manager::{session_manager, sessions_repeated_ids, read_bad_directory, read_bad_file_format, read_bad_file_permissions} | то же для сессий | как выше | как выше |
### 2.8 LOC: filter_manager 82/156; study_session_manager 82/116.

## 3. `preferences_manager.rs` + `UserPreferences` (`data.rs`)

### 3.1 Поверхность
```ts
interface UserPreferences {                       // data.rs:1105-1120, все поля #[serde(default)]
  transcription?: TranscriptionPreferences | null; // {instruments:[{name,id}], download_path?, download_path_alias?}
  scheduler?: { batch_size?: number | null } | null; // SchedulerPreferences data.rs:1086-1091
  ignored_paths: string[];                         // относительно корня библиотеки; дети тоже игнорируются
}
interface PreferencesManager { get(): UserPreferences; set(p: UserPreferences): void }  // sync file I/O ИЛИ async — см. §3.5
```
Rust: `PreferencesManager{get_user_preferences(&self)->Result<UserPreferences,_>, set_user_preferences(&mut self, p)}`; `LocalPreferencesManager{path}`.
`TranscriptionPreferences`: `transcription.rs:178-195` (`instruments: Vec<Instrument{name,id}>`, `download_path`, `download_path_alias`, все `#[serde(default)]`).

### 3.2–3.3 Алгоритмы
- `get`: `fs::read_to_string(path)` → `serde_json::from_str` (`preferences_manager.rs:28-34`); файла нет → `PreferencesManagerError::GetUserPreferences` (**без** создания по умолчанию — создаёт только `Trane::init_config_directory`).
- `set`: `to_string_pretty` (2 пробела) → `fs::write` (не атомарно, без fsync/tmp+rename; `:37-41`).
- Дефолт `[ИЗМЕРЕНО]` (`prefs_probe.out.txt`): `{\n  "transcription": null,\n  "scheduler": null,\n  "ignored_paths": []\n}` (+`"\n"` при создании в `lib.rs:231`); `{}` → все дефолты; лишние ключи принимаются.
- Семантика применения: `ignored_paths` читаются только при открытии библиотеки: `course_library.rs:431-467` — `library_root.join(path.trim_matches('/'))`, курс пропущен, если `manifest_path.startsWith(ignored.trimEnd('/') + '/')`. `scheduler.batch_size` читается только при конструировании (`create_scheduler_options`, `lib.rs:184-192`) и перекрывает **только** `batch_size`. `Trane::set_user_preferences` **не** пересобирает библиотеку/планировщик — эффект после переоткрытия.

### 3.4 Крайние случаи
Файл-каталог вместо `user_preferences.json` → ошибка открытия (`lib.rs:234-236`); невалидные значения (`batch_size:0`) не проверяются при `set`, но `options.verify()` в `new_local_helper` (`lib.rs:273`) роняет открытие (`batch_size==0` невалиден, `data.rs:987`).

### 3.5 Швы / идиомы
I/O — граница: интерфейс async в публичном API, внутри sync-хелпер; запись — atomic (tmp+rename) как улучшение; порт хранит время не нужно. `Option<T>`+`#[serde(default)]` → `T | null | undefined` (принимать оба, писать `null` для wire-совместимости).

### 3.6 Тесты
| тест | что проверяет | портируемость | vitest |
|---|---|---|---|
| local_preferences_manager | get без файла → Err; set/get default; set/get `ignored_paths` | direct | tmpdir |
| missing_preferences_file | Err при отсутствии файла | direct | `rejects` |
| unwritable_preferences_file | каталог chmod 0 → set Err | needs fixtures (POSIX) | skip под root/Windows |
| data.rs: user_preferences_clone / repository_metadata_clone / exercise_trial_clone / unit_reward_clone | `clone()==` | skip: тавтологии | — |
LOC: preferences_manager 58/58.

## 4. Хранилища: общие соглашения SQLite (`utils.rs`, все `Local*`)
- Соединение: `Connection::open(path)` + `journal_mode=WAL` + `synchronous=OFF` (`utils.rs:19-27`) `[ИЗМЕРЕНО]` + `foreign_keys=1` (bundled-дефолт). Тесты — `Connection::open_in_memory()` (WAL там не применяется).
- Миграции: `rusqlite_migration::Migrations::to_latest` (хранит версию в `PRAGMA user_version`). Пары «создать индекс → удалить индекс» оставлены для БД старых версий (комментарии `practice_stats.rs:66-75`, `blacklist.rs:56`); порт с чистого листа их не воспроизводит, но **чтение существующих `.trane/*.db` требует** совместимых `user_version`/схем (см. §4.8).
- Каждый store = `Mutex<Connection>`; ошибки оборачиваются в `*Error::{Op}(…, anyhow)` (`error.rs`).
- Идентификаторы юнитов не валидируются (можно писать несуществующие id).
- Время в БД — `INTEGER` секунды; `score/reward/weight/delta` — `REAL` (f32→f64 при записи, `0.05f32`→`0.05000000074505806` `[ИЗМЕРЕНО]`).
- Prefix-операции: `unit_id LIKE '<prefix>%'` — **регистронезависимо, `%` и `_` в префиксе — wildcard** `[ИЗМЕРЕНО]`. Port: реализовать `startsWith` (case-sensitive, буквальный) и явно зафиксировать отличие; для id вида `1::0` разницы нет, но `_`/`%` в id реальных курсов (`snake_case`!) дают лишние совпадения в Rust (напр. префикс `a_b` затрагивает `axb`).
- `VACUUM;` после каждого prefix-remove/trim (кроме `trim_rewards`); в порту — не нужен.

### 4.1 `blacklist.rs`
**Поверхность** (`:19-35`):
| метод | аргументы | семантика | порядок/лимиты |
|---|---|---|---|
| `add_to_blacklist` | `unit_id` | если в кэше есть `true` — no-op; иначе `INSERT INTO blacklist(unit_id)`; кэш→true | — |
| `remove_from_blacklist` | `unit_id` | `DELETE … WHERE unit_id=$1`; кэш→false (no-op если нет) | — |
| `remove_prefix_from_blacklist` | `prefix` | `SELECT unit_id … LIKE 'prefix%'`; удаляет по одному; кэш→false; `VACUUM` | — |
| `blacklisted` | `unit_id` | **точное** совпадение (кэш; промах кэша ⇒ `false` и запись `false` в кэш) | — |
| `get_blacklist_entries` | — | `SELECT unit_id FROM blacklist;` из БД (не кэш) | порядок не задан; тест ожидает порядок вставки (`vec![unit_id, unit_id2]`) ⇒ rowid asc де-факто `[НЕ ПОДТВЕРЖДЕНО контрактом]` |
TS:
```ts
interface Blacklist { add(id: string): void; remove(id: string): void; removePrefix(prefix: string): string[]; has(id: string): boolean; entries(): string[] }
```
**Состояние:** `cache: RwLock<UstrMap<bool>>`, прогрев в `new` всеми записями (`:80-82`); инвариант «кэш = БД». **Первичность:** первичный факт (намерение пользователя), не выводится из попыток. Наследование (курс/урок в blacklist) вычисляется **в планировщике**, не в сторе: `all_valid_exercises_in_lesson` (`data.rs:342-361`), `inside_blacklisted` (`:137-151`), `satisfied_effective_dependency` (`scheduler.rs:538-554`), `skip_course/skip_lesson`.
**Facade-побочка:** `Trane::add/remove/remove_prefix` сначала инвалидируют кэш оценок планировщика (`lib.rs:396-413`), затем пишут — порядок «invalidate→write» в порту заменить на транзакционный «write→invalidate» или событие.
**Восстановление из append-only лога:** события `BlacklistAdded{id,atMs}`, `BlacklistRemoved{id,atMs}`, `BlacklistPrefixRemoved{prefix,removedIds[],atMs}`; состояние = свёртка (множество). Prefix-событие писать **с разрешёнными id** (иначе повтор зависит от набора на момент воспроизведения и от LIKE-семантики). Добавление уже существующего — идемпотентно (события можно не писать).
**Тесты (7):** `not_in_blacklist` (пусто→false); `add_and_remove_from_blacklist`; `remove_prefix_from_blacklist` (`a,a::a,b,b::a,c,c::a`, префикс `a` удаляет ровно `a*`); `blacklist_cache` (повторный add — ранний выход); `readd_to_blacklist`; `all_entries` (порядок вставки); `reopen_blacklist` (персистентность на диске). Все **direct** (in-memory better-sqlite3 или Map+event log); `reopen` — tmp-файл. Добавить: `LIKE`-отличия (регистр, `_`).
LOC: 203 / 125.

### 4.2 `review_list.rs`
| метод | семантика |
|---|---|
| `add_to_review_list(id)` | `INSERT OR IGNORE INTO review_list(unit_id)` (идемпотентно, без кэша) |
| `remove_from_review_list(id)` | `DELETE … WHERE unit_id=$1` (no-op) |
| `get_review_list_entries()` | `SELECT unit_id from review_list;` — порядок не задан |
Схема/миграции — как blacklist (`review_list.rs:36-48`, user_version=3). **Первичный факт.** Восстановление — как у blacklist (`ReviewAdded/ReviewRemoved`). Кэша нет; префиксного удаления нет. Валидность id проверяет только планировщик (`get_unit_type_strict` → `Err`, §1.3). TS: `interface ReviewList { add(id): void; remove(id): void; entries(): string[] }`.
Тест (1): `add_and_remove_from_review_list` (двойной add → 2 записи; remove; порядок не проверяется) — direct. LOC: 126 / 38.

### 4.3 `practice_stats.rs` — журнал попыток (главный факт)
| метод | аргументы | семантика | порядок/лимиты |
|---|---|---|---|
| `get_scores` | `exercise_id, num_scores:u32` | `SELECT score,timestamp FROM practice_stats WHERE unit_uid=(SELECT unit_uid FROM uids WHERE unit_id=$1) ORDER BY timestamp DESC LIMIT ?2` (`:109-133`); неизвестный id → `[]`; `LIMIT 0` → `[]` | **`ORDER BY timestamp DESC`**, тай-брейка нет; при равных ts де-факто rowid DESC `[ИЗМЕРЕНО CLI]`. Потребитель: `get_scores(id, options.num_trials=20)` (`unit_scorer.rs:219`, `data.rs:1077`) |
| `record_exercise_scores` | `&[ExerciseTrial{exercise_id,score:f32,timestamp:i64}]` | одна транзакция; на каждый trial: `INSERT OR IGNORE INTO uids`, `INSERT INTO practice_stats(unit_uid,score,timestamp)`; дублей не отсеивает (`:136-159`) | порядок вставки = rowid |
| `trim_scores` | `num_scores` | для каждого `unit_uid`: `DELETE … AND timestamp NOT IN (SELECT timestamp … ORDER BY timestamp DESC LIMIT ?2)`; `VACUUM` (`:162-184`) | при равных ts остаются **все** строки с ts из топ-N (`[ИЗМЕРЕНО]`) |
| `remove_scores_with_prefix` | `prefix` | `uids WHERE unit_id LIKE 'prefix%'` → `DELETE FROM practice_stats WHERE unit_uid=…`; строки `uids` остаются; `VACUUM` | — |
TS (event-sourced): 
```ts
interface AttemptLog {                                  // sync (better-sqlite3)
  append(a: AttemptInput[]): void;                      // одна транзакция; a.tsMs, a.exerciseId, a.score(1..5)
  recent(exerciseId: string, n: number): Attempt[];     // ORDER BY ts DESC, id DESC LIMIT n
  removeByPrefix(prefix: string): number;               // команда сброса прогресса (как событие ProgressReset)
}
```
`trim_scores` в event-sourced порту **не нужен** (журнал append-only); замена — компакция снапшотом состояния FSRS-карточки. `trim_scores`/`remove_*_with_prefix` **нигде внутри Trane не вызываются** (`grep` по `src/`: только фасад `lib.rs:600-608` и тесты) ⇒ реальные БД растут без ограничений (кроме rewards, §4.4). Фасад не сбрасывает кэш оценок после `trim/remove` (`lib.rs:600-608`) — в порту инвалидировать.
Обход планировщика: публичный `PracticeStats::record_exercise_scores` на `Trane` **обходит** `score_exercise` (не пишет deltas/rewards, не обновляет relearn pile/success rate/кэш; `lib.rs:593-598`) — порт не экспортирует.
**Первичность:** ПЕРВИЧНЫЙ факт (единственный, из которого выводятся оценки, deltas, rewards). Схема: `uids`+`practice_stats`+`trials(unit_uid,timestamp)` (user_version=7, §0).
Тесты (6): `basic`; `multiple_records` (3 записи; `get_scores(1/3/10)` → `[5]`,`[5,4,3]`,`[5,4,3]`, ts убывает); `no_records`; `trim_scores_some_scores_removed` (`trim(2)` при ts 1,2,3 → `[5,4]`,`[3,1]`); `trim_scores_no_scores_removed`; `remove_scores_with_prefix` (`exercise1` затем `exercise`). Все direct; `trim` — только если порт оставит compaction (иначе переписать на compaction-тест). Не покрыто в Rust (добавить): тай-брейк равных ts, trim с равными ts. LOC: 238 / 179.

### 4.4 `practice_rewards.rs` — награды (производные)
| метод | семантика | порядок/лимиты |
|---|---|---|
| `get_rewards(unit_id, n)` | `SELECT reward,weight,timestamp … ORDER BY timestamp DESC LIMIT ?2`; потребитель: `num_rewards=10` для урока и курса (`unit_scorer.rs:240-246`, `data.rs:1079`), только если `scores.len() >= MIN_TRIALS_FOR_REWARD` | ts DESC, ties rowid DESC (как §4.3) |
| `record_unit_rewards(&[UnitReward])->Vec<Ustr>` | одна транзакция; на каждую награду: `has_similar_reward` → `continue`; иначе `INSERT OR IGNORE uids`, `INSERT`, **жёсткий кэп 20/юнит**, кэш+=награда, id в результат (`:190-230`). Возвращает id, реально записанных (для инвалидации кэша оценок) | — |
| `trim_rewards(n)` | для каждого `unit_uid`: `DELETE … WHERE id IN (SELECT id … ORDER BY timestamp DESC LIMIT -1 OFFSET ?2)` (по `id`, не по ts — ties безопасны) | `:234-250`, без VACUUM |
| `remove_rewards_with_prefix(p)` | `uids LIKE 'p%'` → `DELETE … WHERE unit_uid`; `VACUUM` | — |
**Константы и эвристика дедупликации** (`practice_rewards.rs:50-93`):
- `SECONDS_IN_DAY: i64 = 86_400` — окно «похожести» по времени. **В порту с мс: 86_400_000.**
- `WEIGHT_EPSILON: f32 = 0.1` — макс. разность весов для «похожих».
- `MAX_CACHE_SIZE: usize = 10` — награды на юнит в in-memory кэше.
- Жёсткий кэп строк на юнит: `OFFSET 20` в SQL (`:219`) — литерал в запросе, без константы.
Алгоритм на каждую входящую награду `r` юнита `u`:
1. `similar = cache[u].some(c => c.value === r.value && Math.abs(c.timestamp - r.timestamp) < DAY && Math.abs(c.weight - r.weight) < 0.1)`; строгое `<`, точное равенство `value` (f32 `==`); проверяется **любая** из ≤10 кэшированных, не только последняя;
2. `similar` → пропустить (не пишется, не в `updated`, кэш не меняется);
3. иначе INSERT → удалить всё за пределами 20 новейших по `timestamp DESC` (тай-брейк `rowid` не определён при ties) → `cache[u].push(r)`, при `len>=10` перед push `shift()` (вытеснение по порядку вставки, не по ts; комментарий про сортировку по возрастанию ts — допущение, не проверяется).
Особенности `[из кода]`: кэш **не персистентен** и не прогревается из БД (пуст при каждом старте процесса ⇒ первая награда после рестарта всегда пишется); **не инвалидируется** `trim_rewards`/`remove_rewards_with_prefix` (после сброса «похожая» награда продолжает подавляться, пока жива в кэше); хранится в `LocalPracticeRewards`, не в `Mutex` (доступ через `&mut self`).
**Первичность: ПРОИЗВОДНОЕ** от `(exercise_id, score, timestamp, unit_graph)`: `RewardPropagator::propagate_rewards` (`scheduler/reward_propagator.rs:31-58, 110-160`; константы `MIN_ABS_REWARD=0.2, MIN_WEIGHT=0.2, WEIGHT_FACTOR=0.8, REWARD_FACTOR=0.9`, стартовые reward: Five 0.8, Four 0.4, Three −0.3, Two −0.5, One −1.0) — чистая функция графа; пишутся награды для уроков/курсов, `timestamp` = timestamp попытки. Rebuild из лога попыток: для каждой попытки по возрастанию `(tsMs,id)` пересчитать `propagate_rewards` на **текущем** графе, прогнать через тот же dedup-кэш (свежий, пустой) и кэп 20. Расхождения с «боевым» состоянием: (а) граф мог быть другим в момент записи; (б) кэш dedup зависел от времени жизни процесса; (в) порядок `results.into_values()` (`UstrMap`) не определён — влияет только на rowid внутри одного timestamp. ⇒ rebuild детерминирован по построению, но **не побитово равен** Rust.
TS:
```ts
interface RewardStore { recent(unitId: string, n: number): UnitReward[]; record(rs: UnitReward[]): string[]; }
```
Тесты Rust (7): `basic`; `multiple_rewards` (`[-1,2,3]`, веса `[0.05,1,1]`); `many_rewards` (20 разных значений; выборка 10 → `19..10`); `no_records`; `trim_rewards_some_rewards_removed`; `trim_rewards_no_rewards_removed`; `remove_rewards_with_prefix`. **Ни один тест не покрывает ни dedup-кэш, ни кэп 20** (`many_rewards` вставляет ровно 20 — ничего не удаляется; значения все разные — dedup не срабатывает) ⇒ порту нужны новые тесты: (1) одинаковые value, |Δt|<1 сут, |Δw|<0.1 → пропуск; (2) граница 86_400_000 мс и Δw=0.1 → не пропуск; (3) 21-я запись вытесняет старейшую; (4) 11-я из кэша вытесняет первую (dedup перестаёт работать для неё); (5) кэш не сбрасывается remove_prefix (или осознанно исправить). LOC: 301 / 304.

### 4.5 `practice_deltas.rs` — отклонения (производные)
| метод | семантика |
|---|---|
| `get_deltas(exercise_id, n)` | `SELECT delta,timestamp … ORDER BY timestamp DESC LIMIT ?2`; потребитель — `num_trials=20`, читается только если у упражнения есть попытки (`unit_scorer.rs:221-233`) |
| `record_exercise_deltas(&[ExerciseDelta])` | транзакция; как `record_exercise_scores` |
| `trim_deltas(n)`, `remove_deltas_with_prefix(p)` | как `trim_scores`/`remove_scores_with_prefix` (та же `NOT IN (SELECT timestamp…)`-семантика и `LIKE`) |
Схема: `uids`+`practice_deltas(id,unit_uid,delta REAL,timestamp)`+`deltas_trials` (user_version=3).
**Производное:** пишется из `score_exercise` **только если у упражнения уже есть попытки** (`num_trials>0`): `delta = new_score.float_score() − existing_unit_score` (`scheduler.rs:1112-1133`), где `existing_unit_score` = `get_unit_score(exercise)` на момент **`now` (override или wall-clock), а не `timestamp` попытки** (`unit_scorer.rs:103-110`) и с учётом deltas/rewards на тот момент. ⇒ rebuild из лога **невозможен без** записи в событии wall-clock `recordedAtMs` и версии скорера; для FSRS-порта рекомендация: не воспроизводить (delta не нужен FSRS) или определить как `rating − predictedRating(retrievability)` на момент попытки и хранить в событии (производная проекция от `recordedAt`).
Тесты (6): `basic`, `multiple_records`, `no_records`, `trim_deltas_some_removed`, `trim_deltas_none_removed`, `remove_deltas_with_prefix` — зеркало practice_stats; direct. LOC: 211 / 179.

### 4.6 Сводка: первичное / производное и восстановление из append-only журнала попыток
| хранилище | статус | из чего строится | rebuild | ограничения |
|---|---|---|---|---|
| `practice_stats` | **первичное** (журнал) | попытки | — (это источник) | ts в с; нужен тай-брейк `id`; не хранит `recordedAt` |
| `practice_rewards` | производное | попытки + граф + dedup-кэш | replay `propagate_rewards` (§4.4) | не побитово; кэп 20; ms-окно |
| `practice_deltas` | производное | попытки + скорер на `now` | не воспроизводимо (§4.5) | нужен `recordedAt` в событии |
| `blacklist` | **первичное** (намерение) | события add/remove/removePrefix | fold в множество | prefix-события с разрешёнными id |
| `review_list` | **первичное** | события add/remove | fold | — |
| filters / study_sessions / preferences | первичная конфигурация (файлы JSON) | — | — | не события; wire-совместимые файлы |
| кэши оценок, `frequency_map`, `trial_counts`, relearn pile | эфемерное in-memory | — | старт пустыми | не персистятся в Rust (`lib.rs:274-286`) |
Рекомендуемая схема порта (для `spec` главного агента): единая таблица `events(id INTEGER PK, kind, payload JSON, tsMs, recordedAtMs)` + проекции `attempts`, `blacklist`, `review_list`, `rewards`; `recent(n)` — `ORDER BY tsMs DESC, id DESC`.

### 4.7 `utils.rs`
`weighted_average(values, weights)` (`:7-16`): `Σ(v_i·w_i)/Σw`; `Σw===0` → `0.0`; длины не проверяются: произведения — по `zip` (обрезка до короткого), а `Σw` — по **всем** `weights` (при `weights` длиннее `values` знаменатель завышен; порт — либо тот же `for i<min(len)` + полная `Σw` для побитового поведения, либо `assert equal length`). f32: тест ожидает `== 2.3`, в f64 `== 2.3` тоже `[ИЗМЕРЕНО]`. `new_connection` — §4. Тест `test_weighted_average` (3 кейса: значения, пустые, нулевые веса) — direct. LOC: 28 / 26.

### 4.8 Совместимость с существующим `.trane`
Чтобы открыть реальные каталоги Trane: читать `practice_stats.db` (uids+practice_stats), `blacklist.db`, `review_list.db`, `practice_rewards.db`, `practice_deltas.db`; импорт в `events`. `timestamp` — секунды (×1000). Не мигрировать WAL-файлы (`*.db-wal`, `*.db-shm` — служебные). Обратная запись в форматы Trane не требуется (`[решение для главного агента]`).

## 5. `lib.rs` — фасад `Trane`

### 5.1 Константы и раскладка каталога (`lib.rs:106-131`)
`<library_root>/.trane/` (`TRANE_CONFIG_DIR_PATH=".trane"`):
| путь | константа | содержимое |
|---|---|---|
| `practice_stats.db` | `PRACTICE_STATS_PATH` | SQLite (§4.3) |
| `practice_rewards.db` | `PRACTICE_REWARDS_PATH` | SQLite (§4.4) |
| `practice_deltas.db` | `PRACTICE_DELTAS_PATH` | SQLite (§4.5) |
| `blacklist.db` | `BLACKLIST_PATH` | SQLite (§4.1) |
| `review_list.db` | `REVIEW_LIST_PATH` | SQLite (§4.2) |
| `filters/` | `FILTERS_DIR` | `*.json` `SavedFilter` (§2) |
| `study_sessions/` | `STUDY_SESSIONS_DIR` | `*.json` `StudySession` (§2) |
| `user_preferences.json` | `USER_PREFERENCES_PATH` | `UserPreferences` pretty-JSON (§3) |
+ `*.db-wal`/`*.db-shm` при работе (WAL). Курсы читаются из корня библиотеки (`course_manifest.json` не в самом корне), `.trane` вне обхода не исключён явно — курсовые манифесты внутри `.trane` теоретически найдутся (`course_library.rs:443-467` фильтрует только `ignored_paths`) `[НЕ ПОДТВЕРЖДЕНО запуском]`.

### 5.2 Конструкторы
| Rust | поведение |
|---|---|
| `Trane::new_local(working_dir, library_root)` (`:309-328`) | `init_config_directory(library_root)`; prefs из `library_root/.trane/user_preferences.json`; библиотека = `PhysicalFS(working_dir.join(library_root))` (если `library_root` абсолютный — `join` вернёт его же); **данные `.trane` — по `library_root`, относительно CWD процесса, а не `working_dir`** |
| `new_local_with_vfs(library_root, vfs)` (`:334-352`) | курсы из любой VFS (embedded); `.trane` на диске |
| `new_local_from_serialized(library_root, SerializedCourseLibrary)` (`:358-380`) | библиотека из postcard-снапшота (`course_map, lesson_map, exercise_map, unit_graph`) |
| `init_config_directory` (`:196-238`) | `library_root` не каталог → `Err`; `.trane` нет → `create_dir` (не `create_dir_all`); `.trane` файл → `Err`; создаёт `filters/`, `study_sessions/`, `user_preferences.json` (дефолт, §3.3) если нет; prefs — не файл → `Err` |
| `new_local_helper` (`:243-303`) | открывает 5 БД (миграции), `LocalFilterManager`, `LocalStudySessionManager`, `SchedulerOptions::default()` + `batch_size` из prefs, **`options.verify()?`**, `SchedulerData{…, frequency_map:∅, trial_counts:(0,0)}`, `DepthFirstScheduler::new` |
Порт: `openEngine({ libraryRoot, dataDir?, clock, rng, fs? })`; вводить `dataDir` явно (в Electron — `app.getPath('userData')`, без `import 'electron'` в движке).

### 5.3 Миграции
Уровня фасада **нет** (нет общего номера версии, нет миграции JSON-файлов): только `rusqlite_migration` по каждой БД (`user_version` 3/3/7/5/3, §0). JSON: эволюция через `#[serde(default)]`. Порт: единый `PRAGMA user_version` своей БД + импорт из Trane (§4.8).

### 5.4 Публичные методы `Trane` (все делегируют под `RwLock`; `unsafe impl Send/Sync`, `lib.rs:765-768`)
| Rust метод | ответственность (1 строка) | группа TS-движка |
|---|---|---|
| `new_local`, `new_local_with_vfs`, `new_local_from_serialized`, `library_root` | создание/открытие, корень | `Engine.open()`, `engine.libraryRoot` (Lifecycle) |
| **Blacklist:** `add_to_blacklist`, `remove_from_blacklist`, `remove_prefix_from_blacklist` | правка списка + инвалидация кэша оценок (`invalidate_cached_score[s_with_prefix]`) | `engine.blacklist.{add,remove,removePrefix}` |
| `blacklisted`, `get_blacklist_entries` | чтение | `engine.blacklist.{has,list}` |
| **CourseLibrary:** `get_course_manifest`, `get_lesson_manifest`, `get_exercise_manifest` | манифест по id (`Arc`, `None`) | `engine.library.get{Course,Lesson,Exercise}(id)` → DTO/`undefined` |
| `get_course_ids`, `get_lesson_ids(course)`, `get_exercise_ids(lesson)`, `get_all_exercise_ids(Option<unit>)` | списки id, отсортированы по алфавиту (`course_library.rs:46-56`) | `engine.library.list*` |
| `get_matching_prefix(prefix, Option<UnitType>)` | множество юнитов по `startsWith` | `engine.library.matchPrefix` |
| **ExerciseScheduler:** `get_exercise_batch(Option<ExerciseFilter>)` | батч манифестов; инкремент `frequency_map` | `engine.scheduler.getBatch(filter?)` |
| `score_exercise(id, MasteryScore, ts)` | запись попытки → deltas → stats → инвалидация → relearn/success rate → rewards (`scheduler.rs:1104-1166`) | `engine.progress.recordAttempt` (единственный путь записи) |
| `get_unit_score(id)` | оценка курса/урока/упражнения, `Option<f32>` | `engine.progress.getUnitScore` |
| `invalidate_cached_score[s_with_prefix]` | сброс кэша оценок | внутреннее (не экспортировать; вызывается командами) |
| `get_scheduler_options`, `set_scheduler_options`, `reset_scheduler_options` | опции планировщика (в памяти; `set` не проверяет `verify`) | `engine.scheduler.{getOptions,setOptions,resetOptions}` (+`verify`) |
| `override_current_timestamp(Option<i64>)` | подмена `now` для скорера (бенчмарки/тесты) | заменить на `Clock` (не публичный метод) |
| **FilterManager:** `get_filter`, `list_filters` | сохранённые фильтры | `engine.filters.{get,list}` (+ `save/delete` — новое) |
| **StudySessionManager:** `get_study_session`, `list_study_sessions` | сохранённые сессии | `engine.sessions.{get,list}` (+ `save/delete` — новое) |
| **PracticeStats:** `get_scores`, `record_exercise_scores`, `trim_scores`, `remove_scores_with_prefix` | сырой доступ к журналу; `record_*` **обходит** `score_exercise`; `trim/remove` без инвалидации | `engine.progress.getAttempts(id,n)`, `engine.progress.resetProgress(prefix)`; `record/trim` не экспортировать |
| **PracticeRewards:** `get_rewards`, `record_unit_rewards`, `trim_rewards`, `remove_rewards_with_prefix` | сырой доступ к наградам | не экспортировать (внутренняя проекция) |
| **PracticeDeltas:** `get_deltas`, `record_exercise_deltas`, `trim_deltas`, `remove_deltas_with_prefix` | сырой доступ к deltas | не экспортировать |
| **PreferencesManager:** `get_user_preferences`, `set_user_preferences` | чтение/запись prefs (без пересборки) | `engine.preferences.{get,set}` (+`restartRequired` флаг) |
| **ReviewList:** `add_to_review_list`, `remove_from_review_list`, `get_review_list_entries` | список повторения | `engine.reviewList.{add,remove,list}` |
| **UnitGraph (24):** `add_course`, `add_lesson`, `add_exercise`, `add_dependencies`, `add_encompassed`, `set_encompasing_equals_dependency`, `add_superseded`, `update_starting_lessons` (мутаторы) | построение графа | **не экспортировать** (граф строит loader) |
| `encompasing_equals_dependency`, `get_unit_type`, `get_course_lessons`, `get_starting_lessons`, `get_lesson_course`, `get_lesson_exercises`, `get_exercise_lesson`, `get_dependencies`, `get_dependents`, `get_encompasses`, `get_encompassed_by`, `get_dependency_sinks`, `get_supersedes`, `get_superseded_by` | чтение графа | `engine.graph.*` (read-only DTO: массивы, `[id,weight][]`) |
| `check_cycles`, `generate_dot_graph(courses_only)` | диагностика | `engine.graph.{checkCycles,toDot}` |
| `get_scheduler_data` (приватный, тесты) | доступ к `SchedulerData` | не нужен (DI в тестах) |
Всего: 67 методов трейтов (5+8+9+2+4+4+4+2+3+2+24, `lib.rs:396-763`; UnitGraph: 8 мутаторов + 16 читающих) + 4 inherent (`new_local*`, `library_root`) = 71 публичный метод.

### 5.5 Идиомы и решения
- `Arc<RwLock<dyn T>>` → поля-интерфейсы, синхронные вызовы; блокировок не нужно (один поток; для utilityProcess — очередь команд).
- `Result<_, XError>` → `throw new EngineError(code, cause)`; коды: `BlacklistError.{AddUnit,GetEntries,RemovePrefix,RemoveUnit}`, `PracticeStatsError.{GetScores,RecordScore,TrimScores,RemovePrefix}` и т.д. (`error.rs:11-157`). `RepositoryManagerError`, `TranscriptionDownloaderError` в `error.rs` — остатки, модулей нет в `src/` (не переносить).
- Кэш оценок: `RefCell` внутри `UnitScorer` при `unsafe impl Sync` — не переносится; в TS однопоточно.
- `Blacklist` факад: порядок «invalidate→write» — заменить на write→invalidate в одной транзакции/команде.
- `set_scheduler_options` не вызывает `verify()` (в отличие от конструктора) → порт вызывает `verify()`.
- Тесты `lib.rs` (11): `library_root`; `library_root_is_not_dir`; `config_dir_is_file`; `bad_dir_permissions`; `bad_config_dir_permissions`; `user_preferences_file_is_a_dir`; `cannot_create_filters_directory`; `cannot_create_study_sessions`; `cannot_create_user_preferences`; `scheduler_data` (`get_scheduler_data()` не паникует — skip: wiring); `scheduler_options` (prefs `None` → default batch; `Some(10)` → 10 — direct). POSIX-permission тесты — needs fixtures, skip под root/Windows; остальные direct (tmpdir).
LOC: lib.rs 769 / 159.

## 6. `benchmark.rs` и `test_utils.rs` — что воспроизвести в TS-харнессе

### 6.1 `test_utils.rs` (587 нетестовых / 347 тестовых)
- **`TestId(course, lesson?, exercise?)`** (`:38-103`): `toString` = `"{c}"`, `"{c}::{l}"`, `"{c}::{l}::{e}"`; `from(string)` — split по `::`, `parseInt`; предикаты `isCourse/isLesson/isExercise`, `exerciseInLesson(l)` (`c` и `l` равны и есть exercise), `exerciseInCourse(c)` (`c` равен и есть lesson и exercise). TS: `class TestId` с теми же.
- **`TestLesson{id,dependencies,encompassed:[(id,weight)],superseded,metadata,numExercises}`**, **`TestCourse{id,dependencies,encompassed,superseded,metadata,lessons}`** (`:106-317`): строят каталог на диске `course_{c}/course_manifest.json`, `lesson_{l}/lesson_manifest.json`, `exercise_{e}/exercise_manifest.json` + `question.md`,`answer.md`, `instructions.md`,`material.md`; id упражнений `c::l::e`; `exercise_type=Procedural`, `FlashcardAsset{front:'question.md',back:'answer.md'}`; валидации: `lesson.id.isLesson()`, `course.id.isCourse()`, `lesson.id.0===course.id.0` иначе `Err`. Для TS-теста лучше собирать библиотеку **в памяти** (in-memory `CourseLibrary`) и отдельно один тест на запись на диск/загрузку (LoaderBench).
- **`RandomCourseLibrary{numCourses, courseDependenciesRange, lessonsPerCourseRange, lessonDependenciesRange, exercisesPerLessonRange}`** (`:332-431`, диапазоны включительно): зависимости курса — на курсы с **меньшим** индексом (ациклично): `n=random(range)`, при `n==0` → пусто, иначе `min(n, courseIndex)` попыток `random(0..courseIndex)` с пропуском дублей; урок аналогично внутри курса (`min(n, lessonIndex)`); `metadata={}`, `encompassed=superseded=[]`. Rng: `rand::rng()` (не сидируется) → в TS принимать `Rng`; «дубли пропускаются» ⇒ фактических зависимостей может быть меньше `n`.
- **`TraneSimulation{numExercises, answerClosure(id)→score|None, answerHistory}`** (`:437-508`): `run(trane, blacklist[], filter?)`: (1) `add_to_blacklist` для каждого; (2) цикл `while completed < numExercises`: `completed++` (считается **даже** если ответ `None`); пустой `batch` → `get_exercise_batch(filter.clone())`, пустой результат → `break`; берёт `batch.pop()` (**с конца**); `score=answerClosure(id)`; `Some` → `score_exercise(id, score, Utc::now().timestamp())` и `answerHistory[id].push(score)`. ⇒ **все попытки одной симуляции имеют почти одинаковый timestamp (секундная точность)**. TS: `Clock` с авто-тиком (например +1 с/попытку или конфигурируемый шаг) — иначе FSRS-оценки не отличают повторы.
- `init_simulation(root, courseBuilders, prefs?)` (`:512-535`): строит курсы, пишет `user_preferences.json` (`create_dir(.trane)` — падает, если уже есть), `Trane::new_local(root, root)`. `init_test_simulation(root, courses)` (`:539-555`): параллельная (`rayon`) сборка + замер времени загрузки. `assert_simulation_scores(id, trane, history)` (`:559-586`): `get_scores(id, 10)` сравнивается с **последними ≤10** значениями истории (`|Δ| < f32::EPSILON`) в обратном порядке (последний ↔ новейший) — то есть проверяет порядок `ts DESC` **при равных ts** (rowid DESC) ⇒ порту нужен тай-брейк по id (§4.3).
- Тесты `test_utils` (12): `exercise_in_lesson`, `exercise_in_course`, `id_type`, `conversion_to_string`, `conversion_from_string` (direct); `build_test_library`, `build_random_test_library`, `bad_test_lesson`, `bad_test_course_id`, `bad_lesson_in_course`, `bad_exercise_simulation` (needs fixtures/loader; для in-memory — direct на валидации); `run_exercise_simulation` (500 упр. score 5 на 2 курсах ⇒ все упражнения запланированы + `assert_simulation_scores`; needs rng seam + Clock).

### 6.2 `benchmark.rs` (384 / 170) — профили студентов и бенчмарк
Данные (`:127-179`); `PerformanceProbs=[p1..p5]` (сумма 1.0 ±1e-4, `verify_probs`, `:27-34`):
| профиль | session_frequency (дни) | exercises_per_session | initial | trials_before_stable | stable | lapse_rate |
|---|---|---|---|---|---|---|
| remedial | 4 | 25 | [0.3,0.2,0.25,0.15,0.1] | 5 | [0.03,0.02,0.1,0.2,0.65] | 0.1 |
| below_median | 3 | 25 | [0.2,0.25,0.3,0.15,0.1] | 5 | [0.02,0.03,0.1,0.2,0.65] | 0.08 |
| median | 2 | 30 | [0.15,0.25,0.3,0.18,0.12] | 4 | [0.02,0.03,0.1,0.15,0.7] | 0.07 |
| above_median | 1 | 40 | [0.1,0.15,0.4,0.2,0.15] | 4 | [0.01,0.03,0.06,0.15,0.75] | 0.06 |
| excellent | 1 | 50 | [0.08,0.12,0.4,0.2,0.2] | 3 | [0.0,0.02,0.03,0.15,0.8] | 0.05 |
`mastery_threshold=4.3`, `max_sessions=2000` (`:174-177`). Алгоритм `simulate_student` (`:260-330`):
1. копия библиотеки во временный каталог; `set_scheduler_options(opts)`; `anchor = now`; `all_courses`;
2. для `session in 0..max_sessions`: `session_start = anchor + session*freq*86400`; пока `in_session < exercises_per_session`: `batch_ts = session_start + in_session` → `override_current_timestamp(batch_ts)`; `get_exercise_batch(None)`; пусто → выход из всех циклов; для каждого `ex` в батче (до лимита): `score = get_score(profile, trial_counts[ex])`; `ts = session_start + in_session`; `score_exercise(ex, score, ts)`; `trial_count++`;
3. в конце сессии `override_current_timestamp(session_start + in_session)`; `check_mastery`: `get_unit_score(advanced_course) >= 4.3` **и** все курсы `>= 4.3` ⇒ `days_to_mastery = session*freq`, стоп.
`interpolate_performance(p, n)`: `w = min(n/trials_before_stable, 1)`; `probs[i] = initial[i]*(1-w) + stable[i]*w`. `get_score(p, n)`: `lapse = rand()<lapse_rate`; `lapse && n > trials_before_stable` → `Two`; иначе `WeightedIndex(interp)` → 1..5. Результат `{days_to_mastery?, sessions_run, exercises_practiced}`. Пять потоков параллельно. Сид отсутствует → в TS принимать `Rng` (детерминизм).
Тесты (11): `performance_probs_validate_{valid,invalid}`, `interpolate_performance_{initial,stable,blend}` (`t=5`: `[0.25,0.2,0.15,0.175,0.225]`), `session_timestamp` (86400·k), `exercise_timestamp`, `get_score_deterministic`, `get_score_with_lapses` (10 итераций — **флейки-риск**: `P(нет Two)=0.5^10≈0.1 %`; в порту сид), `verify_default_benchmark` — direct; `run_benchmark` (`tests/small_test_library`, `advanced_course="trane::music::improvise_for_real::sing_the_numbers::3"`, `max_sessions=50`; above_median и excellent достигают мастерства ⇒ **эмпирический** критерий, зависит от скорера — для FSRS порога 4.3 и прогона 50 сессий нужно перекалибровать) — needs fixtures + rng seam. `bin/trane-benchmark.rs` — CLI-обёртка (не портировать). Единицы: секунды (`86400`) → мс (`86_400_000`).

## 7. Интеграционные тесты `tests/*.rs` (47 тестов)
Общая методика (`basic_tests.rs:1-28`): симуляция «студент отвечает всегда одинаково» + нестрогие утверждения «эти упражнения появились / те не появились» (планировщик недетерминирован: shuffle стека, случайная выборка в корзинах). Ответ `Five`×N ⇒ прогресс; `One` ⇒ застревание на первых уроках. Все тесты используют wall-clock `Utc::now()` и не сидируемый RNG ⇒ **для порта требуются Clock (с тиком) + сидируемый Rng + ограниченное число итераций**.
Легенда вех порта (моя нумерация, согласовать с Main): **M1** загрузка манифестов+граф+`CourseLibrary`; **M2** хранилища/журнал попыток/blacklist/review-list; **M3** скорер (FSRS) + rewards; **M4** планировщик (DFS, candidate filter, knocker, relearn, shuffler); **M5** фильтры/сессии/review-list-режим; **M6** фасад/директория/prefs/сериализация; **M7** генераторы курсов.

### 7.1 `basic_tests.rs` (22) — библиотека `LIBRARY` (`:49-299`)
Курсы 0…9 (3 отсутствует: на неё ссылаются 5 и 6): `0`(2 урока, `0::1` зав. `0::0`); `1,2`←`0` (2/3 урока-цепочки); `4` (4 урока: `4::1` зав. `4::0` и **`2::1`** (межкурсовая), `4::2`←`4::0`, `4::3`←`4::2`); `5` (зав. отсутствующий `3` и `4`; уроки `5::0`←`4::1`, `5::1`←`5::0` и отсутствующий `3::3`; урока `5::2` в LIBRARY **нет** — он лишь в списке ожиданий `schedule_units_and_dependents`, `basic_tests.rs:727`); `6` (зав. отсутствующий `3`, `encompassed 5::0 w=0.5`; 2 урока); `7` (метаданные `course_key_1/2:value_1`; `7::0`←курс `0`, `7::1`←`0::0` и отсутствующий `6::11`, `7::2`←`7::1`, encompasses `7::0` w=1.0, **0 упражнений**); `8` (без уроков, зав. `7`); `9` (без уроков, без зав.). По 10 упражнений/урок.
| тест | сценарий | утверждение | веха |
|---|---|---|---|
| get_unit_ids | id курсов/уроков/упражнений | `get_course_ids == [0,1,2,4,5,6,7,8,9]` (сортировка); id уроков/упр. согласованы по префиксам | M1 |
| get_all_exercise_ids | `Some(course/lesson/exercise/несуществ.)`, `None` | префиксы; упражнение→само себя; несуществ.→`[]`; `None`→всё | M1 |
| all_exercises_scheduled | `Five`×(N·25), без фильтра | каждое упражнение в `answer_history`; `assert_simulation_scores` | M4+M3 |
| bad_score_prevents_advancing | `One`×200 | запланированы только уроки `0::0,4::0,6::0`; остальные — нет | M4 (порог `passes_threshold`) |
| scheduler_respects_course_filter | 1-й прогон `CourseFilter[4]` (разблокировать 4); 2-й `CourseFilter[2, 3(нет)]` | ровно упражнения курса 2; граница курса не пересекается (4 зависит от `2::1`) | M5 |
| scheduler_respects_lesson_filter | `LessonFilter[2::0, 4::1, 3::0(нет)]` | только эти уроки | M5 |
| schedule_exercises_in_review_list | review: упражнения `1::0::0`, `2::1::7` + `ReviewListFilter` | только эти 2 упражнения | M5+M2 |
| schedule_lessons_in_review_list | review: уроки `1::0`, `2::1` | упражнения только этих уроков | M5+M2 |
| schedule_courses_in_review_list | review: курсы `1`,`2` | упражнения только этих курсов | M5+M2 |
| schedule_units_and_dependents | `Dependents[5::0]`, `Five`×500 | `5::0,5::1,5::2` и только они | M5 |
| schedule_dependencies | `Dependencies[5::1], depth=1` | уроки `5::0,5::1` | M5 |
| schedule_dependencies_large_depth | `Dependencies[course 2], depth=5` | курсы `0,1,2,7,8` | M5 |
| schedule_dependencies_unknown_unit | `Dependencies[20], depth=5` | ничего не запланировано | M5 |
| schedule_study_session | `start=now−30 мин`; части: курс `0` (15 мин), курс `1` (30 мин) | активна 2-я часть ⇒ только курс `1` (**Clock seam обязателен**) | M5 |
| get_matching_courses/_lessons/_exercises/_units | префикс `0`, `0::0`, `0::0::0` с `UnitType` / без | 1/1/1/**23** юнита (курс+2 урока+20 упр.) | M1 |
| set_scheduler_options / reset_scheduler_options | `batch_size=10` → get; reset → default | значение применено/сброшено | M6 |
| ignored_paths | prefs `ignored_paths=["course_0/","course_5/"]` | нет упражнений `0::*`, `5::*` | M1+M6 |
| serialized_course_library | postcard-round-trip `SerializedCourseLibrary`, `new_local_from_serialized` | равенство `course_map/lesson_map/exercise_map/unit_graph`; `get_all_exercise_ids ≠ ∅` | M1+M6 (формат снапшота в порту — свой, например structuredClone/JSON) |

### 7.2 `blacklist_tests.rs` (6) — библиотека: курсы 0–5, по 10 упражнений/урок; `1,2,4,5` зависят от `0`, `3` зависит от `1`; уроки внутри курса — цепочки (`0`:2, `1`:2, `2`:3, `3`:2, `4`:2, `5`:2 урока) (`:21-182`)
| тест | сценарий | утверждение | веха |
|---|---|---|---|
| avoid_scheduling_courses_in_blacklist | blacklist курсов `0`, `3`; `Five`×500 | запланировано всё, кроме `0::*`, `3::*` (зависимые от `0` разблокированы: blacklisted-зависимость «выполнена») | M2+M4 |
| avoid_scheduling_lessons_in_blacklist | blacklist уроков `0::1`, `3::0` | всё кроме них | M2+M4 |
| avoid_scheduling_lessons_in_blacklist_with_course_filter | те же + `CourseFilter[0,3]` | упражнения курсов 0,3 кроме blacklisted уроков | M2+M5 |
| avoid_scheduling_exercises_in_blacklist | 10 упражнений `2::1::*` | они не планируются, всё остальное — да | M2+M4 |
| schedule_courses_with_many_blacklisted_units | `max_lessons_in_progress=5`, blacklist курсов 0–4 | курс 5 планируется (регрессия: blacklisted не должны считаться «в процессе») | M4+M2 |
| invalidate_cache_on_blacklist_update | blacklist 20 упражнений уроков `0::0,0::1`, `Five`; затем `remove_from_blacklist` каждого + `One`×500; затем снова blacklist + `Five`×500 | 1-й прогон: blacklisted не планируются, остальные да; после снятия: планируется `0::0`, а уроки `0::1,1::*,2::*,3::*` — нет (оценка `0::0` низкая, кэш не устарел); 3-й прогон: blacklisted снова не планируются | M2+M3 (инвалидация кэша оценок при правке blacklist) |

### 7.3 `metadata_tests.rs` (7) — `LIBRARY` (метаданные `course_key_{1,2}`/`lesson_key_{1,2}` со значениями `value_N`), `BRIDGE_LIBRARY`, `BRIDGE_COURSE_LIBRARY` (`:20-517`)
| тест | сценарий | утверждение | веха |
|---|---|---|---|
| scheduler_respects_metadata_filter_op_all | `Combined All[Course(course_key_1=value_2), Lesson(lesson_key_2=value_4)]` | уроки `2::1, 2::2, 5::0` | M5 |
| …_op_any | то же с `Any` | уроки `2::0,2::1,2::2,5::0,5::1` (курсы value_2 целиком + уроки value_4) | M5 |
| scheduler_respects_lesson_metadata_filter | `Lesson(lesson_key_2=value_4)` | `2::1,2::2,5::0` | M5 |
| scheduler_respects_course_metadata_filter | `Course(course_key_1=value_2)` | курсы `2`, `5` | M5 |
| scheduler_respects_metadata_filter_and_blacklist | All-фильтр + blacklist курса `2` | только `5::0` | M5+M2 |
| scheduler_bridges_filtered_dependency_chain | цепь уроков `0::0(keep)→1::0→2::0→3::0(keep)`, фильтр `Lesson(bridge_key=keep)`; сначала `One`×400, затем `Five`×400 | при `One`: `0::0` запланирован, оценка урока < `min_score`, `3::0` **нет**; при `Five`: `3::0` запланирован | M5 (мосты, §1.3) |
| scheduler_bridges_filtered_course_dependencies | фильтр `Lesson(bridge_key=keep)`; курс `0` (уроки `0::0`,`0::1` оба keep; сам курс фильтр не проходит); урок `1::0`(keep) зав. **курс** `0`; курс `3` (нет keep-уроков) зав. урок `2::0`(keep); урок `4::0`(keep) зав. **курс** `3`; 1-й прогон (500): `0::0::*`=Five, остальное One; 2-й: Five | при частичном мастерстве `1::0::0` и `4::0::0` **не** планируются; при полном — планируются (мост: отфильтрованный курс → последний matching-урок в курсе, `0::1`; курс без matching-уроков → его зависимости, `2::0`) | M5 |

### 7.4 `superseded_tests.rs` (5) — курсы 0–7 с `superseded` (`:19-228`)
Курс `1` заменяет `0`; урок `2::2` заменяет `2::0`; курс `4` заменяет `3`, курс `5` заменяет `4`; урок `6::1` заменяет `6::0`, `6::2` заменяет `6::1`; курс `7` зав. `6`.
| тест | сценарий | утверждение | веха |
|---|---|---|---|
| scheduler_respects_superseded_courses | `Five`×2000 → 2-й прогон; затем `One` для `1::*` | после мастерства курс `0` не планируется; при плохих оценках заменяющего курса `1` — планируется снова | M3+M4 |
| scheduler_respects_superseded_lessons | то же для `2::0` / `2::2` | аналогично | M3+M4 |
| scheduler_respects_superseded_course_chain | `3,4,5`: `One` для `5::*`; затем для `4::*` и `5::*` | при плохом `5` возвращается 4-й (но не 3-й); при плохих 4 и 5 — 3-й | M3+M4 (`get_superseding_recursive`) |
| scheduler_respects_superseded_lesson_chain | цепь уроков `6::0,6::1,6::2` | аналогично | M3+M4 |
| scheduler_ignores_superseded_exercises (`:582`) | `One` только на замещённые уроки `6::0,6::1` (фильтр), затем `Five` на `6::2`, затем всё `Five` | курс `7` планируется (замещённые уроки не тянут среднюю оценку курса вниз) | M3+M4 |

### 7.5 `generated_courses.rs` (3), `large_tests.rs` (2), `embedded_fs.rs` (2)
| тест | сценарий | утверждение | веха |
|---|---|---|---|
| knowledge_base_course_generator_assets | `KnowledgeBase{inlined:false}`, 2 урока, 2 упражнения, ассеты на диске | `get_all_exercise_ids==2`, все запланированы (`Five`×10·N); пути ассетов относительны корня библиотеки и читаются; id `knowledge_base_course::lesson_0::exercise_0` | M7+M1 |
| literacy_course_generator | `Literacy{generate_dictation:true}` | 4 упражнения достижимы | M7 |
| transcription_course_generator | `Transcription` + prefs `instruments=[piano]` | 4 упражнения достижимы | M7+M6 (prefs влияют на генерацию) |
| all_exercises_scheduled_random | `RandomCourseLibrary{50 курсов; зав. курсов 0..5; уроков 0..5; зав. уроков 0..5; упр. 0..10}`, `min_avg_trials=1.0`, `Five`×(N·50) | все упражнения запланированы | M4+M3 (масштаб) |
| generate_and_read_large_library | 50 курсов ×(5 зав.,5 уроков,5 зав.,5 упр.) | построение и чтение без ошибок (замер времени) | M1 (LoaderBench) |
| loads_embedded_course_library | `EmbeddedFS` (rust-embed) с `raw_course` | id `embedded::raw_course…`; ассеты читаются; markdown `"…\n"` | M1 (аналог: загрузка из in-memory FS) |
| opens_trane_with_embedded_course_library | `new_local_with_vfs(data_root, EmbeddedFS)`; `.trane` создаётся в физическом `data_root` | `data_root/.trane` — каталог; `get_all_exercise_ids(None) == ["embedded::raw_course::lesson::exercise"]` | M1+M6 |

## 8. Сводный список тестов остальных модулей (для Main)
Прямые (direct): все таблицы §1.7, §2.7, §3.6, §4.1–4.7, §5.5, §6.1–6.2. `needs rng seam`: `get_score_with_lapses`, `run_benchmark`, `run_exercise_simulation`, все интеграционные тесты §7. `needs fixtures`: POSIX-права (`read_bad_file_permissions` ×2, `unwritable_preferences_file`, `bad_dir_permissions`, `bad_config_dir_permissions`, `cannot_create_*`), embedded/serialized library, `tests/small_test_library` (для `run_benchmark`). `skip-with-reason`: `*_clone`, `unit_filter_clone`, `scheduler_data` (wiring), `serialized_course_library` (postcard — заменить своим форматом).

## 9. Rust-идиомы, требующие решения (сводка)
1. `Ustr`/`UstrMap`/`UstrSet` → `string`/`Map`/`Set`; порядок итерации `HashMap/UstrSet` не определён — порт должен либо сортировать, либо (для scheduler) допускать любой порядок; `list_*` и `get_*_ids` сортируются в Rust — сохранить (comparator по code points).
2. serde externally-tagged enums (§1.1/1.4) + `#[serde(default)]` — zod с `union`/`default`; unit-variant как строка; принимать `null`.
3. `f32`: хранение score/reward/weight/delta как REAL (f64 при чтении, §0); сравнения `r.value == reward.value` точные — в TS те же формулы дадут одинаковые значения для одинаковых входов; **не** сравнивать с Rust побитово.
4. `usize/u32/i64`: `depth`, `duration`, `num_*` — неотрицательные целые (валидировать); `timestamp` i64 → `number` (мс безопасны до 2^53).
5. `Result<_, Error>` → исключения с кодами; `anyhow::Context` → `cause`.
6. `Arc<RwLock<dyn Trait>>` + `RefCell` в `UnitScorer` + `unsafe impl Send/Sync` → однопоточный движок за очередью команд.
7. Время: `Utc::now()` в `scheduler.rs:1032`, `unit_scorer.rs:109`, `test_utils.rs:497`, `benchmark.rs:271` → `Clock`. Секунды→мс: `SECONDS_IN_DAY=86_400`→`86_400_000` (rewards dedup), `86400`→`86_400_000` (benchmark), `get_part` минуты = `floor(diff_ms/60_000)` с усечением к нулю (`Math.trunc`).
8. SQL: `LIKE` → `startsWith` (case-sensitive) — осознанное расхождение (§4); тай-брейк `id DESC`; `VACUUM` не нужен; `foreign_keys=1` не воспроизводить (без `uids`).

## 10. Неразрешённое / неоднозначности
- `get_blacklist_entries`/`get_review_list_entries` — порядок без `ORDER BY`; тест `all_entries` ожидает порядок вставки; для bundled SQLite `[НЕ ПОДТВЕРЖДЕНО]` (проверено только CLI 3.51.0 для `ORDER BY ts DESC`).
- Попадание `.trane/**/course_manifest.json` в обход библиотеки (§5.1) — из кода видно только отсутствие исключения; не запускалось.
- `MIN_TRIALS_FOR_REWARD`, `num_trials/num_rewards` — значения `20/10` подтверждены (`data.rs:1077-1079`); константа `MIN_TRIALS_FOR_REWARD` — в спеке скорера.
- Порт `Dependents`/`Dependencies` для Exercise-id: Rust молча игнорирует (DFS обрабатывает только Course/Lesson); подтверждено чтением (`scheduler.rs:751-877`), запуском — нет.
- Web-книга Trane: проверена только главная страница; остальные страницы `[НЕ ПОДТВЕРЖДЕНО]`.
- Milestone-нумерация M1–M7 (§7) — моя, не из задания.

## 11. LOC (нетестовые / тестовые; `wc -l` + позиция `#[cfg(test)]`)
| файл | всего | нетест | тест | #тестов |
|---|---|---|---|---|
| data/filter.rs | 1208 | 385 | 823 | 22 |
| filter_manager.rs | 238 | 82 | 156 | 5 |
| study_session_manager.rs | 198 | 82 | 116 | 5 |
| preferences_manager.rs | 116 | 58 | 58 | 3 |
| blacklist.rs | 328 | 203 | 125 | 7 |
| review_list.rs | 164 | 126 | 38 | 1 |
| practice_stats.rs | 417 | 238 | 179 | 6 |
| practice_rewards.rs | 605 | 301 | 304 | 7 |
| practice_deltas.rs | 390 | 211 | 179 | 6 |
| utils.rs | 54 | 28 | 26 | 1 |
| lib.rs | 928 | 769 | 159 | 11 |
| benchmark.rs | 554 | 384 | 170 | 11 |
| test_utils.rs | 934 | 587 | 347 | 12 |
| data.rs (UserPreferences и др.; вся data.rs — в другой спеке) | 1587 | 1122 | 465 | 29 |
| tests/basic_tests.rs | 1171 | — | 1171 | 22 |
| tests/blacklist_tests.rs | 521 | — | 521 | 6 |
| tests/metadata_tests.rs | 942 | — | 942 | 7 |
| tests/superseded_tests.rs | 674 | — | 674 | 5 |
| tests/generated_courses.rs | 300 | — | 300 | 3 |
| tests/large_tests.rs | 76 | — | 76 | 2 |
| tests/embedded_fs.rs | 123 | — | 123 | 2 |
