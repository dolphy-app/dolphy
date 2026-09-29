# Spec: ядро планировщика Trane v0.34.1 (scheduler.rs, scheduler/data.rs, relearn_pile.rs, shuffler.rs, опции из data.rs)

Все ссылки `file:line` — относительно `trane-pristine/src/`. Время в Rust — секунды (i64), в порте — мс. Числа в Rust f32, в TS f64 (см. §6).
Соседние модули (`unit_scorer`, `filter` (CandidateFilter), `review_knocker`, `reward_propagator`) вне этого документа; здесь описаны только точки вызова.

## 0. Call graph

```
Trane.get_exercise_batch (lib.rs:465) ──► DepthFirstScheduler.get_exercise_batch (scheduler.rs:1056)
  ├─ get_initial_candidates(filter)                                   :975   (фаза 1: поиск)
  │    ├─ None            → get_initial_stack(None) → get_candidates_from_graph → …_helper(allow_course_traversal=true)
  │    ├─ Course          → get_candidates_from_course → …_helper(false, allowed_courses)
  │    ├─ Lesson          → get_candidates_from_lesson (по каждому id) → get_candidates_from_lesson_helper
  │    ├─ Metadata        → get_initial_stack(Some(f)) → get_candidates_from_graph(…, Some(f))
  │    ├─ ReviewList      → get_candidates_from_review_list  (Course→…_from_course, Lesson→…_from_lesson, Exercise→прямой Candidate)
  │    ├─ Dependents      → стек из unit_ids (depth 0) → get_candidates_from_graph(…, None)
  │    ├─ Dependencies    → data.get_dependencies_at_depth → стек → get_candidates_from_graph(…, None)
  │    ├─ StudySession    → data.get_session_filter(session, Utc::now()) → рекурсия get_initial_candidates(Option<UnitFilter>)
  │    └─ deduplicate_candidates (по exercise_id, первый выигрывает)   :968
  ├─ review_knocker.knock_out_reviews(cands)                          (фаза 2, вне документа)
  ├─ filter.filter_candidates(cands)                                  (фаза 3, CandidateFilter, вне документа)
  ├─ relearn_pile.select_exercises(&data)                             (фаза 4) + отсев уже вошедших в батч
  ├─ Shuffler::shuffle_candidates(final, &options)                    (фаза 5)
  ├─ candidates_to_exercises → data.get_exercise_manifest             :1043
  └─ data.increment_exercise_frequency (по каждому)                   (побочный эффект, in-memory)

get_candidates_from_graph_helper (:726)
  ├─ get_course_valid_starting_lessons → all_satisfied_dependencies → satisfied_dependency
  │       → resolve_effective_dependencies (мост через отфильтрованные юниты) → satisfied_effective_dependency → passes_threshold
  ├─ skip_course / skip_lesson (blacklist, metadata filter, superseded)
  ├─ get_valid_dependents → all_satisfied_dependencies
  ├─ get_candidates_from_lesson_helper → unit_scorer.{get_unit_score,get_exercise_urgency,get_exercise_velocity}, select_candidates
  ├─ unit_scorer.get_avg_trials, passes_threshold
  └─ extend_candidates (лимит max_lessons_in_progress)

Trane.score_exercise (lib.rs:472) ──► DepthFirstScheduler.score_exercise (:1104)
  unit_scorer.get_unit_score / get_exercise_num_trials → practice_deltas.record_exercise_deltas → practice_stats.record_exercise_scores
  → unit_scorer.invalidate_cached_score → relearn_pile.update → data.update_success_rate
  → reward_propagator.propagate_rewards → practice_rewards.record_unit_rewards → unit_scorer.invalidate_cached_score(updated_ids)
```

## 1. Назначение и публичная поверхность

Модуль — ядро: по графу юнитов, оценкам и настройкам выдаёт батч упражнений и принимает оценки. Публично: трейт `ExerciseScheduler` (:52-104), `DepthFirstScheduler::{new, get_course_valid_starting_lessons}` (:190, :256), `scheduler::data::SchedulerData` (pub). Приватно: `StackItem`, `Candidate`, `MAX_CANDIDATE_FACTOR`, `RelearnPile`, `Shuffler`.

Предлагаемые TS-сигнатуры (синхронно, DTO-типы; `async` — только на фасаде движка):

```ts
export type UnitId = string;
export type MasteryScore = 1 | 2 | 3 | 4 | 5;          // Rust enum One..Five, float_score() = число

export interface ExerciseScheduler {
  getExerciseBatch(filter?: ExerciseFilter): ExerciseManifest[];          // throws ExerciseSchedulerError{kind:'GetExerciseBatch'}
  scoreExercise(exerciseId: UnitId, score: MasteryScore, timestampMs: number): void; // kind:'ScoreExercise'
  getUnitScore(unitId: UnitId): number | undefined;                       // kind:'GetUnitScore'
  invalidateCachedScore(unitId: UnitId): void;
  invalidateCachedScoresWithPrefix(prefix: string): void;
  getSchedulerOptions(): SchedulerOptions;
  setSchedulerOptions(o: SchedulerOptions): void;
  resetSchedulerOptions(): void;
  // Rust: override_current_timestamp(Option<i64>) — заменить инжектируемым Clock (см. §5)
}

interface StackItem { unitId: UnitId; depth: number }                   // depth: usize
interface Candidate {                                                   // scheduler.rs:121, Default::default() = ""/0/false/undefined
  exerciseId: UnitId; lessonId: UnitId; courseId: UnitId;
  depth: number; exerciseScore: number; frequency: number;
  urgency: number; velocity?: number; deadEnd: boolean;
  encompassesWeight: number; encompassedWeight: number;
}
export interface SchedulerData {                                        // scheduler/data.rs:26
  options: SchedulerOptions;
  courseLibrary: CourseLibrary; unitGraph: UnitGraph; practiceDeltas: PracticeDeltas;
  practiceStats: PracticeStats; practiceRewards: PracticeRewards; blacklist: Blacklist;
  reviewList: ReviewList; filterManager: FilterManager;
  frequencyMap: Map<UnitId, number>;                                    // in-memory, время жизни = планировщик
  trialCounts: { success: number; failed: number };                     // in-memory, за «сессию»
}
```
Опции и типы (data.rs:837-1097), TS: `SchedulerOptions`, `PassingScoreOptions`, `MasteryWindow {percentage, range:[number,number], inWindow(score)}`, `SchedulerPreferences {batchSize?: number}`, `FULL_CANDIDATES_SCORE = 4.0`, `verifySchedulerOptions(o): void` (throws).

## 2. Состояние и коллаборанты

**`DepthFirstScheduler` (:162)** владеет: `data: SchedulerData`, `unit_scorer: UnitScorer`, `reward_propagator`, `review_knocker`, `filter: CandidateFilter`, `relearn_pile`. Конструктор (:190-205): `options = data.options.clone()`; `UnitScorer::new(data.clone(), options.clone())`, `RewardPropagator{data: data.clone()}`, `ReviewKnocker::new(data.clone())`, `CandidateFilter::new(data.clone())`, `RelearnPile::new(options)`. **`SchedulerData` — `#[derive(Clone)]`**: `Arc<RwLock<…>>`-поля (граф, библиотека, stores, blacklist, review list, filter manager, `frequency_map`, `trial_counts`) разделяются между клонами, но **`options: SchedulerOptions` копируется по значению**.

**Проблема пропагации опций в рантайме** (improvement_plan.md:113-117; подтверждено кодом): `set_scheduler_options` (:1190) и `reset_scheduler_options` (:1194) меняют только `self.data.options`. Остаются со СТАРЫМИ копиями: `UnitScorer.options` (num_trials, num_deltas?, num_rewards — читает `self.options.num_trials/num_rewards`, unit_scorer.rs:219,229,241,245), `UnitScorer.data.options` (`superseding_score`, unit_scorer.rs:397), `RelearnPile.options` (batch_size, relearn_fraction, relearn_pile.rs:14,45), а также `data.options` внутри клонов у `CandidateFilter` (filter.rs:262-263: окна, batch_size), `ReviewKnocker`, `RewardPropagator`. Живыми остаются только чтения из `self.data.options` в scheduler.rs: `batch_size` (поиск), `passing_score`, `target_window_opts.range.1`, `max_lessons_in_progress`, и Shuffler (получает `&self.data.options`). Тесты `set_scheduler_options`/`reset_scheduler_options` (basic_tests.rs:1059, 1079) проверяют только геттер. **Решение для порта:** единый `OptionsHolder`/getter `() => SchedulerOptions`, инжектируемый во все компоненты (или компоненты принимают `options` аргументом при каждом вызове); плюс инвалидация кэша скорера при смене `num_trials`/`num_rewards`/`superseding_score`.

Мутабельное состояние и время жизни: `frequency_map` (инкремент в `get_exercise_batch`, не персистится, сбрасывается при пересоздании планировщика), `trial_counts` (инкремент в `score_exercise`), `RelearnPile.pile: UstrSet` (in-memory), кэши `UnitScorer` (см. §3.5). `SchedulerData` также вызывается из `review_knocker/filter` (`get_success_rate`, `all_valid_exercises`…).

### 2.1 `SchedulerData` helpers (scheduler/data.rs)
| функция | поведение (data.rs:строки) |
|---|---|
| `get_lesson_id(ex)`, `get_course_id(lesson)` | `unit_graph.get_exercise_lesson` / `get_lesson_course`; `Err("missing lesson ID for exercise with ID …")` / `"missing course ID for lesson with ID …"` (:66-82) |
| `get_unit_type` / `get_unit_type_strict` | `Option<UnitType>` / `Err("missing unit type …")` (:87-98) |
| `get_{course,lesson,exercise}_manifest` | из библиотеки, `Err("missing manifest for …")` (:102-127) |
| `blacklisted(id)` | `blacklist.blacklisted(id)?` (:131) |
| `inside_blacklisted(ex)` | сам ex, затем его lesson и course; `get_lesson_id/get_course_id(...).unwrap_or_default()` (пустой id при отсутствии) (:137-151) |
| `get_all_dependents(id)` | `graph.get_dependents(id).unwrap_or_default()` → Vec (порядок = порядок итерации HashSet!) (:156) |
| `get_superseding(id)` | `graph.get_superseded_by` (:170) |
| `get_dependencies_at_depth(id, depth)` | DFS-стек `(id,0)`; `candidate_depth == depth` → push; `Some(deps)` пусто → push самого; иначе deps с depth+1; `None` → push; в конце `retain(get_unit_type(..).is_some())` (:176-213). Дубликаты не удаляются |
| `get_lesson_course` | Option (:218) |
| `unit_exists(id)` | тип есть в графе И манифест есть в библиотеке (:225-239) |
| `get_lesson_exercises`, `get_num_lessons_in_course` | `unwrap_or_default` (:244, :257) |
| `unit_passes_filter(id, Option<&KeyValueFilter>)` | `None` → true; Exercise → `Err("cannot apply metadata filter to exercise with ID …")`; Course → `filter.apply_to_course(course_manifest)`; Lesson → `apply_to_lesson(course_manifest(lesson_course.unwrap_or_default()), lesson_manifest)`; манифест отсутствует → Err (:268-305) |
| `increment_exercise_frequency` | `map[id] = (map[id] ?? 0) + 1` (:309) |
| `get_saved_filter(id)` | `Err("no saved filter with ID … exists")` (:317) |
| `get_session_filter(session, time)` | `session.get_part(time)`: `NoFilter`→None; `UnitFilter`→Some; `SavedFilter{filter_id}`→`get_saved_filter(..).filter.clone()` (:325-338). Время — параметр |
| `all_valid_exercises_in_lesson(l)` | blacklisted(l) или blacklisted(course of l) → []; иначе упражнения урока минус blacklisted; ошибки blacklist → `unwrap_or(false)` (:342-361) |
| `all_valid_exercises(unit)` | None→[]; Exercise→[id] если не blacklisted; Lesson→…in_lesson; Course→[] если blacklisted, иначе flat_map по `get_course_lessons` (:365-399) |
| `update_success_rate(score)` | One/Two → `failed += 1`; Three/Four/Five → `success += 1` (:402-408) |
| `get_success_rate()` | `total==0 → 1.0`, иначе `success/total` (f32) (:412-420) |

## 3. Алгоритмы

### 3.1 Константы и опции (точные значения)
- `MAX_CANDIDATE_FACTOR = 10` (scheduler.rs:48): «планировщик возвращается рано при тупике, если кандидатов ≥ batch_size × это значение; чтобы не обходить весь граф».
- `FULL_CANDIDATES_SCORE = 4.0` (data.rs:837): «оценка, при которой дробный отбор достигает 100% кандидатов урока».
- `PassingScoreOptions::default()` (data.rs:857-863): `min_score 3.0`, `min_fraction 0.5`, `min_avg_trials 1.8`.
- `SchedulerOptions::default()` (data.rs:1056-1085): `batch_size 50`, `relearn_fraction 0.1`, окна `new {0.2, (0.0,0.1)}`, `target {0.2, (0.1,2.5)}`, `current {0.3, (2.5,3.75)}`, `easy {0.2, (3.75,4.5)}`, `mastered {0.1, (4.5,5.0)}`, `passing_score` (выше), `superseding_score 4.0`, `num_trials 20`, `num_deltas 10`, `num_rewards 10`, `max_lessons_in_progress 10`. Комментарий: «новое» окно (0.0,0.1) — запас, реально у новых оценка 0.0.
- `MasteryWindow.in_window(s)` (data.rs:~970): `range.1 >= 5.0 && s >= 5.0 → true`; иначе `range.0 <= s && s < range.1`.
- `SchedulerPreferences { batch_size: Option<usize> }` (serde default). `Trane::create_scheduler_options(prefs)` (lib.rs:184): `SchedulerOptions::default()` с подменой batch_size; затем `options.verify()?` (lib.rs:273).
- Shuffler: `MAX_GROUP_SIZE = 3` («макс. число низкооценённых кандидатов одного курса в группе»), `NEW_GROUP_THRESHOLD = 1.0`, `NEW_GROUP_KEY_MIN/MAX = 0.2/1.0`, `OTHER_GROUP_KEY_MIN/MAX = 0.0/0.8` («лёгкий сдвиг новых групп к концу; слабый, чтобы малые батчи давали разный порядок») (shuffler.rs:9-19).

### 3.2 `verify()` (data.rs)
`PassingScoreOptions.verify`: ошибка если `min_score < 0 || min_score >= 4.0` (`"invalid minimum score: {}"`), `min_fraction < 0 || > 1` , `min_avg_trials < 1.0` (:871-885).
`SchedulerOptions.verify` в порядке: `batch_size == 0`; `relearn_fraction ∉ [0,1]`; `passing_score.verify()`; сумма процентов пяти окон ≈ 1.0; `new.range.0 ≈ 0.0`; `mastered.range.1 ≈ 5.0`; стыки без пропусков `new.1==target.0`, `target.1==current.0`, `current.1==easy.0`, `easy.1==mastered.0`; `max_lessons_in_progress == 0`. `float_equals(a,b) = |a−b| < f32::EPSILON` (≈1.19e-7) (data.rs:~1000-1050). **TS-решение:** f64 сумма 0.2+0.2+0.3+0.2+0.1 даёт ≈1.0000000000000002 — заменить на допуск `1e-6` (иначе default не пройдёт `verify`) `[НЕ ПОДТВЕРЖДЕНО прогоном]`. Проверки не покрывают: `superseding_score`, `num_*`, диапазоны `target/current/easy` по отдельности.

### 3.3 `get_exercise_batch(filter)` — пошагово (scheduler.rs:1056-1102)
1. `initial = get_initial_candidates(filter)`; ошибка оборачивается `ExerciseSchedulerError::GetExerciseBatch`.
2. `knocked = review_knocker.knock_out_reviews(initial)`.
3. `filtered = filter.filter_candidates(knocked)` (CandidateFilter: окна мастерства, скорректированные по `get_success_rate()`, `dynamic_batch_size`, взвешенная выборка).
4. `relearn = relearn_pile.select_exercises(&data)` (см. §3.11), затем `.filter(c => !filtered.some(f => f.exercise_id == c.exercise_id))`.
5. `final = filtered ++ relearn` (релёрн-кандидаты ДОБАВЛЯЮТСЯ сверх batch_size).
6. `shuffled = Shuffler.shuffle_candidates(final, &data.options)` (§3.12).
7. `manifests = candidates_to_exercises(shuffled)` (`get_exercise_manifest`, отсутствие → Err → `GetExerciseBatch`).
8. Для каждого manifest — `data.increment_exercise_frequency(id)` (только после успешного шага 7).
9. Вернуть `manifests`. Пустой результат — не ошибка.

### 3.4 `get_initial_candidates(filter)` (:975-1040)
Диспетчер (см. call graph). Детали:
- `None`: `get_initial_stack(None)` + `get_candidates_from_graph(stack, None)` (`visited = ∅`, `allow_course_traversal = true`, `allowed = []`).
- `CourseFilter{course_ids}`: `get_candidates_from_course` — стартовые уроки `graph.get_starting_lessons(course)` БЕЗ проверки зависимостей (depth 0), `visited` изначально содержит сами course_id (чтобы не вставать в курс), `allow_course_traversal=false`, `allowed_courses=course_ids`, metadata_filter=None (:893-909).
- `LessonFilter`: для каждого lesson_id — только `get_candidates_from_lesson_helper` (без DFS, без blacklist-фильтра урока, кроме встроенного в `all_valid_exercises_in_lesson`).
- `MetadataFilter{filter}`: `get_initial_stack(Some(&f))` + граф с `Some(&f)`.
- `ReviewListFilter`: `review_list.get_review_list_entries()?`; по типу: Course→`get_candidates_from_course(&[id])`; Lesson→`get_candidates_from_lesson(id)`; Exercise→прямой Candidate: `lesson_id = get_lesson_id.unwrap_or_default()`, `course_id = get_course_id(lesson).unwrap_or_default()`, `depth 0.0`, `exercise_score/urgency/velocity` из `unit_scorer`, `frequency` из map; **blacklist для одиночных упражнений НЕ проверяется**. Неизвестный тип → `Err` (`get_unit_type_strict`).
- `Dependents{unit_ids}`: стек depth 0 из unit_ids (как есть, без проверки типа/зависимостей).
- `Dependencies{unit_ids, depth}`: `get_dependencies_at_depth` для каждого, flat_map → стек depth 0.
- `StudySession(data)`: `get_session_filter(&data, Utc::now())` → `Option<UnitFilter>` → рекурсивный вызов **и `return`** (дедупликация выполняется во внутреннем вызове). Время сессии = **системные часы `Utc::now()`, НЕ override-таймстамп планировщика**.
- Итог (все ветки кроме StudySession) — `deduplicate_candidates`: `retain(seen.insert(exercise_id))`, первый выигрывает.

### 3.5 Начальный стек
`get_all_starting_units` (:219-252): `starting = graph.get_dependency_sinks()`; цикл до неподвижной точки: каждый `id` — если `unit_exists(id)` остаётся, иначе заменяется на `get_all_dependents(id)`; по окончании оставить только те, у кого **все** зависимости `!unit_exists` (`unwrap()` на unit_exists — паника если тип неизвестен, в TS — false). `get_initial_stack` (:280-310): для каждого стартового юнита (порядок HashSet) `lesson_ids = get_course_valid_starting_lessons(course, filter)` (стартовые уроки курса, у которых `all_satisfied_dependencies`); пусто → `StackItem{course, depth 0}`, иначе уроки depth 0; затем `initial_stack.shuffle(rng)`. Стек — `Vec`, `pop()` берёт с конца.

### 3.6 `get_candidates_from_graph_helper` (:726-880) — DFS
Инициализация: `max_candidates = data.options.batch_size * MAX_CANDIDATE_FACTOR` (usize); `all_candidates = []`; `lessons_in_progress = ∅`; `pending_course_lessons: Map<course, usize> = {}`; `visited` и `stack` — параметры (мутируются).

Цикл `while let Some(curr) = stack.pop()`:
1. `curr ∈ visited` → `continue`.
2. `unit_type = get_unit_type(curr)`; `None` → `continue` (отсутствующий юнит; **не** помечается visited).
3. **Course && allow_course_traversal** (:767-784):
   a. `starting = get_course_valid_starting_lessons(course, metadata_filter)` → `shuffle_to_stack(curr, starting, stack)` (Fisher-Yates + push с `depth = curr.depth + 1`);
   b. `if skip_course(...)`: `visited.insert(course)`; `valid_deps = get_valid_dependents(course, filter)` → `shuffle_to_stack`.
   Иначе курс **не** помечается visited: он будет снова добавлен на стек, когда все его уроки пройдены (см. п.4), и тогда `skip_course` вернёт true (`pending == 0`) → его зависимые уйдут на стек. Уроки в (a) добавляются даже если курс скипается (для заблокированного курса они затем дают пустых кандидатов: `all_valid_exercises_in_lesson` → [] ⇒ avg None ⇒ проходят порог ⇒ идут дальше к зависимым).
   `skip_course` (:623-655) = `blacklisted(course) || !unit_passes_filter(course, f).unwrap_or(true) || pending_course_lessons.entry(course).or_insert(num_lessons_in_course) == 0 || is_superseded(course, get_superseding_recursive(course).unwrap_or_default())`.
4. **Lesson** (:785-876): (в ветке `else if unit_type == Lesson`; Course при `!allow_course_traversal` и Exercise игнорируются без пометки visited)
   a. `visited.insert(lesson)`.
   b. `lesson_course = get_lesson_course(lesson).unwrap_or_default()`; если `!allow_course_traversal && !allowed_courses.contains(lesson_course)` → `continue` (уроки чужих курсов не обрабатываются и их зависимые не добавляются).
   c. если `allow_course_traversal`: `course_id = get_course_id(lesson)?`; `pending = pending_course_lessons.entry(course).or_insert(num_lessons)`; `if *pending > 0 { *pending -= 1 }`; если `== 0` → `stack.push({course, depth: curr.depth + 1})` (без shuffle).
   d. `valid_deps = get_valid_dependents(lesson, filter)`; если `skip_lesson(lesson, filter)` → `shuffle_to_stack(curr, valid_deps)`; `continue`.
      `skip_lesson` (:659-691) = `blacklisted(lesson) || !unit_passes_filter(lesson,f).unwrap_or(true) || is_superseded(lesson, superseding_recursive(lesson)) || is_superseded(course_of_lesson, superseding_recursive(course))`.
   e. `(candidates, avg_score) = get_candidates_from_lesson_helper(curr)?` (§3.8); `num = candidates.len()`; `avg_trials = unit_scorer.get_avg_trials(lesson)`; `avg = num > 0 ? Some(avg_score) : None`.
   f. **Тупик** — `!passes_threshold(&passing_score, avg, avg_trials)`: у всех кандидатов `dead_end = true`; `extend_candidates(all, candidates, lesson, avg, &mut in_progress, &options)`; **если `all_candidates.len() >= max_candidates` → `break` (единственное раннее завершение)**; иначе `stack.shuffle(rng)` (перемешивается ВЕСЬ стек) и `continue` — зависимые урока НЕ добавляются.
   g. **Проход**: `extend_candidates(...)`; `shuffle_to_stack(curr, valid_deps)`. Проверки размера пула нет — поиск продолжается, пока стек не пуст или не наступит тупик с пулом ≥ max.
5. Результат `all_candidates`.

`passes_threshold(opts, avg_score?, avg_trials?)` (:523-535): если оба `Some` → `avg_score >= opts.min_score && avg_trials >= opts.min_avg_trials`; если любой `None` → **true** («не блокировать поиск на blacklisted/отсутствующих юнитах»). Значение `avg_trials` для урока — из `unit_scorer.get_avg_trials` (unit_scorer.rs:684).

`extend_candidates` (:695-720): `candidates.is_empty()` → return (в `lessons_in_progress` не пишется). `in_progress = lesson_score.map_or(true, s => s <= options.target_window_opts.range.1)` (по умолчанию ≤ 2.5). Если `in_progress && !lessons_in_progress.contains(lesson)`: при `lessons_in_progress.len() >= options.max_lessons_in_progress` → return (кандидаты урока отбрасываются, но решение о проходе/тупике уже принято выше); иначе `insert(lesson)`. Затем `all.extend(candidates)`. Уроки с оценкой > порога не считаются «в процессе» и обходят лимит.

Влияние фильтров/сессий на поиск:
- **Metadata filter**: (1) `get_initial_stack` строит старт из стартовых уроков, проверяя зависимости с мостом; (2) `skip_course/skip_lesson` пропускают не подходящие юниты, но пробрасывают на их зависимых; (3) при проверке зависимостей отфильтрованные юниты «прозрачны» (`resolve_effective_dependencies`, §3.9). `unit_passes_filter(...).unwrap_or(true)` в skip_* (ошибка манифеста → считать проходящим), но `.unwrap_or(false)` в `resolve_effective_dependencies` и `last_matching_lessons_in_course`.
- **Course filter**: `allow_course_traversal=false`, только уроки разрешённых курсов, стартовые уроки без проверки зависимостей, курсы не обходятся (pending-счётчик не ведётся).
- **Lesson filter**: DFS отсутствует, ничего не проверяется кроме blacklist.
- **Dependents/Dependencies**: обычный DFS (allow=true, filter=None) со стартом из указанных юнитов; стартовые зависимости не проверяются.
- **Review list**: DFS не используется вообще (см. §3.4); одиночные упражнения минуют blacklist; `deduplicate` применяется.
- **Study session**: только выбор `UnitFilter` по `Utc::now()` и рекурсия.

### 3.7 `select_candidates(candidates, score, opts)` (:315-345)
```ts
if (candidates.length === 0) return [];
if (score >= FULL_CANDIDATES_SCORE /*4.0*/ || score < opts.minScore) return candidates;   // порядок не меняется
const minFraction = clamp(opts.minFraction, 0, 1);
const fraction = minFraction + ((score - opts.minScore) / (FULL_CANDIDATES_SCORE - opts.minScore)) * (1 - minFraction);
const clamped = clamp(fraction, 0, 1);
let n = Math.floor(clamped * candidates.length);          // f32→usize `as`, floor
if (clamped > 0 && n === 0) n = 1;                         // всегда хотя бы один
shuffle(candidates, rng); return candidates.slice(0, n);
```
Пример по умолчанию: score 3.5 → fraction 0.75. `n` на f32; при порте на f64 возможны отличия на границах floor (напр. 0.7*10) — тесты, зависящие от таких границ, проверять на f32-семантику (`Math.fround`) `[НЕ ПОДТВЕРЖДЕНО]`.

### 3.8 `get_candidates_from_lesson_helper` (:349-389)
`exercises = all_valid_exercises_in_lesson(lesson)`; пусто → `([], 0.0)`. `course_id = get_course_id(lesson).unwrap_or_default()`. Для каждого упражнения Candidate `{depth: (item.depth+1) as f32, exercise_score: unit_scorer.get_unit_score(ex)?.unwrap_or_default() (None→0.0), urgency: get_exercise_urgency(ex)?, velocity: get_exercise_velocity(ex)?, frequency: frequency_map[ex] ?? 0, dead_end:false, encompasses/encompassed_weight: 0}`. Ошибка скорера пробрасывается (→ `GetExerciseBatch`). `avg_score = sum(exercise_score)/len` (по ВСЕМ упражнениям до отбора); `selected = select_candidates(cands, avg_score, &passing_score)`; возврат `(selected, avg_score)`. Отсюда `dead_end`/проход решается по среднему до отбора.

### 3.9 Зависимости, blacklist и superseded (мост)
- `all_satisfied_dependencies(unit, f)` (:592): все `graph.get_dependencies(unit)` удовлетворены (`satisfied_dependency`). Пустой набор → true.
- `satisfied_dependency(dep, f)` (:575): `targets = resolve_effective_dependencies(dep, f, visited=∅)`; `targets.is_empty()` → true; иначе все `satisfied_effective_dependency`.
- `resolve_effective_dependencies` (:429-520): `if !visited.insert(dep) return ∅` (защита от циклов); если `unit_passes_filter(dep,f).unwrap_or(false)` → `{dep}`; иначе по типу:
  - **Lesson**: `next = graph.dependencies(dep)`; если `dep ∈ graph.get_starting_lessons(course_of(dep))` — добавить `graph.dependencies(course)`; результат — объединение `resolve(next_i)`;
  - **Course**: `last = last_matching_lessons_in_course(dep, f)` (уроки курса, проходящие фильтр и не имеющие зависимых среди проходящих уроков; :394); непусто → вернуть его; иначе объединение `resolve` по `graph.dependencies(course)`;
  - иное/неизвестный тип → ∅.
- `satisfied_effective_dependency(dep)` (:538-571), по порядку: (1) `blacklisted(dep).unwrap_or(false)` → true; (2) `blacklisted(get_lesson_course(dep).unwrap_or_default())` → true (курс blacklisted для урока); (3) `superseding = get_superseding_recursive(dep)`; если `Some` и `is_superseded(dep, &superseding)` → true; (4) `score = get_unit_score(dep).unwrap_or_default()` (Option), `avg_trials = get_avg_trials(dep)`, → `passes_threshold(...)` (любое `None` → true).
- `get_valid_dependents(unit, f)` = `get_all_dependents(unit)` отфильтрованные `all_satisfied_dependencies`.
- Порядок в `get_all_dependents` — порядок итерации HashSet; после `shuffle_to_stack` не значим.

### 3.10 `score_exercise(exercise_id, score, timestamp)` — путь записи (:1104-1166)
Чтение/запись строго по порядку:
1. **Чтение**: `existing_score = unit_scorer.get_unit_score(ex).unwrap_or_default().unwrap_or_default()` (ошибки и None → 0.0); `num_trials = unit_scorer.get_exercise_num_trials(ex)` (ошибки/None → 0). *Зависит от часов планировщика* (`UnitScorer.now()`, кэш `is_fresh` и аргумент `now` в `exercise_scorer.score`).
2. Если `num_trials > 0`: **запись** `practice_deltas.record_exercise_deltas([{exercise_id, delta: score.float_score() - existing_score, timestamp}])` (timestamp — параметр вызова; ошибка → `ScoreExercise`).
3. **Запись** `practice_stats.record_exercise_scores([{exercise_id, score: float_score, timestamp}])` (timestamp — параметр; ошибка → `ScoreExercise`).
4. **Инвалидация** `unit_scorer.invalidate_cached_score(ex)` (сам ex, его урок и курс; кэши trials урока/курса).
5. **In-memory**: `relearn_pile.update(ex, &score)` — One/Two → insert, Three/Four/Five → remove; `data.update_success_rate(&score)` (счётчики `trial_counts`).
6. `rewards = reward_propagator.propagate_rewards(ex, &score, timestamp)` — чистое вычисление по графу, timestamp — параметр.
7. **Запись** `updated_ids = practice_rewards.record_unit_rewards(&rewards)` (сохраняются только награды юнитов, у которых уже есть оценки; возвращает id обновлённых; ошибка → `ScoreExercise`).
8. **Инвалидация** `unit_scorer.invalidate_cached_score(id)` для каждого `updated_ids`.
Нет транзакции: сбой на шаге 7 оставляет записанными п.2-3 и уже обновлённые relearn/success_rate. Только в памяти: relearn pile, `trial_counts`, кэши скорера, `frequency_map`. От часов планировщика (`override_timestamp` → в порте `Clock`) зависят: п.1 (delta считается относительно оценки на момент `now()`), актуальность кэша (`MAX_CACHE_AGE = 2 * 60 * 60` с, `is_fresh(cached_at, now) = now >= cached_at && now - cached_at <= MAX_CACHE_AGE`, unit_scorer.rs:21-28), и значение оценки, кэшируемой при последующих чтениях. Записи в stores используют **только переданный `timestamp`** (конверсия с→мс в порте). Аргумент `timestamp` не сверяется с часами (можно писать в прошлое/будущее).
Не-`score_exercise` часы: `get_session_filter(.., Utc::now())` (scheduler.rs:1032); `scheduler/data.rs:599` — только тест.

### 3.11 `RelearnPile` (relearn_pile.rs)
Состояние: `options` (копия, стухает — §2), `pile: Set<UnitId>`. `update`: One/Two → add; Three..Five → delete. `select_exercises(data)`: `pile.retain(id => !data.inside_blacklisted(id).unwrap_or(false))` (мутирует пул) затем `select_exercises_helper`: `num_to_add = (batch_size as f32 * relearn_fraction) as usize` (усечение к нулю; по умолчанию 50*0.1 = 5); `pile.iter().sample(rng, num_to_add)` (IteratorRandom::sample — резервуарная выборка; если пул меньше — возвращаются все); каждый → `Candidate{exercise_id, ..Default}` (score 0.0, course_id ""). Исключение из пула — только при оценке ≥3 или blacklist; выбор не удаляет из пула.

### 3.12 `Shuffler::shuffle_candidates(candidates, options)` (shuffler.rs:44-88)
1. `threshold = options.target_window_opts.range.1` (по умолчанию 2.5); `partition`: `low = exercise_score <= threshold`, `high` — остальные.
2. `low.sort_by_key(course_id)` (порядок Ustr `Ord` `[НЕ ПОДТВЕРЖДЕНО]` — лексикографический; для порта — строковое сравнение, только для группировки); `chunk_by(course_id равны)`; внутри чанка `shuffle(rng)` и `chunks(MAX_GROUP_SIZE=3)` → группы.
3. Каждый high — своя группа.
4. Ключ группы `group_sort_key`: пустая → 0.0; `avg = mean(exercise_score)`; `avg <= 1.0` → `rng.random_range(0.2..1.0)` иначе `rng.random_range(0.0..0.8)`.
5. `sort_by(partial_cmp, NaN→Equal)` (стабильная сортировка), flatten. Релёрн-кандидаты (score 0.0, course "") попадают в low-группу курса "".

## 4. Граничные случаи и инварианты
- Пустой граф/фильтр → пустой батч, без ошибки. Отсутствующий юнит в стеке → пропуск. Курс без уроков → `pending==0` → скипается сразу, его зависимые добавляются.
- Урок без валидных упражнений → `([],0.0)`, `avg=None`, проходит порог (не блокирует зависимые).
- `batch_size == 0` (без verify) → `max_candidates = 0` → на первом же тупике `break`.
- Лимит `max_lessons_in_progress` отбрасывает кандидатов, но не влияет на обход.
- Итоговый батч может быть `batch_size + num_to_add` (релёрн добавляется после фильтра) `[НЕ ПОДТВЕРЖДЕНО тестом; следует из кода :1086-1089]`.
- Ошибки: `ExerciseSchedulerError::{GetExerciseBatch, ScoreExercise, GetUnitScore(id, e)}`; подтипы ошибок хранилищ теряются в `anyhow`. Ошибки blacklist в `blacklisted/all_valid_*` глотаются как `false`.
- Одиночные упражнения review list не проходят blacklist-проверку (см. §3.4); `LessonFilter` не проверяет фильтр урока.
- Детерминизм: НЕ гарантирован; (см. §5).

## 5. Случайность, время, I/O; швы для порта
**Стохастические места** (все используют `rand::rng()` — thread-local, несидируемый):
| где | API | эффект |
|---|---|---|
| `shuffle_to_stack` (scheduler.rs:210) | `Vec::shuffle(&mut rng())` (SliceRandom) | порядок обхода зависимых/стартовых уроков |
| `get_initial_stack` (:308) | `initial_stack.shuffle(&mut rng())` | порядок стартовых юнитов |
| DFS-тупик (:861) | `stack.shuffle(&mut rng())` | перемешивание всего стека |
| `select_candidates` (:343) | `candidates.shuffle(&mut rng())` + `take(n)` | какие упражнения урока попадут в выборку |
| `RelearnPile.select_exercises_helper` (relearn_pile.rs:46) | `IteratorRandom::sample(&mut rand::rng(), n)` | подмножество пула |
| `Shuffler` (shuffler.rs:60,66) | `chunk.shuffle(rng)`; `rand::rng().random_range(a..b)` (`RngExt`) | порядок внутри курса и порядок групп |
| `CandidateFilter` (filter.rs:156-158, вне документа) | `IndexedRandom::sample_weighted` | взвешенный выбор из окна |
Кроме того — неявная недетерминированность порядка итерации `UstrSet` (`get_all_dependents`, `get_all_starting_units`, `frequency`-независимо) — в TS `Set` детерминирован по порядку вставки, но зависит от загрузчика.
**Порт:** `Rng { next(): number /*[0,1)*/; shuffle<T>(a: T[]): void; sample<T>(it: Iterable<T>, n: number): T[]; range(lo, hi): number }` конструктор-инжектируемый; планировщик обязан делать ровно одно обращение к `rng` в тех же местах; seed-тесты фиксируют порядок вызовов, а не точные значения.
**Время:** `Clock.now(): number` (мс) заменяет `override_current_timestamp` и `Utc::now()` в `UnitScorer.now()` и в `get_session_filter` (в Rust они разные источники — при порте использовать один Clock, что меняет поведение только в тестах с override). `score_exercise` принимает `timestampMs` параметром.
**I/O:** синхронно в памяти; хранилища stats/deltas/rewards/blacklist/review-list — sync SQLite; `filter_manager`, `course_library` — данные в памяти.

## 6. Rust-идиомы, требующие решения
- `Arc<RwLock<dyn Trait>>` → конструкторные интерфейсы; RwLock не нужен (однопоточный sync-домен). `SchedulerData` `Clone` с общими Arc → в TS разделяемые ссылки, но `options` **не копировать**, а держать в общем holder (§2).
- `UnitScorer` кэши в `RefCell` (unit_scorer.rs:114) — обычные `Map`.
- `Ustr`/`UstrSet`/`UstrMap` → `string`/`Set`/`Map`; `Default` для `Ustr` = `""` (используется как «отсутствующий id» в `unwrap_or_default()`; в TS явно `?? ""`).
- f32: `avg_score`, `select_candidates`, `float_equals(EPSILON)`, `success_rate` — f64 даёт микроразличия; `num_to_add`/`n` — усечение `as usize`.
- `usize` вычитание: `pending -= 1` защищено `> 0`; остальные — сложение.
- `Result<T, anyhow>` → исключения / `ExerciseSchedulerError` с `kind` и `cause`; `unwrap()` в `get_all_starting_units` (:249) и `unwrap_or_default()` на ошибках графа — паника/тихий дефолт, в TS — явный false.
- `ExerciseFilter`/`UnitFilter`/`StudySessionData` serde enum-теги — в модуле фильтров (другая спека).
- `UnitType` match ограничен Course/Lesson/Exercise; `MasteryScore` enum One..Five → литеральный union + `floatScore`.
- `sort_by_key(course_id)` по `Ustr` и `chunk_by` — в TS `sort` по строке + группировка соседних.
- Возвращаемый порядок кандидатов не является контрактом (перемешивается).

## 7. TEST INVENTORY

Классы: **direct** — без изменений; **rng** — нужен Rng-шов (проверять инварианты/количество, не порядок); **fixtures** — нужны course-библиотеки/фикстуры (`tests/*_library`, `test_utils`, `TempDir`, `init_test_simulation`); **skip** — с причиной.

### 7.1 scheduler.rs (mod test, :1205; `#[test]`)
| test | что проверяет | класс | vitest |
|---|---|---|---|
| `deduplicate_candidates` | дедуп по exercise_id, первый выигрывает, порядок остальных | direct | `it()` на чистой функции |
| `select_candidates_empty` | пусто → пусто | direct | `it()` |
| `select_candidates_below_minimum_score` | score < min_score → все кандидаты | direct | `it()` |
| `select_candidates_below_minimum_score_with_zero_fraction` | тот же случай при min_fraction=0 | direct | `it()` |
| `select_candidates_minimum_score_guarantees_one` | ≥1 кандидат при малой доле | rng | seeded Rng, проверка `length` |
| `select_candidates_partial_selection` | доля по формуле → `floor` | rng | проверка длины, `it.each` по score |
| `select_candidates_always_keep_one_when_fraction_positive` | `n=1` при `clamped>0 && floor==0` | rng | проверка длины |
| `select_candidates_full_selection` | score ≥ 4.0 → все | direct | `it()` |
| `extend_candidates_within_limit` | добавление в пределах лимита in-progress | direct | `it()` |
| `extend_candidates_exceeds_limit` | сверх `max_lessons_in_progress` кандидаты отбрасываются | direct | `it()` |
| `extend_candidates_already_tracked_lesson` | урок уже в set проходит | direct | `it()` |
| `extend_candidates_passed_lessons_bypass_limit` | score > target.range.1 обходит лимит | direct | `it()` |
| `extend_candidates_no_score_counts_as_in_progress` | `None` = in progress | direct | `it()` |
Вспомогательные (не тесты): `candidate`, `select`, `candidate_with_lesson`, `default_options_with_max_lessons`.

### 7.2 scheduler/data.rs (mod test, :425)
| test | что проверяет | класс | vitest |
|---|---|---|---|
| `unit_exists` | существование юнита (граф + манифест) | fixtures | in-memory библиотека |
| `exercise_metadata_filter` | `unit_passes_filter` для упражнения → Err | fixtures | `expect(() => …).toThrow` |
| `exercise_frequency` | `increment_exercise_frequency` | fixtures/direct | `it()` |
| `get_session_filter` | выбор части сессии по времени, SavedFilter | fixtures (Clock-параметр) | `it()` с фиксированным временем |
| `all_valid_exercises` | учёт blacklist для упражнения/урока/курса | fixtures | `it()` |
| `success_rate` | `get_success_rate` (1.0 при 0; доли) | direct | `it()` |

### 7.3 scheduler/relearn_pile.rs (mod tests, :71)
| test | что проверяет | класс | vitest |
|---|---|---|---|
| `test_update` | One/Two добавляют, Four/Five удаляют | direct | `it()` |
| `test_add_to_batch` | batch 10, fraction 0.5, пул 20 → ровно 5 | rng | `expect(len).toBe(5)` |

### 7.4 scheduler/shuffler.rs (mod tests, :88)
| test | что проверяет | класс | vitest |
|---|---|---|---|
| `empty_candidates` | пусто → пусто | direct | `it()` |
| `preserves_all_candidates` | мультимножество сохраняется | rng | сравнение отсортированных id |
| `low_candidates_grouped_by_course` | low одного курса смежны | rng | циклы по seed'ам |
| `mixed_low_and_high_candidates` | low сгруппированы, размер сохранён | rng | циклы по seed'ам |
| `threshold_boundary` | `score == threshold` относится к low | rng | как выше |
| `large_course_split_into_chunks` | 13 low одного курса разбиваются на группы ≤3 (флаг `saw_split`) | rng | итерации по seed'ам |
| `group_sort_key` | пустая → 0.0; диапазоны [0.2,1.0) / [0.0,0.8) | rng | много выборок, проверка границ |

### 7.5 Интеграционные тесты, задействующие планировщик (tests/*.rs)
Все — **fixtures** (используют `TempDir`, `init_test_simulation`, `test_utils::*`, библиотеки `tests/small_test_library`, `large_test_library`, `embedded_test_library`; большинство также **rng**-зависимы: проверяются множества/инварианты, не порядок). Порт: собирать те же библиотеки в памяти либо через загрузчик; вместо `TempDir` — in-memory stores.

| файл | tests |
|---|---|
| basic_tests.rs | `all_exercises_scheduled`, `bad_score_prevents_advancing`, `scheduler_respects_course_filter`, `scheduler_respects_lesson_filter`, `schedule_exercises_in_review_list`, `schedule_lessons_in_review_list`, `schedule_courses_in_review_list`, `schedule_units_and_dependents`, `schedule_dependencies`, `schedule_dependencies_large_depth`, `schedule_dependencies_unknown_unit`, `schedule_study_session` (rng+Clock; в Rust использует `Utc::now`), `set_scheduler_options` (direct-ish), `reset_scheduler_options` (direct-ish). Не про планировщик: `get_unit_ids`, `get_all_exercise_ids`, `get_matching_*` (4), `ignored_paths`, `serialized_course_library` |
| blacklist_tests.rs | `avoid_scheduling_courses_in_blacklist`, `avoid_scheduling_lessons_in_blacklist`, `avoid_scheduling_lessons_in_blacklist_with_course_filter`, `avoid_scheduling_exercises_in_blacklist`, `schedule_courses_with_many_blacklisted_units` (использует `set_scheduler_options{max_lessons_in_progress:5}` — работает, т.к. читается из `self.data.options`), `invalidate_cache_on_blacklist_update` |
| metadata_tests.rs | `scheduler_respects_metadata_filter_op_all`, `…_op_any`, `scheduler_respects_lesson_metadata_filter`, `scheduler_respects_course_metadata_filter`, `scheduler_respects_metadata_filter_and_blacklist`, `scheduler_bridges_filtered_dependency_chain`, `scheduler_bridges_filtered_course_dependencies` |
| superseded_tests.rs | `scheduler_respects_superseded_courses`, `…_superseded_lessons`, `…_superseded_course_chain`, `…_superseded_lesson_chain`, `scheduler_ignores_superseded_exercises` |
| large_tests.rs | `all_exercises_scheduled_random` (случайная библиотека, `set_scheduler_options`; long-running), `generate_and_read_large_library` (не планировщик; skip — бенч загрузчика) |
| generated_courses.rs | `knowledge_base_course_generator_assets`, `literacy_course_generator`, `transcription_course_generator` (используют планировщик через `assert_all_generated_exercises_visited`; зависят от генераторов курсов — skip до порта генераторов) |
| embedded_fs.rs | `loads_embedded_course_library`, `opens_trane_with_embedded_course_library` — не про планировщик; skip |

## 8. LOC (non-test / test)
- scheduler.rs: 1204 / 320 (тесты с :1203 до :1524; всего 1524).
- scheduler/data.rs: 424 / 323 (всего 747).
- scheduler/relearn_pile.rs: 69 / 41 (всего 110).
- scheduler/shuffler.rs: 86 / 182 (всего 268).
- Опции в data.rs (:837-1097 ≈ 260 строк) — non-test; тесты data.rs общие.
- tests/*.rs, всего 3807 строк в 7 файлах (basic 1171, blacklist 521, embedded_fs 123, generated 300, large 76, metadata 942, superseded 674). Числа из `wc -l`; границы test/non-test — по позиции `mod test`.

## Неразрешённое / [НЕ ПОДТВЕРЖДЕНО]
- Порядок `Ord` для `Ustr` (используется в `sort_by_key(course_id)`).
- `UnitScorer.get_exercise_num_trials/get_avg_trials/is_superseded/get_superseding_recursive` — только по вызовам; детали в спеке скорера.
- Не запускался ни один Rust-тест; утверждения о тестах — по коду/именам.
- Точная семантика f32-границ `floor` и допуска `float_equals` при f64 — не измерялась.
