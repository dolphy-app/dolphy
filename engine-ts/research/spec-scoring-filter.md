# Spec: скоринг и фильтрация (unit_scorer, reward_scorer, reward_propagator, review_knocker, filter) — Trane v0.34.1

Ссылки `file:line` — относительно `trane-pristine/src/`. Время в Rust — секунды (i64), в порте — **мс**. Числа в Rust f32, в TS f64 (см. §6 каждого модуля; для квот батча f32 важен — §5.5). `rand` = 0.10.3 (`Cargo.toml:21` требует `0.10.2`; исходник читался в `~/.local/share/cargo/registry/src/*/rand-0.10.3`).
`exercise_scorer.rs` здесь НЕ описан; фиксируется только контракт вызова (§1.3).
Всё, помеченное «(запущено)», проверено запуском скриптов из `specs/_verify_scoring_filter/` (см. Приложение). Rust-тесты крейта мной **не запускались** — числа из ассертов тестов цитируются как есть.

## 0. Поток данных (кто кого зовёт)

```
DepthFirstScheduler.get_exercise_batch (scheduler.rs:1056)
  фаза 1 (поиск)     get_candidates_from_lesson_helper (scheduler.rs:349-386):
                       Candidate{ exercise_score = UnitScorer.get_unit_score(ex).unwrap_or(0),
                                  urgency  = UnitScorer.get_exercise_urgency(ex),
                                  velocity = UnitScorer.get_exercise_velocity(ex),
                                  frequency = data.frequency_map[ex] ?? 0, depth = item.depth+1 (f32),
                                  dead_end=false, encompasses_weight=0, encompassed_weight=0 }
                     dead_end ← true, если !passes_threshold(avg_score, UnitScorer.get_avg_trials(lesson)) (scheduler.rs:835-844)
                     dependency satisfied ← UnitScorer.get_unit_score + get_avg_trials + is_superseded (scheduler.rs:538-570)
  фаза 2 (knocker)   ReviewKnocker.knock_out_reviews(initial) -> KnockoutResult{candidates, highly_encompassed}   (scheduler.rs:1067)
  фаза 3 (filter)    CandidateFilter.filter_candidates(KnockoutResult) -> Vec<Candidate>                        (scheduler.rs:1071)
  фазы 4-5           relearn_pile + Shuffler (вне документа)
score_exercise (scheduler.rs:1104-1166):
  deltas.record (если num_trials>0) → stats.record → unit_scorer.invalidate_cached_score(exercise)
  → relearn_pile.update → data.update_success_rate(score)
  → RewardPropagator.propagate_rewards → practice_rewards.record_unit_rewards(rewards) -> updated_ids
  → для каждого updated_id: unit_scorer.invalidate_cached_score(id)
Trane (lib.rs:399,405,411): blacklist add/remove(unit) → scheduler.invalidate_cached_score(unit) ПЕРЕД записью в blacklist;
                            remove_prefix_from_blacklist(prefix) → invalidate_cached_scores_with_prefix(prefix)
```

---

# 1. `scheduler/unit_scorer.rs` — UnitScorer

## 1.1 Назначение и публичная поверхность
Кэширующий агрегатор: оценка упражнения (exercise_scorer + reward_scorer) → оценка урока (среднее) → оценка курса (среднее по урокам); плюс средние `num_trials`, urgency/velocity упражнения, `is_superseded`. Всё `pub(super)` (виден только `scheduler.rs`), потому в TS — внутренний класс движка, не публичное API.

```ts
export class UnitScorer {
  constructor(deps: UnitScorerDeps, options: SchedulerOptions, clock: Clock,
              exerciseScorer: ExerciseScorer, rewardScorer: RewardScorer = new WeightedRewardScorer());
  setOverrideTimestamp(ts: number | null): void;                       // :102
  invalidateCachedScore(unitId: UnitId): void;                         // :114
  invalidateCachedScoresWithPrefix(prefix: string): void;              // :171
  getUnitScore(unitId: UnitId): number | null;                         // :580  (throw если тип юнита неизвестен)
  getExerciseUrgency(id: UnitId): number;                              // :282
  getExerciseVelocity(id: UnitId): number | null;                      // :308
  getExerciseNumTrials(id: UnitId): number;                            // :334 (Rust: Result<Option<usize>>, всегда Some при Ok)
  getAvgTrials(unitId: UnitId): number | null;                         // :684 (exercise → null)
  allValidExercisesHaveScores(unitId: UnitId): boolean;                // :359
  isSuperseded(supersededId: UnitId, superseding: ReadonlySet<UnitId>): boolean; // :378
  getSupersedingRecursive(unitId: UnitId): Set<UnitId> | null;         // :424
}
interface UnitScorerDeps {   // Arc<RwLock<dyn …>> → интерфейсы
  graph: UnitGraph; library: Pick<CourseLibrary,'getExerciseManifest'>; stats: PracticeStats;
  deltas: PracticeDeltas; rewards: PracticeRewards; blacklist: Blacklist;
  allValidExercises(unitId: UnitId): UnitId[];       // SchedulerData.all_valid_exercises (data.rs:365)
  getSuperseding(unitId: UnitId): ReadonlySet<UnitId> | undefined; // graph.get_superseded_by (data.rs:170)
  supersedingScore(): number;                        // data.options.superseding_score, см. 1.6
}
```

## 1.2 Состояние (все кэши — `RefCell<UstrMap>`, живут всё время жизни планировщика; сброса «целиком» нет)
| Кэш | Ключ → значение | Фреш-проверка |
|---|---|---|
| `exercise_cache` (:54) | exerciseId → `CachedScore{score, urgency, velocity: number\|null, numTrials, timestamp}` (:32-48) | да, по `timestamp` |
| `lesson_cache` (:57) | lessonId → `(number\|null, timestamp)` | да |
| `course_cache` (:60) | courseId → `(number\|null, timestamp)` | да |
| `lesson_trials_cache` (:63) | lessonId → `number\|null` | **нет** (только явная инвалидация) |
| `course_trials_cache` (:66) | courseId → `number\|null` | **нет** |
Ещё: `override_timestamp: Option<i64>` (:81), клон `options` (:72) и `data: SchedulerData` с Arc-общими графом/стораджами.

**Ключ кэша = голый id юнита** (без версии/опций). Смена `options.num_trials/num_rewards/superseding_score` кэши НЕ инвалидирует.

## 1.3 Алгоритмы

### Свежесть (:21-28)
```ts
const MAX_CACHE_AGE_MS = 2 * 60 * 60 * 1000; // Rust: MAX_CACHE_AGE = 2*60*60 c = 7200 c
const isFresh = (cachedAt, now) => now >= cachedAt && now - cachedAt <= MAX_CACHE_AGE_MS;
```
`now` = `override_timestamp ?? Utc::now()` (:107-110). Запись из «будущего» (`cachedAt > now`, часы отмотали назад) не свежа. Граница `<=` включительна. Значение кэшируется с `timestamp = now` в момент вычисления (не по времени последнего trial).

### get_exercise_score (:192-279) — единственная точка вызова exercise_scorer и reward_scorer
1. `now = self.now()`. Если `exercise_cache[id]` свеж → вернуть `.score`.
2. `exercise_type = library.get_exercise_manifest(id)?.exercise_type ?? Procedural` (манифеста нет → Procedural).
3. `scores = stats.get_scores(id, options.num_trials)` (по умолч. **20**; порядок ORDER BY timestamp **DESC**, practice_stats.rs:112-115), ошибка → `[]` (`unwrap_or_default`, ошибка глотается).
4. `retrieveDeltas = scores.length > 0`; `retrieveRewards = scores.length >= MIN_TRIALS_FOR_REWARD (3)`.
5. `deltas = retrieveDeltas ? deltas.get_deltas(id, options.num_trials) : []` — **используется `num_trials`, а не `num_deltas`**; поле `SchedulerOptions.num_deltas` в `src/` нигде не читается (grep: только проброс в lib.rs). Ошибка → `[]`.
6. Если `retrieveRewards`: `lessonId = graph.get_exercise_lesson(id) ?? ""`; `lessonRewards = rewards.get_rewards(lessonId, options.num_rewards)` (по умолч. **10**, DESC по timestamp); `courseId = graph.get_lesson_course(lessonId) ?? ""`; `courseRewards = rewards.get_rewards(courseId, options.num_rewards)`. Пустой id → пустой список (в БД нет такого uid). Ошибки → `[]`.
7. `score = exerciseScorer.score(exerciseType, scores, deltas, now)` — контракт (exercise_scorer.rs:14-26): `ExerciseScore{value ∈[0,5], urgency ∈[0,1], velocity: number|null}`; trials/deltas отсортированы DESC. **Ошибка скорера пробрасывается (`?`), в кэш ничего не пишется.**
8. `reward = retrieveRewards ? rewardScorer.score_rewards(courseRewards, lessonRewards, now) ?? 0 : 0` (ошибка → 0).
9. `final = (retrieveRewards && rewardScorer.apply_reward(reward, scores, now)) ? clamp(score.value + reward, 0.0, 5.0) : score.value`. (`urgency`, `velocity` НЕ модифицируются наградой.)
10. `exercise_cache[id] = {score: final, urgency: score.urgency, velocity: score.velocity, numTrials: scores.length, timestamp: now}`; вернуть `final`.
`numTrials` = число **полученных** trials (≤ `num_trials`=20), не общее число в БД.

### urgency / velocity / num_trials (:282-356)
Каждый геттер: свежая запись → вернуть поле; иначе вызвать `get_exercise_score` (заполняет кэш; ошибка пробрасывается) и прочитать поле из кэша (`unwrap_or_default` → 0.0 / None / None при отсутствии записи — на практике запись всегда есть). Свежесть проверяется отдельно в каждом геттере (тот же `is_fresh`).
Замечание: `get_exercise_velocity` — `cached.velocity` через `and_then`: свежая запись с `velocity=None` не «попадание», а идёт на повторное вычисление `get_exercise_score` (которое само вернёт кэш из-за свежести — итог тот же, лишняя работа только по пути).

### all_valid_exercises_have_scores (:359-374)
`valid = data.all_valid_exercises(unit)` (учитывает blacklist юнита, его урока/курса — data.rs:342-361,365-400). Пусто → **true**. Иначе для каждого `get_exercise_score(id)`; результат true ⇔ ВСЕ `Ok` и `> 0.0`. (Считает «оценка > 0», а не «есть trials»: упражнение без trials даёт score 0.0.) Побочный эффект: вычисляет и кэширует оценки всех упражнений юнита (без short-circuit — сначала `collect`).

### is_superseded / replace_superseding / get_superseding_recursive (:378-427)
```ts
isSuperseded(supersededId, supersedingIds) {
  if (supersedingIds.size === 0) return false;
  if (!this.allValidExercisesHaveScores(supersededId)) return false;
  const scores = [...supersedingIds].map(id => tryGetUnitScore(id) /* Err|None → отбрасывается */).filter(nonNull);
  return scores.length > 0 && scores.every(s => s >= this.deps.supersedingScore()); // data.options.superseding_score, default 4.0
}
replaceSuperseding(ids) {            // :402
  const out = new Set();
  for (const id of ids) {
    const sup = deps.getSuperseding(id);
    if (sup && this.isSuperseded(id, sup)) for (const x of this.replaceSuperseding(sup)) out.add(x);
    else out.add(id);
  }
  return out;
}
getSupersedingRecursive(unit) { const s = deps.getSuperseding(unit); return s ? this.replaceSuperseding(s) : null; }
```
Юниты superseding с оценкой `None` (blacklist/пустые) в проверку **не входят** (игнорируются); если ни у одного нет оценки → false. Рекурсия без кэша и без защиты от циклов (полагается на ацикличность графа). Результат НИГДЕ не кэшируется (см. ниже комментарии в :453-455, :531-533).

### get_lesson_score (:430-506)
1. Свежая запись `lesson_cache[id]` → вернуть (в т.ч. `null`).
2. `blacklist.blacklisted(lesson)` (точное совпадение id) → **кэшировать `(null, now)`**, вернуть `null`.
3. `sup = get_superseding_recursive(lesson)`; если `sup && is_superseded(lesson, sup)` → вернуть `null` **без записи в кэш** (комментарий :453-455: superseding-юнит может потерять «мастерство» без инвалидации кэша этого урока).
4. `exercises = graph.get_lesson_exercises(lesson)`: `None` → `null`; иначе отфильтровать blacklisted упражнения (`blacklist.blacklisted(ex)`); пусто → `null`.
5. Иначе `scores = valid.filter_map(get_exercise_score(..).ok())` (упражнения с ошибкой скорера молча выпадают); пусто → `null`; иначе **среднее арифметическое** `sum/len`.
6. `Ok(score)` (включая `None` из шагов 4-5) → `lesson_cache[id] = (score, now)`.
**Не проверяется blacklist курса, к которому принадлежит урок** (в отличие от `all_valid_exercises_in_lesson`).

### get_course_score (:509-575)
Аналогично: свежий кэш → blacklist курса → `(null, now)` в кэш; superseded → `null` без кэша; `lessons = graph.get_course_lessons(course)`; `None` → `null`; иначе `valid_lesson_scores = lessons.filter_map(get_lesson_score(l).unwrap_or_default())` (ошибка и `None` отбрасываются); **пусто → `return Ok(None)` БЕЗ записи в кэш** (в отличие от урока, :557-559); иначе среднее. Кэшируется `(avg, now)`. Веса уроков — равные (по числу уроков, не упражнений).

### get_unit_score (:580-593)
`unit_type = graph.get_unit_type(id)` или **Err("missing unit type for unit with ID …")**; Course→`get_course_score`, Lesson→`get_lesson_score`, Exercise→`Some(get_exercise_score)` (**для упражнения blacklist НЕ проверяется** — blacklisted-упражнение возвращает обычную оценку).

### num_trials агрегаты (:596-691)
- `get_lesson_num_trials(lesson)`: кэш (без freshness) → `graph.get_lesson_exercises(lesson)?` (**None → вернуть None без записи в кэш**) → отфильтровать blacklisted упражнения → `trials = exercises.filter_map(get_exercise_num_trials(ex).unwrap_or(None))` → пусто → `None`, иначе `sum/len` как f32 (**упражнения с 0 trials входят как 0**). Результат (в т.ч. None) пишется в `lesson_trials_cache`.
- `get_course_num_trials(course)`: кэш → `lessons = get_course_lessons(course) ?? []`, фильтр: НЕ blacklisted **и НЕ superseded** (`get_superseding_recursive` + `is_superseded`, вычисляется на каждый урок при промахе) → `filter_map(get_lesson_num_trials)` → среднее средних → кэш (даже None). Blacklist самого курса не проверяется.
- `get_avg_trials(unit)`: Course/Lesson → соответствующее; Exercise/None → `None`.
Потребители: `passes_threshold` (`avg_score >= min_score(3.0) && avg_trials >= min_avg_trials(1.8)`; если любое `None` → true; scheduler.rs:523-535).

### Инвалидация (:114-189)
`invalidate_cached_score(unit)`: (a) сначала удаляет `unit` из ВСЕХ пяти кэшей (по id, безотносительно типа); затем по `graph.get_unit_type(unit)`:
| тип юнита | дополнительно удаляется |
|---|---|
| Exercise | `lesson = graph.get_exercise_lesson(u)`: `lesson_cache[lesson]`, `lesson_trials_cache[lesson]`; `course = graph.get_lesson_course(lesson)`: `course_cache[course]`, `course_trials_cache[course]` |
| Lesson | `course_cache[course]`, `course_trials_cache[course]`; `exercise_cache[ex]` для всех упражнений урока (**`lesson_trials_cache` самих упражнений не существует; кэши trials соседних уроков не трогаются**) |
| Course | для каждого урока: `lesson_cache`, `lesson_trials_cache`; для каждого упражнения урока: `exercise_cache` |
| неизвестный тип | ничего сверх (a) |
Чего НЕ делает: не сбрасывает кэши юнитов, которые *supersede* данный или от него зависят (потому superseded-результаты и не кэшируются); Exercise-инвалидация не трогает `exercise_cache` соседей. Каскад вверх при инвалидации Exercise — урок+курс; при Lesson/Course — вниз до упражнений.
`invalidate_cached_scores_with_prefix(prefix)`: `retain(!id.startsWith(prefix))` по всем пяти кэшам; без каскада; пустой префикс очищает всё.

События → вызовы:
| Событие | Вызов |
|---|---|
| `score_exercise(ex)` | `invalidate(ex)` сразу после записи trial (:1146) — каскад ex→lesson→course |
| запись наград (`record_unit_rewards` → `updated_ids` = юниты, у которых награда РЕАЛЬНО записана, а не отсеяна дедупом) | `invalidate(id)` для каждого id (:1162-1164); id — всегда lesson или course ⇒ сбрасываются ВСЕ упражнения этого урока/курса (дорого) |
| blacklist add/remove(unit) (lib.rs:399,405) | `invalidate(unit)` — до записи в blacklist |
| blacklist remove_prefix (lib.rs:411) | `invalidate_with_prefix(prefix)` |
| `set_override_timestamp` | кэши НЕ сбрасываются; спасает только `is_fresh` (в т.ч. отмотка назад) |
| смена `SchedulerOptions` | ничего (и `UnitScorer.options` остаётся старым, §1.6) |
| импорт/переиндексация библиотеки, смена review list, удаление статистики | в этом модуле не обрабатывается [НЕ ПОДТВЕРЖДЕНО: вызывают ли их вызывающие стороны Trane вне lib.rs:399-411; не искалось] |

## 1.4 Крайние случаи / инварианты
- Lesson/course score `null` ≡ «нет валидной оценки» ≡ **удовлетворённая зависимость** (doc :577-579).
- Пустой урок (0 упражнений) никогда не superseding (тест `empty_lesson_cannot_supersede`).
- Ошибка `exercise_scorer` → упражнение выпадает из агрегатов урока; для `get_unit_score(exercise)` — Err.
- Кэш `None` для blacklisted урока/курса живёт ≤2ч или до инвалидации; `all_valid_exercises_have_scores` не кэшируется.
- Сложность: `get_course_num_trials` на каждый промах вызывает `is_superseded` по каждому уроку (рекурсивно, некэшируемо).

## 1.5 Случайность / время / I/O
Время: `Utc::now()` (:109) → `Clock.now()` (мс); `override_timestamp` сохранить (нужен симуляторам/тестам). Случайности нет. I/O: 4 стораджа (`stats`, `deltas`, `rewards`, `blacklist`) — синхронные вызовы (better-sqlite3) → весь класс синхронный; SQLite-ошибки Rust глотает (`unwrap_or_default`) — решение порта: логировать и вести себя так же для чтения, но не глотать ошибку `exerciseScorer`.

## 1.6 Rust-идиомы → решение
- `RefCell<UstrMap>` → `Map<string, …>` (без borrow-проблем; в Rust `invalidate` держит `borrow_mut` exercise_cache при `graph.read()` — в TS не актуально).
- `Result<Option<f32>>` → `number | null` + `throw` для Err (`ScoreError`); `Ok(None)` ≠ Err обязательны (Err в агрегатах отбрасывается через `unwrap_or_default`/`filter_map(ok)`).
- **Устаревшие опции**: `UnitScorer.options` — клон на момент конструктора (:86-99), читается только `num_trials`(:219,229), `num_rewards`(:241,245); а `superseding_score` берётся из `self.data.options` (:397), тоже клон (`SchedulerData: Clone`, options по значению). `set_scheduler_options` (scheduler.rs:1190) обновляет лишь `DepthFirstScheduler.data.options` ⇒ UnitScorer/filter/knocker остаются со старыми (improvement_plan.md:113-117). Решение порта: передавать `options: () => SchedulerOptions` (геттер на единый источник) — это осознанное отклонение от Rust; либо пересоздавать UnitScorer при смене опций.
- `Ustr::starts_with` → `String.prototype.startsWith`.
- `f32` суммы/средние: в TS f64; тесты — с допуском.
- Порядок итерации `UstrSet` в `replace_superseding` не влияет на результат (множество).
- `Box<dyn ExerciseScorer + Send + Sync>` → конструкторная инъекция (там встанет FSRS-скорер).

## 1.7 TEST INVENTORY (`unit_scorer.rs:696-1025`, модуль `test`; все на `init_test_simulation` + `TEST_LIBRARY` 2 курса×2 урока×2 упр.)
| `#[test]` | что проверяет | портируемость | vitest-форма |
|---|---|---|---|
| `blacklisted_course_score` | `get_course_score(blacklisted)==None` | needs fixtures (TestCourse-билдер) | фабрика `TestLibrary`, `blacklist.add('0')`, `expect(scorer.getUnitScore('0')).toBeNull()` |
| `no_valid_exercises_have_scores` | урок в blacklist ⇒ `all_valid_exercises_have_scores == true` | needs fixtures | то же |
| `empty_lesson_cannot_supersede` | урок 1::1 без упр. не supersede 1::0 при score(1::0::0)=5: `all_valid_exercises_have_scores(1::0)`, `get_unit_score(1::1)==None`, `!is_superseded` | needs fixtures + exercise scorer (значение оценки неважно: у пустого урока нет оценки ⇒ `scores.is_empty()`) | `expect(scorer.getUnitScore('1::1')).toBeNull(); expect(scorer.isSuperseded('1::0', new Set(['1::1']))).toBe(false)` |
| `superseded_course_cached` | все упр. оценены 5 → `get_course_score('0')==None` дважды | needs fixtures; **зависит от exercise scorer**: 1 trial «5» должен дать score ≥ `superseding_score` 4.0 (иначе курс 0 не superseded) — перепроверить на FSRS-адаптере | вызвать дважды, ожидать null |
| `superseded_course_lesson_cached` | то же для урока 1::0 | то же | то же |
| `invalidate_cached_scores` | `invalidate_with_prefix('a')` чистит матчащий ключ из **всех 5 кэшей**, `b::a` остаётся; затем `invalidate('b::a')` → все кэши пусты | **needs access to private caches** (в TS: `scorer.__debugCacheSizes()` или тест-хук) | заполнить через тест-хук, проверить оба шага |
| `get_num_trials` | num_trials 2→(кэш)2→после ещё trial + `invalidate` → 3 | needs fixtures | скрипт trial'ов, `Clock` фиксирован |
| `get_urgency` | override_ts=4·day; после ещё trial и invalidate urgency **уменьшилась**; запись появляется в кэше после первого вызова | needs fixtures; зависит от скорера (качественно: свежее успешное повторение ↓urgency) | fake clock |
| `get_velocity` | velocity после «4→5» vs «4→5→4» уменьшилась | needs fixtures; качественно | fake clock |
Пробелы покрытия (добавить в TS): `is_fresh` (граница 7200000 мс, будущий cachedAt), superseded-цепочка (`replace_superseding`), num_trials-агрегаты для урока/курса, инвалидация Exercise→Lesson→Course каскадом. Интеграционно: `tests/superseded_tests.rs` (5: `scheduler_respects_superseded_courses/lessons/course_chain/lesson_chain`, `scheduler_ignores_superseded_exercises`) — needs fixtures.

## 1.8 LOC
Не-тест 692 строки (код без пустых/комментариев ≈509) / тест 332 (≈274).

---

# 2. `reward_scorer.rs` — WeightedRewardScorer

## 2.1 Назначение и поверхность
Сворачивает награды урока и курса в одно число, добавляемое к оценке упражнения; решает, применять ли его. Trait `RewardScorer` (:12-24).
```ts
export const MIN_TRIALS_FOR_REWARD = 3;
export interface RewardScorer {
  scoreRewards(courseRewards: readonly UnitReward[], lessonRewards: readonly UnitReward[], nowMs: number): number;
  applyReward(reward: number, previousTrials: readonly ExerciseTrial[] /* DESC по timestamp */, nowMs: number): boolean;
}
export class WeightedRewardScorer implements RewardScorer { … }
```
Trait возвращает `Result<f32>`, но реализация всегда `Ok`.

## 2.2 Состояние/коллабораторы
Без состояния. Зовётся только `UnitScorer.get_exercise_score` (шаги 8-9). Данные: `UnitReward{unit_id, value: f32, weight: f32, timestamp}` (data.rs:131-144), `ExerciseTrial{exercise_id, score: f32, timestamp}` (data.rs:103-112).

## 2.3 Константы и алгоритмы
| Константа | Значение | Назначение (:26-40) |
|---|---|---|
| `MIN_TRIALS_FOR_REWARD` | `3` (usize) | минимальное число trials, с которого награды применяются |
| `REWARD_HALF_LIFE_DAYS` | `14.0` | период полураспада для ЗНАЧЕНИЯ и ВЕСА награды |
| `MIN_EFFECTIVE_WEIGHT` | `0.05` | награды с эффективным весом ниже игнорируются |
| `COURSE_REWARDS_WEIGHT` | `0.3` | вес курсовых наград в итоге |
| `LESSON_REWARDS_WEIGHT` | `0.7` | вес урочных (урок ближе к упражнению) |
```ts
days_since(r, now)  = floor(max(now - r.timestamp, 0) / 86_400_000)        // Rust: (seconds/86_400) целочисл. деление i64 → f32; в мс: Math.floor(max(dMs,0)/86_400_000)
decay_factor(days)  = 0.5 ** (days / 14)
decayed(r, now)     = (r.value * decay, r.weight * decay)                   // ОБА умножаются на decay
weighted_average(rs, now):
  num = den = 0
  for r of rs: (v, w) = decayed(r, now); if (w < 0.05) continue; num += v * w; den += w
  return den === 0 ? 0 : num / den                                          // ВНИМАНИЕ: числитель = Σ value·weight·decay² (decay входит и в value, и в weight), знаменатель = Σ weight·decay; т.е. результат дополнительно сжимается к 0 со временем
score_rewards(course, lesson, now):
  cs = weighted_average(course); ls = weighted_average(lesson)
  if both empty → 0 ; else if course empty → ls ; else if lesson empty → cs
  else (cs*0.3 + ls*0.7) / (0.3 + 0.7)                                      // знаменатель = 1.0
```
Важно: проверки «пусто» — по ВХОДНЫМ спискам, а не после фильтра по весу; если все награды отфильтрованы по `< 0.05`, `weighted_average` даёт `0.0`, но ветка «обе есть» всё равно смешивает 0.0 с другой стороной с весами 0.3/0.7.
```ts
apply_reward(reward, trials, now):
  if (trials.length < 3) return false
  last = trials[0]; numDays = (now - last.timestamp) / 86_400_000      // Rust: /86400.0 в f32, БЕЗ floor, может быть <0
  avg = (trials[0].score + trials[1].score + trials[2].score) / 3     // take(3), делится на 3.0
  if (reward > 0 && avg < 3.0 && numDays < 7.0) return false            // не поощрять плохо идущие
  if (reward < 0 && avg > 3.5 && numDays < 7.0) return false            // не штрафовать хорошо идущие
  return true                                                            // reward == 0 → true
```
Численные ассерты тестов (цитаты): decay(14)=0.5, decay(28)=0.25 (±0.001); lesson-only награды [(v1,w1,1д),(v2,w1,2д)] → **1.371** (запущено: 1.37093); те же в course-only → 1.371; both (course как выше; lesson [(2,1,1д),(4,2,2д)]) → **2.533** (запущено: 2.53274); min_weight: [(2,1,0д),(1,0.0001,0д−1с)] → 2.0; stale: [(1,10,70д),(1,1,0д)] → `> 0.7` (запущено: 0.7693; 70д → decay=0.03125, w=0.3125 остаётся, поэтому «не тянет знаменатель»).

## 2.4 Крайние случаи
- Будущие timestamps: `max(…,0)` ⇒ decay=1 (не усиливаем).
- `reward == 0` (нет наград) — `apply_reward` может вернуть true, добавление 0 даёт `clamp(score,0,5)`.
- `previous_trials.first().unwrap()` безопасен из-за проверки длины.
- Отрицательные value допустимы (награды знаковые); отрицательный вес исключён источником (веса ≥0.2 из propagator).
- Знаменатель 0 → 0.0 (нет NaN).

## 2.5 Случайность/время/I/O
Время передаётся параметром `now` (в UnitScorer — override или clock) → `Clock`-seam уже на входе. Случайности/I/O нет.

## 2.6 Идиомы
`i64 seconds / 86_400` — целочисленное деление ⇒ в мс `Math.floor` (не `Math.trunc` — эквивалентно при неотрицательном). `f32 powf` → `**` (расхождение ~1e-7). Тесты Rust используют `Utc::now()`; для дней на границе (`generate_timestamp(1)` = ровно now−86400 с) при мс-порте использовать фиксированный `Clock`, иначе flake на floor.

## 2.7 TEST INVENTORY (`reward_scorer.rs:148-509`, 12 тестов)
| `#[test]` | assert | портируемость | vitest |
|---|---|---|---|
| `test_decay_factor` | 0d→1, 14d→0.5, 28d→0.25 | direct | `toBeCloseTo` |
| `test_decayed_reward` | value1/w2 @14d → (0.5,1.0); value−1/w1 → (−0.5,0.5) | direct (fake clock) | `decayedReward` экспортировать/тест-хук |
| `test_decay_uses_provided_time` | 1 полураспад от `now` параметра | direct | фиксированные числа |
| `test_future_timestamp_is_clamped` | ts в будущем +3д → (1.0, 2.0) | direct | — |
| `test_no_rewards` | `score_rewards([],[])==0` | direct | — |
| `test_only_lesson_rewards` | 1.371±0.001 | direct | `now` = константа (в Rust `Utc::now()`) |
| `test_only_course_rewards` | 1.371 | direct | — |
| `test_both_rewards` | 2.533 | direct | — |
| `test_min_weight` | вес 0.0001 отсеян → 2.0 | direct | — |
| `test_stale_rewards_do_not_drag_denominator` | >0.7 | direct | — |
| `test_apply_reward_uses_provided_time` | trials [2,2,3]@t0: `now=t0+2д` → false; `t0+8д` → true | direct | — |
| `test_apply_rewards` | <3 trials → false для ±; avg<3 & <7д: +false/−true; avg>3.5 & <7д: −false/+true; прочие → true | direct | таблица `it.each` |

## 2.8 LOC
Не-тест 144 строки (код ≈87) / тест 364 (≈314).

---

# 3. `scheduler/reward_propagator.rs` — RewardPropagator

## 3.1 Назначение и поверхность
После `score_exercise` порождает награды для уроков/курсов (не упражнений): хорошие оценки «вниз» по графу (к юнитам, которые упражнение охватывает), плохие «вверх» (к юнитам, охватывающим упражнение). Идея FIRe (Math Academy) (:29-31). `pub(super)`.
```ts
export const MIN_ABS_REWARD = 0.2, MIN_WEIGHT = 0.2, WEIGHT_FACTOR = 0.8, REWARD_FACTOR = 0.9;
export class RewardPropagator {
  constructor(private graph: UnitGraph);
  propagateRewards(exerciseId: UnitId, score: MasteryScore /*1..5*/, timestampMs: number): UnitReward[];
  static stopPropagation(reward: number, weight: number): boolean; // ещё используется ReviewKnocker
}
```

## 3.2 Состояние/коллабораторы
Без состояния (держит `SchedulerData` только ради `unit_graph.read()`). Читает `UnitGraph`: `get_exercise_lesson`, `get_lesson_course`, `get_encompasses(unit) -> Option<Vec<(Ustr,f32)>>`, `get_encompassed_by(unit)`. Результат пишет вызывающий (`scheduler.rs:1151-1164`) в `PracticeRewards.record_unit_rewards`. Семантика графа: если `encompasses_graph` **пуст глобально**, `get_encompasses(u)` = dependencies(u) с весом 1.0, а `get_encompassed_by(u)` = dependents(u) с весом 1.0 (graph.rs:659-676); иначе только явно заданные/достроенные `add_encompassed` (зависимости, не перечисленные в encompassed, добавляются с весом 1.0 — graph.rs:370-405; веса проверяются ∈[0,1]).

## 3.3 Константы и алгоритм
| Константа | Значение | Смысл |
|---|---|---|
| `MIN_ABS_REWARD` | `0.2` | ниже по модулю — останов |
| `MIN_WEIGHT` | `0.2` | ниже — останов |
| `WEIGHT_FACTOR` | `0.8` | множитель веса на каждый переход |
| `REWARD_FACTOR` | `0.9` | множитель |value| на каждый переход |
`initial_reward(score)` (:64-72): **Five 0.8; Four 0.4; Three −0.3; Two −0.5; One −1.0**.
`stop_propagation(r, w) = |r| < 0.2 || w < 0.2` (строгое `<`, значения ровно 0.2 проходят).
```ts
propagateRewards(exercise, score, ts):
  lesson = graph.getExerciseLesson(exercise); course = lesson && graph.getLessonCourse(lesson)
  if (!lesson || !course) return []                                // also :104 пустые id → []
  r0 = initialReward(score)
  next = (unit, r) => r > 0 ? graph.getEncompasses(unit) ?? [] : graph.getEncompassedBy(unit) ?? []   // r==0 недостижимо; направление задаётся ЗНАКОМ и не меняется по пути
  stack = []
  for ([id, edge] of [...next(lesson, r0), ...next(course, r0)]) {   // сначала уроки, потом курсы, порядок графа
    value = edge * r0; weight = edge;                                 // первый переход: weight = edge (без 0.8)
    if (!stop(value, weight)) stack.push({unitId: id, value, weight, timestamp: ts})
  }
  results = new Map<UnitId, UnitReward>()
  while (stack.length) {
    item = stack.pop()                                                // LIFO
    ex = results.get(item.unitId)
    if (ex && Math.abs(ex.value) >= Math.abs(item.value)) continue    // «более слабый путь пропускается»; при РАВНОМ |value| выигрывает первый, вес не сравнивается
    results.set(item.unitId, item)                                    // перезапись целиком (value И weight)
    for ([nid, edge] of next(item.unitId, item.value)) {
      nv = edge * 0.9 * item.value; nw = edge * 0.8 * item.weight
      if (!stop(nv, nw)) stack.push({unitId: nid, value: nv, weight: nw, timestamp: ts})
    }
  }
  return [...results.values()]                                        // Rust: HashMap::into_values (порядок произвольный)
```
Замкнутая форма для пути из единичных рёбер, n доп. переходов после первого: `value = r0·0.9ⁿ`, `weight = 0.8ⁿ`. Останов: по весу при n=8 (0.8⁸≈0.168<0.2); по значению раньше веса только у Four (0.4·0.9⁷=0.191<0.2 ⇒ n=7) и Three (0.3·0.9⁴=0.197<0.2 ⇒ n=4); Five (0.8·0.9ⁿ<0.2 при n≥14), Two (n≥9), One (n≥16) упираются в вес (n=8). Первый переход: Five требует edge ≥ 0.25 (edge·0.8≥0.2), Four ≥ 0.5, Three ≥ ≈0.667, Two ≥ 0.4, One ≥ 0.2.
Цитаты тестов: путь 0::1 (edge1) vs 0::2 (edge .5) к 0::3: победитель `value 0.72, weight 0.8` (0.8·0.9·1; 1·0.8·1); цепочка edge 0.8: `first_hop (0.64, 0.8)`, `second_hop (0.4608, 0.512)`.

**Как награды хранятся** (practice_rewards.rs, вне модуля, но нужно для порта): `record_unit_rewards` — в одной транзакции для каждой награды: пропустить, если в in-memory `RewardCache` (≤10 последних на юнит, `MAX_CACHE_SIZE`; при заполнении вытесняется старейшая) есть «похожая»: `value` **точно равно** (`==` f32), `|Δtimestamp| < 86_400` с, `|Δweight| < 0.1` (`WEIGHT_EPSILON`); иначе INSERT, затем удалить все, кроме 20 новейших (по timestamp) для юнита (`OFFSET 20`); вернуть список **записанных** unit_id. Кэш пуст при старте процесса (не подгружается из БД). `get_rewards(unit, n)` → `ORDER BY timestamp DESC LIMIT n`. Комментарий scheduler.rs:1150 «store those that have existing scores» неточен: фильтра по наличию оценок нет.

## 3.4 Крайние случаи
- Нет урока/курса у упражнения → `[]`; юнит без исходящих рёбер → `[]`.
- Ребро с весом 0 отсекается `stop` (weight 0 < 0.2).
- Циклов нет (граф ациклен по валидации); сходимость гарантирована убыванием value/weight + `>=`-отсечением.
- Награды создаются только на юнитах lesson/course (корни — lesson и course упражнения; сами они получают награду лишь как *другие* юниты по рёбрам).
- Сильнейший путь выбирается по |value|; `weight` — «чей был последним записан», а не max — порядок обхода влияет при равных |value| и разных весах (не покрыто тестами).

## 3.5 Случайность/время/I/O
Случайности нет. `timestamp` — параметр (время оценки, мс в порте), в награды записывается как есть. I/O нет (запись делает вызывающий).

## 3.6 Идиомы
`UstrMap` + `into_values` → в TS `Map` (порядок вставки; детерминированнее Rust). **Порядок соседей** (`Vec<(Ustr,f32)>`) влияет на LIFO-обход и выбор при равных |value| — граф порта должен хранить рёбра в порядке добавления. `f32` арифметика: `0.4608`/`0.512` тесты сравнивают с `f32::EPSILON`; в TS использовать `toBeCloseTo(…, 6)`. Условие `reward > 0.0` vs `else` (включает 0 и NaN → encompassed_by).

## 3.7 TEST INVENTORY (`reward_propagator.rs:180-354`, 8 тестов)
| `#[test]` | assert | портируемость | vitest |
|---|---|---|---|
| `initial_reward` | 0.8/0.4/−0.3/−0.5/−1.0 | direct | таблица |
| `stop_propagation` | (0.2,0.2) не стоп; (0.199,·), (−0.199,·), (·,0.199) стоп | direct | — |
| `strongest_path_wins` | к 0::3 два пути, победитель (0.72, 0.8) | needs fixtures (InMemoryUnitGraph — порт графа, `add_encompassed`) | построить граф в тесте |
| `strongest_path_is_order_independent` | то же при обратном порядке добавления рёбер | needs fixtures | — |
| `edge_weights_attenuate_reward_weight` | (0.64,0.8), (0.4608,0.512) | needs fixtures | — |
| `weak_initial_edges_are_pruned` | edge 0.1 → пусто | needs fixtures | — |
| `weak_recursive_hops_are_pruned` | второй хоп edge 0.1 отсечён, первый есть | needs fixtures | — |
| `resolve_roots` | (lesson,course) для упражнения; `None` для неизвестного | needs fixtures | приватный helper → тест через `propagateRewards`/экспорт |

## 3.8 LOC
Не-тест 176 (≈108) / тест 177 (≈150).

---

# 4. `scheduler/review_knocker.rs` — ReviewKnocker

## 4.1 Назначение и поверхность
Из начальной пачки кандидатов (после поиска, до фильтра) считает, насколько каждое упражнение «покрыто» другими юнитами пачки (и насколько оно само покрывает), полностью убирает сильно покрытые высокооценённые повторения и помечает «просто покрытые» для демоушена в окно mastered. `pub(super)`.
```ts
export interface KnockoutResult { candidates: Candidate[]; highlyEncompassed: Candidate[]; }
export class ReviewKnocker {
  constructor(graph: UnitGraph);
  knockOutReviews(initialBatch: Candidate[]): KnockoutResult;   // мутирует encompassesWeight/encompassedWeight кандидатов
}
```
Кандидат `Candidate` — scheduler.rs:121-158 (`lesson_id`, `course_id`, `exercise_id`, `exercise_score`, `encompasses_weight`, `encompassed_weight`, …).

## 4.2 Состояние/коллабораторы
Без состояния. Читает только граф (`get_encompasses`, `get_encompassed_by`, `get_lesson_course`) и `RewardPropagator::stop_propagation`, `REWARD_FACTOR`, `WEIGHT_FACTOR` (общие константы с §3). Вызывается `get_exercise_batch` (:1067); результат идёт в `CandidateFilter.filter_candidates`.

## 4.3 Константы и алгоритм
| Константа | Значение | Смысл (:16-29) |
|---|---|---|
| `VERY_HIGHLY_SCORE` | `4.5` | порог оценки категории «очень сильно покрыт» |
| `VERY_HIGHLY_WEIGHT` | `10.0` | порог суммарного веса покрытия |
| `HIGHLY_SCORE` | `3.75` | порог оценки категории «сильно покрыт» |
| `HIGHLY_WEIGHT` | `5.0` | порог веса |
«Вес» = сумма весов рёбер, по которым lesson/course упражнения был достигнут обходом от юнитов пачки.

```ts
computeEncompassingMap(batch, graph, reverse): Map<UnitId /*exerciseId*/, number> {
  unitSet = new Set(batch.flatMap(c => [c.lessonId, c.courseId]))          // дедуп по юниту
  unitWeight = new Map<UnitId, number>()
  for (const start of unitSet) {
    stack = [{unitId: start, reward: 1.0, weight: 1.0}]; visited = new Set()
    while (stack.length) {
      {unitId, reward, weight} = stack.pop()
      if (visited.has(unitId)) continue; visited.add(unitId)
      next = reverse ? graph.getEncompassedBy(unitId) : graph.getEncompasses(unitId)
      for ([nid, w] of next ?? []) {
        if (w === 0.0 || RewardPropagator.stopPropagation(reward, weight)) continue     // stop проверяется по ТЕКУЩЕМУ item, не по следующему
        unitWeight.set(nid, (unitWeight.get(nid) ?? 0) + w)                              // накапливается вес РЕБРА w, а не затухающий weight
        stack.push({unitId: nid, reward: reward * 0.9, weight: w * weight * 0.8})
        const course = graph.getLessonCourse(nid)                                        // если nid — урок, обойти ещё и его курс
        if (course) stack.push({unitId: course, reward: reward * 0.9, weight: w * weight * 0.8})   // вес самому курсу НЕ прибавляется
      }
    }
  }
  return new Map(batch.map(c => [c.exerciseId, (unitWeight.get(c.lessonId) ?? 0) + (unitWeight.get(c.courseId) ?? 0)]))
}
```
`visited` — на каждый старт отдельно ⇒ каждое ребро достижимого подграфа учитывается один раз на старт (а не по числу путей); вклад одного юнита зависит от числа стартов (уроков/курсов пачки), из которых он достижим. Глубина: элемент глубины d расширяется, если `0.8^d·Πedge ≥ 0.2` (при единичных рёбрах d ≤ 7 ⇒ вес попадает юнитам до глубины 8) и `0.9^d ≥ 0.2` (d ≤ 15).
```ts
knockOutReviews(batch):
  encompassedByMap = computeEncompassingMap(batch, graph, /*reverse*/ false)   // ИМЯ ЗАПУТЫВАЕТ: обход get_encompasses, вес копится на ОХВАЧЕННЫХ юнитах
  encompassesMap   = computeEncompassingMap(batch, graph, /*reverse*/ true)    // обход get_encompassed_by
  for c of batch: c.encompassesWeight = encompassesMap.get(c.exerciseId) ?? 0; c.encompassedWeight = encompassedByMap.get(...) ?? 0
  processed = batch.filter(c => !(w(c) >= 10.0 && c.exerciseScore >= 4.5))     // w = encompassedByMap (default 0)
  highly = processed.filter(c => weightMap.has(c.id) && !(w>=10&&s>=4.5) && w >= 5.0 && s >= 3.75)
  return { candidates: processed, highlyEncompassed: highly }                  // highly ⊂ candidates, НЕ удаляются из candidates
```
Что удаляется/демотируется: **очень сильно** (`w≥10 ∧ score≥4.5`) — удаляются из пачки совсем; **сильно** (`w≥5 ∧ score≥3.75`, кроме предыдущих) — остаются в `candidates`, но фильтр (§5) исключает их из своих естественных окон и добавляет в mastered-окно. Пороги веса используют ТОЛЬКО `encompassed`-карту; `encompasses` служит лишь множителем стоимости в фильтре.

## 4.4 Крайние случаи / известное ограничение
- Нет рёбер encompass → все веса 0 (тест `few_encompassed`); без явных encompassed граф падает на dependencies (вес 1.0), т.е. по умолчанию «покрытие = зависимость» (см. §3.2), что даёт большие веса в длинных цепочках (тест `many_encompassed`: первые 5 курсов ≥10).
- Вес считается по ВСЕМ юнитам, достижимым от lesson/course кандидатов пачки, включая юниты, чьи упражнения в пачку не попали; считаются юниты (рёбра), а не упражнения.
- **Ограничение покрытия (improvement_plan.md:33-107)**: «покрытие» считается по *исходной* пачке, а фактический батч выбирает фильтр позже (`scheduler.rs:1058-1071`); упражнение может быть выкинуто из-за покрывающих упражнений, ни одно из которых не попало в возвращаемый батч. Контрпример (plan :46-67): цели A и B1/B2/B3, U; A получает вес 5+5=10, при `batch_size=1` фильтр может вернуть `[U]`. Это **источниковый контрпример, не запущенный эксперимент**; план предлагает лишь экспериментальный ограниченный ремонт (одна подстановка в окне, резерв подавленных, разделение источников/целей обхода) и **не** рекомендует применять пороги 10/5 к малому батчу. Для порта — переносить поведение как есть (бит-в-бит), ремонт вынести в опциональную фичу.
- Порядок `HashSet` стартов не влияет на результат (суммы коммутативны; отличие только f32-округлением порядка сложения).

## 4.5 Случайность/время/I/O
Нет случайности, времени, I/O (чистая функция от пачки и графа).

## 4.6 Идиомы
`UstrMap<f32>`/`UstrSet` → `Map`/`Set`; `encompassed_by_map`/`encompasses_map` — переименовать в TS (`weightOnEncompassed`/`weightOnEncompassing`), чтобы не повторять путаницу. Кандидат мутируется (`&mut initial_batch`) → либо копировать, либо явная мутация (последующий фильтр читает поля из клонов `highly_encompassed` — они клонируются ПОСЛЕ проставления весов, так что клон содержит оба веса). `usize` не участвует. f32 сравнения `>=` на порогах — граничные значения (`weight == 10.0`) в f64 суммируются иначе (сумма рёбер 0.5+… точна); тесты используют целые веса.

## 4.7 TEST INVENTORY (`review_knocker.rs:230-483`, 4 теста)
| `#[test]` | assert | портируемость | vitest |
|---|---|---|---|
| `test_compute_weight_many_encompassed` | 20 курсов×5 уроков (цепочка depends), 1 упр./урок score 4.5: `false`-карта: первые 5 курсов вес ≥10, последнее упр. = 0; `reverse`: последние 5 курсов ≥10, первое упр. = 0 | needs fixtures (граф `InMemoryUnitGraph` порта; `add_encompassed(id, deps, [])`) | построить граф циклом, `computeEncompassingMap` экспортировать для тестов |
| `test_compute_weight_few_encompassed` | 5×3 без рёбер → все веса 0 в обоих направлениях | needs fixtures | — |
| `test_remove_very_highly_encompassed` | веса ex1=12(4.5) удалён; ex2=8(3.5), ex3=2 остаются | direct (чистая ф-ция над Map) | — |
| `test_get_highly_encompassed` | ex1(12,4.5) исключён как very; ex2(8,3.9), ex5(12,4.0) → highly; ex3(2,2.0), ex4(3,3.8) нет | direct | — |
Ручной пример (выведен по алгоритму, **НЕ запускался**): цепочка L2→L1→L0 (L2 охватывает L1, L1 охватывает L0, рёбра 1.0), один кандидат на урок, один курс C без рёбер. `false`-карта: старт L2 даёт L1+=1, L0+=1; старт L1 даёт L0+=1 ⇒ L0=2, L1=1, L2=0, C=0 ⇒ веса упражнений ex0=2, ex1=1, ex2=0.

## 4.8 LOC
Не-тест 226 (≈158) / тест 256 (≈210).

---

# 5. `scheduler/filter.rs` — CandidateFilter

## 5.1 Назначение и поверхность
Превращает пачку кандидатов после knocker в итоговый батч: раскладывает по 5 окнам мастерства, из каждого окна выбирает квоту взвешенной случайной выборкой без возвращения, добирает остатком, если батч недобран. `pub(super)`.
```ts
export class CandidateFilter {
  constructor(deps: { options: () => SchedulerOptions; getSuccessRate: () => number }, rng: Rng);
  filterCandidates(result: KnockoutResult): Candidate[];
  // чистые, экспортируемые для тестов:
  static candidateCost(c: Candidate): number;
  static candidateWeight(c: Candidate): number;
  static dynamicBatchSize(batchSize: number, numCandidates: number): number;
  static adjustedMasteryWindows(o: SchedulerOptions, successRate: number): SchedulerOptions;
}
export function sampleWeighted<T>(items: readonly T[], amount: number, weight: (t: T) => number, rng: Rng): T[]; // §5.3
interface Rng { random(): number /* f64 in [0,1) */ }
```

## 5.2 Состояние/коллабораторы
Состояния нет (только `data: SchedulerData`: `options` (клон!), `get_success_rate()`). Читает: `SchedulerData.options` (batch_size, окна), `SchedulerData.get_success_rate()` — **счётчик сессии** `trial_counts: Arc<RwLock<(usize,usize)>>` = (успехи, провалы), инициализируется `(0,0)` (lib.rs:285), обновляется `update_success_rate(score)` в `score_exercise` (data.rs:402-409): оценки 1,2 → провал; 3,4,5 → успех; `get_success_rate = total==0 ? 1.0 : succ/total` (f32). Не сбрасывается и не персистится (жизнь = процесс/экземпляр планировщика). **`data.options` фильтра — клон на момент конструктора ⇒ `set_scheduler_options` его не обновляет** (ср. §1.6; sibling-спека scheduler-core §86). `MasteryWindow::in_window(score)` (data.rs:912-921): если `range.1 >= 5.0 && score >= 5.0` → true; иначе `range.0 <= score < range.1`.
Дефолт `SchedulerOptions` (data.rs:1046-1082): `batch_size 50`; окна (percentage, range): new (0.2, [0.0,0.1)), target (0.2, [0.1,2.5)), current (0.3, [2.5,3.75)), easy (0.2, [3.75,4.5)), mastered (0.1, [4.5,5.0]); `passing_score{min_score 3.0, min_fraction 0.5, min_avg_trials 1.8}`, `superseding_score 4.0`, `num_trials 20`, `num_deltas 10`, `num_rewards 10`, `max_lessons_in_progress 10`, `relearn_fraction 0.1`.

## 5.3 Константы и формулы

| Константа (:21-64) | Значение | Роль |
|---|---|---|
| `MIN_CANDIDATE_WEIGHT` | `0.05` | нижняя граница веса |
| `MIN_CANDIDATE_COST` | `0.05` | нижняя граница стоимости |
| `MAX_CANDIDATE_COST` | `100.0` | верхняя граница стоимости |
| `DEPTH_COST_COEFFICIENT` | `0.7` | `log_cost −= 0.7·ln(1+depth)` |
| `ENCOMPASSES_COST_COEFFICIENT` | `0.9` | `log_cost −= 0.9·ln(1+encompasses_weight)` |
| `ENCOMPASSED_COST_COEFFICIENT` | `0.6` | `log_cost += 0.6·ln(1+encompassed_weight)` |
| `SCHEDULED_FREQUENCY_COST_COEFFICIENT` | `2.0` | `log_cost += 2.0·ln(1+frequency)` |
| `DEAD_END_COST_BONUS` | `1.0` | `log_cost −= 1.0` для dead_end |
| `VELOCITY_COST_COEFFICIENT` | `0.5` | `log_cost += 0.5·(−ln(1+velocity))` |
| `STAGNANT_VELOCITY_THRESHOLD` | `0.2` | `|velocity| < 0.2` = стагнация |
| `MASTERED_SCORE_THRESHOLD` | `4.0` | `score ≥ 4.0` = «освоен» для стагнации |
| `STAGNANT_UNMASTERED_COST_BONUS` | `0.7` | `log_cost −= 0.7` (стагнация, score<4.0) |
| `STAGNANT_MASTERED_COST_PENALTY` | `1.0` | `log_cost += 1.0` (стагнация, score≥4.0) |
| `MIN_DYNAMIC_BATCH_SIZE` | `10` | минимум динамического batch |

### candidate_cost / candidate_weight (:105-137)
```ts
candidateCost(c) {
  let L = 0;
  L -= 0.7 * Math.log1p(c.depth);                 // depth: f32 = item.depth+1 (число хопов)
  L -= 0.9 * Math.log1p(c.encompassesWeight);
  L += 0.6 * Math.log1p(c.encompassedWeight);
  L += 2.0 * Math.log1p(c.frequency);             // frequency: usize as f32
  if (c.deadEnd) L -= 1.0;
  if (c.velocity !== null) {
    L += 0.5 * -Math.log1p(c.velocity);           // Rust: `-velocity.ln_1p()` = −(ln_1p(v))
    if (Math.abs(c.velocity) < 0.2) L += c.exerciseScore >= 4.0 ? +1.0 : -0.7;
  }
  return clampRust(Math.exp(L), 0.05, 100.0);
}
candidateWeight(c) = rustMax(c.urgency / Math.sqrt(candidateCost(c)), 0.05)
```
**NaN-семантика (проверено запуском на Rust, f32):** `velocity ≤ −1` → `ln_1p` = −∞ (v=−1) или NaN (v<−1). v=−1: `cost=100.0, weight=0.1` (при urgency 1.0); **v=−2: `cost=NaN`, `weight=0.05`** (`f32::clamp(NaN)`=NaN; `NaN.max(0.05)`=0.05 — Rust `f32::max` игнорирует NaN). В JS `Math.max(NaN,0.05)` = **NaN** (запущено), что сломает выборку. Порт ОБЯЗАН реализовать `rustMax(a,b) = Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.max(a,b)` (и `clamp` с NaN → NaN). Velocity — наклон OLS в «баллов/день» (exercise_scorer.rs:413-441) и легко выходит за −1 (два trial'а с разницей минут ⇒ огромный |slope|), поэтому это не теоретический случай: такие кандидаты получают минимальный вес 0.05 (возможно, непреднамеренно; сохранить поведение).
Знаки: depth ↑ → cost ↓ (больше «хопов» → вес больше); `encompasses` ↑ → cost ↓; `encompassed` ↑ → cost ↑; `frequency` ↑ → cost ↑ (в 2.0 раза сильнее остальных); положительная velocity ↓cost; отрицательная ↑cost.

### Взвешенная случайная выборка без возвращения (:144-172, rand 0.10.3)
`select_candidates(candidates, n)`:
1. Если `candidates.len() <= n` → `(candidates.clone(), [])` — **RNG не потребляется**, порядок исходный, остаток пуст (:149-151).
2. Иначе `rng = rand::rng()` (**thread-local ChaCha12, не сидируемый**), `candidates.sample_weighted(&mut rng, n, candidate_weight).unwrap()` (`IndexedRandom::sample_weighted`, rand 0.10 seq/slice.rs:254-278: `amount=min(amount,len)`, веса `f32→f64`, вызывается `seq::index::sample_weighted`, index.rs:305-332 → `sample_efraimidis_spirakis`, index.rs:352-445).
3. `selected` — в порядке итерации `BinaryHeap` (внутренний массив кучи; **порядок неопределён, не отсортирован**; дальше `Shuffler` перемешивает батч — порядок несущественен). `remainder` = кандидаты, чей `exercise_id` не в `selected` — в исходном порядке (:162-169).
4. `.unwrap()` паникует только при `WeightError::InvalidWeight` (вес NaN/<0); веса `candidate_weight` ≥0.05 или NaN→0.05 из-за `max`, поэтому паники нет.

**Точный алгоритм (A-ExpJ, Efraimidis–Spirakis 2005, лог-ключи; index.rs:352-445):**
```
если amount == 0 → []
heap = min-heap по key (BinaryHeap с reverse-Ord; peek() = наименьший key), ёмкость amount
i = 0
// фаза 1: заполнить резервуар первыми amount элементами с weight>0
while i < length and heap.size < amount:
    w = weight(i) (f64)
    if w > 0: heap.push({i, key: ln(U) / w})   // U = rng.random::<f64>() ∈ [0,1); ln(U) ≤ 0 ⇒ key ≤ 0
    else if !(w >= 0): Err(InvalidWeight)
    i++
// фаза 2: экспоненциальные «прыжки»
if i < length:
    x = ln(U') / heap.peek().key                    // положительный порог накопленного веса
    while i < length:
        if !x.isFinite(): Err(InvalidWeight)
        w = weight(i)
        if w > 0:
            x -= w
            if x <= 0:                              // элемент i вытесняет минимум
                min = heap.pop()
                t = exp(min.key * w)
                key = ln( rng.random_range(t..1.0) ) / w      // равномерное на [t,1)
                heap.push({i, key})
                x = ln(U'') / heap.peek().key
        else if !(w >= 0): Err(InvalidWeight)
        i++
return индексы всех элементов кучи (порядок кучи)
```
**Распределение:** эквивалентно последовательному взвешенному выбору без возвращения (модель Плакетта–Льюса): вероятность выбора очередного элемента среди оставшихся ∝ `weight`; вероятность включения в выборку растёт с весом; `amount` элементов всегда возвращается (если ≥amount имеют weight>0; здесь все веса ≥0.05). Пример из документации rand (`{a:2,b:1,c:1}`, amount=2): теория `{a,b}` 41.7 %, `{a,c}` 41.7 %, `{b,c}` 16.6 %. Замер `sample_weighted` (rand 0.10.3, 200 000 прогонов, запущено): `ab 0.4162, ac 0.4175, bc 0.1663`.
**TS-порт «статистически эквивалентный»:** (а) точная копия A-ExpJ (нужен только бинарный min-heap и `Rng.random()`; `random_range(t..1.0)` = `t + (1−t)·random()`; защита `U=0` ⇒ `ln 0 = −∞`, заменить `U = random() || Number.MIN_VALUE`), либо (б) проще и эквивалентно по распределению — A-Res: `key_i = ln(U_i)/w_i` для всех i, взять `amount` с наибольшим key (O(n log n) или частичная сортировка). Побитового совпадения с Rust быть не может (другой ГСЧ, другой поток чисел; A-Res и A-ExpJ дают одно распределение, но разные последовательности). Замер варианта (б) в JS на трёх весах примера (0.28993616, 2.0930185, 0.05), 400 000 прогонов, amount=2 (запущено): `{0,1} 0.8491, {1,2} 0.1455, {0,2} 0.0054`; Rust `sample_weighted` на тех же весах (200 000): `0.8506 / 0.1442 / 0.0052`; теория ПЛ: 0.850 / 0.147 / 0.0053. Тесты для порта — статистические (частоты в допуске) или с детерминированным `Rng`-стабом; не завязываться на порядок результата.

### add_remainder (:176-196), dynamic_batch_size (:200-213)
```ts
addRemainder(batchSize, final, remainder, maxAdded?) {
  if (final.length >= Math.floor(batchSize * 3 / 4)) return;      // usize: (batch_size*3)/4 целочисл.
  const numRemainder = batchSize - final.length;                   // >0 гарантировано проверкой выше
  const numAdded = maxAdded === undefined ? numRemainder : Math.min(numRemainder, maxAdded);
  final.push(...selectCandidates(remainder, numAdded)[0]);         // ещё одна взвешенная выборка из остатка
}
dynamicBatchSize(batchSize, numCandidates) {
  if (batchSize < 10) return batchSize;
  if (numCandidates < batchSize * 3) return Math.max(Math.floor(numCandidates / 3), 10);
  return batchSize;
}
```
Тесты: `dynamic(5,10)=5`, `dynamic(50,70)=23`, `dynamic(50,10)=10`, `dynamic(50,150)=50`, `dynamic(50,200)=50`. Пороги добора: bs=1→0, 2→1, 3→2, 50→37 (при малом bs, напр. 1–3, добор практически не работает: `final.len() ≥ ⌊3bs/4⌋` почти всегда).

### adjusted_mastery_windows (:217-254) — «обработка success rate»
```ts
adjusted(options, sr) {           // sr: число сессии ∈[0,1]; 1.0 при отсутствии оценок
  const o = clone(options)
  shift = sr > 0.90 ? +0.05
        : (sr >= 0.75 && sr <= 0.90) ? RETURN o          // оптимальная зона [0.75, 0.90] — без изменений
        : (sr >= 0.50 && sr < 0.75) ? -0.05
        : -0.10                                            // sr < 0.50 (и NaN)
  clamp = p => min(max(p, 0.05), 0.50)
  new.pct = clamp(o.new.pct + shift); target.pct = clamp(o.target.pct + shift)     // «трудные» окна
  easy.pct = clamp(o.easy.pct - shift); mastered.pct = clamp(o.mastered.pct - shift) // «лёгкие» окна
  sum = new + target + easy + mastered                        // порядок сложения new, target, easy, mastered
  current.pct = max(1.0 - sum, 0.05)                          // current поглощает остаток
  return o
}
```
Дефолтные результаты: shift +0.05 → new .25 / target .25 / easy .15 / mastered .05 / current .3; −0.05 → .15/.15/.25/.15/.3; −0.10 → .10/.10/.30/.20/.3 (в f32 current: 0.3, 0.29999995, 0.3 — запущено). Сумма ровно 1.0 гарантируется только для дефолтных процентов; при иных clamp/floor 0.05 может дать сумму ≠1 (не проверяется).

### filter_candidates (:258-340) — полный порядок шагов
1. `options = adjusted(data.options, data.get_success_rate())`; `bs = dynamicBatchSize(options.batch_size, candidates.length)` — `candidates` = `result.candidates` **после knocker (highly_encompassed включены, very_highly удалены)**; `bs_f = bs as f32`.
2. `encompassed_set` = id из `result.highly_encompassed`. `candidates_in_window(cands, encompassed_set, window)` = `window.in_window(c.exercise_score) && !encompassed_set.has(c.exercise_id)` (порядок сохраняется). Кандидат вне всех окон (дыры в пользовательских окнах) теряется.
3. Списки для окон mastered, easy, current, target, new; затем `mastered.extend(result.highly_encompassed)` (в mastered добавляются ВСЕ highly, независимо от их естественного окна).
4. Квоты — для каждого окна `n = trunc(max(bs_f * pct, 1.0))` (`as usize` усечение; **минимум 1 на окно, поэтому при малом bs сумма квот может превысить bs**, напр. bs=4 → до 5). Выбор в порядке **mastered, easy, current, target, new**: `select_candidates(window_list, n)` → `selected` в `final`, `remainder_x` запоминается.
5. `base_remainder = max(floor(bs / 10), 1)`. Добор в порядке: `current_remainder` (без лимита), `new_remainder` (лимит `5·base_remainder`), `target_remainder` (лимит `3·base_remainder`), `easy_remainder` (без лимита), `mastered_remainder` (без лимита) — каждый вызов `addRemainder` перепроверяет порог 3/4.
6. Возврат `final` (порядок: mastered→easy→current→target→new→остатки; дальше Shuffler в scheduler.rs). Релёрн-пул фильтра не касается.

**Квоты для дефолтных окон** (запущено, Rust f32; порядок `mast,easy,cur,tgt,new`): bs=50, sr в зоне → (5,10,15,10,10)=50; sr>0.9 (+0.05) → (2,7,15,12,12)=48; sr∈[.5,.75) → (7,12,**14**,7,7)=47; sr<.5 → (10,15,15,5,5)=50. bs=20: (2,4,6,4,4); (1,3,6,5,5); (3,5,5,3,3); (4,6,6,2,2).
**Расхождение f32/f64 (запущено):** наивная f64-арифметика в JS даёт для sr>0.9, bs=50 квоту current = **14** (Rust: 15) — `1 − (0.25+0.25+0.15+0.05)` в f64 = 0.29999999999999993 ⇒ `×50 = 14.999999999999996` ⇒ trunc 14; в f32 = 0.30000001 ⇒ 15. Для sr∈[.5,.75) оба дают 14 (f32: 0.29999995). Порт должен воспроизводить f32: `const f=Math.fround`, пересчитать `pct = f(f(p)+f(shift))`, `clamp` в f32, `sum = f(f(f(n+t)+e)+m)`, `current = max(f(f(1)-sum), f(.05))`, квота `Math.trunc(Math.max(f(f(bs)*pct), 1))`. Проверено: такая fround-эмуляция даёт те же 12 строк квот, что и Rust (`specs/_verify_scoring_filter/q2.mjs` против `src/bin/quotas.rs`). Наивные f64 или `+1e-9` — не эквивалентны.

## 5.4 Работа с `frequency`, `dead_end`
- `frequency` = `data.frequency_map[exercise_id] ?? 0` — число раз, сколько упражнение планировалось в ЭТОЙ сессии (in-memory, `increment_exercise_frequency` после формирования батча, scheduler.rs:1097-1100); в фильтре только член cost: `+2.0·ln(1+f)` (f=1: +1.386; f=5: +3.58; f=1000: cost клампится до 100).
- `dead_end` = урок, на котором поиск остановился (`!passes_threshold`, scheduler.rs:835-844): `−1.0` к `log_cost` (cost ×e⁻¹≈0.368, weight ×1.65).
- Клемпы: `cost ∈ [0.05,100]`, значит `weight = urgency/√cost ∈ [urgency/10, urgency/0.2236]`, затем `max(…, 0.05)`.

## 5.5 Рабочий числовой пример (запущено: Rust f32 `src/bin/cost_sampling.rs` и JS f64 `chk.mjs`, значения совпали)
Кандидаты (urgency, depth, frequency, encompasses, encompassed, dead_end, velocity, score):
- **A**: urgency 0.6, depth 3, freq 1, encompasses 2.0, encompassed 5.0, dead_end=false, velocity 0.1, score 4.2
- **B**: urgency 0.9, depth 1, freq 0, encompasses 0, encompassed 0, dead_end=true, velocity 0.5, score 2.0
- **C**: urgency 0.2, depth 6, freq 3, encompasses 0, encompassed 12.0, dead_end=false, velocity None, score 4.8

| член log_cost | A | B | C |
|---|---|---|---|
| `−0.7·ln(1+depth)` | −0.97041 (ln4=1.3863) | −0.48520 (ln2) | −1.36214 (ln7=1.9459) |
| `−0.9·ln(1+enc.)` | −0.98875 (ln3) | 0 | 0 |
| `+0.6·ln(1+encd.)` | +1.07506 (ln6) | 0 | +1.53897 (ln13) |
| `+2.0·ln(1+freq)` | +1.38629 (ln2) | 0 | +2.77259 (ln4) |
| dead_end `−1.0` | 0 | −1.0 | 0 |
| `0.5·(−ln(1+v))` | −0.04766 (v=0.1) | −0.20273 (v=0.5) | 0 (нет velocity) |
| стагнация `|v|<0.2`: A: score 4.2≥4.0 ⇒ `+1.0` (v=0.1); B: |0.5|≥0.2 ⇒ 0; C: n/a | +1.0 | 0 | 0 |
| **log_cost** | **1.45454** | **−1.68794** | **2.94942** |
| `cost = clamp(exp(L),0.05,100)` | **4.28250** | **0.18490** | **19.09490** |
| `raw = urgency/√cost` | 0.6/2.06943=**0.28994** | 0.9/0.43000=**2.09302** | 0.2/4.36976=0.04577 |
| **weight = max(raw, 0.05)** | **0.28994** | **2.09302** | **0.05** (поднят клампом) |
Rust f32 вывод: `A cost=4.282504 weight=0.28993616 / B cost=0.18490084 weight=2.0930185 / C cost=19.094902 weight=0.05`. Вероятность выбрать одного (amount=1) ∝ вес: сумма 2.43296 ⇒ A 11.9 %, B 86.0 %, C 2.05 %; замер `sample_weighted` (200 000): `[0.1195, 0.8602, 0.0203]`. Для amount=2 (замер Rust): `{A,B} 0.8506, {B,C} 0.1442, {A,C} 0.0052`.
Пример квот: bs=50, 70 кандидатов после knocker: `dynamicBatchSize(50,70)=23` (⌊70/3⌋; `<150`), при 23 квоты (sr в зоне, f32): mast `trunc(max(23·0.1,1))=2`, easy 4, current 6, target 4, new 4 [значения выведены арифметикой, не запуском]; порог добора `⌊3·23/4⌋=17`; `base_remainder=max(2,1)=2`, лимит для new `10`, target `6`.

## 5.6 Крайние случаи
- `candidates.len() <= n` ⇒ весь список без RNG; пустое окно ⇒ `([],[])`.
- Батч может быть меньше `bs` (мало кандидатов), и больше `bs` (min-1 на окно).
- Один и тот же остаток выбирается несколько раз только через разные окна — дубликатов нет (списки окон не пересекаются, highly исключены из естественных окон).
- `remainder` берётся по `exercise_id`; дубликаты id в окнах исключены `deduplicate_candidates` (scheduler.rs:968-972).
- `urgency` может быть 0 ⇒ weight = 0.05 (не 0) — кандидат всё ещё выбираем.
- Success rate `>0.90` / `<0.75` — границы f32-сравнения: `9/10=0.9f32` равен литералу `0.90` ⇒ «в зоне».

## 5.7 Случайность / время / I/O / seams
Единственный источник случайности — `rand::rng()` внутри `select_candidates` (`filter.rs:156`). Seam порта: `Rng.random(): [0,1)` инъектируется в конструктор (вызывается ПОСЛЕДОВАТЕЛЬНО по окнам, в порядке §5.3 п.4-5 — при одинаковом сиде порядок обращений детерминирован). Времени и I/O нет. Успех-статистика сессии — состояние `SchedulerData` (в порт: `SessionStats` с `update(score)`/`successRate()`).

## 5.8 Rust-идиомы → решение
`f32` (fround-эмуляция в квотах/окнах, §5.5) ; `usize` (`bs*3/4` целочисленно; `bs - final.len()` не уходит в минус из-за раннего выхода); NaN-семантика `f32::max/clamp` (`rustMax`); `IndexedRandom::sample_weighted` (→ `sampleWeighted`); `BinaryHeap` порядок → не полагаться; `UstrSet` для `encompassed_set` → `Set<string>`; `Vec<Candidate>` клоны → в TS достаточно ссылок, если кандидаты иммутабельны после knocker; `unwrap()` на выборке → не бросать (веса всегда валидны после `rustMax`).

## 5.9 TEST INVENTORY (`filter.rs:345-808`, 18 тестов, все `#[test]` без внешних файлов)
| `#[test]` | assert | портируемость | vitest |
|---|---|---|---|
| `dynamic_batch_size` | (5,10)→5; (50,70)→23; (50,10)→10; (50,150)→50; (50,200)→50 | direct | таблица |
| `candidates_in_window` | окно [2,4), encompassed_set{ex1,ex5} ⇒ остаются ex2(3.0), ex3(3.7) | direct | — |
| `add_remainder` | bs=10: из 1 → добавляются (>1, <10); при len=⌊30/4⌋+1=8 → без изменений; `max_added=1` → +1 (итого 2) | direct: в 1-м случае `num_added(9) ≥ remainder(3)` ⇒ `select_candidates` возвращает всё без RNG; в 3-м выбирается 1 из 3 (длина результата не зависит от исхода) — годится любой `Rng` | обычный `Rng` из `Math.random`/стаб |
| `more_hops_more_weight` | weight(depth 0) < weight(depth 10) при urgency 1 | direct | — |
| `higher_urgency_more_weight` | urgency 1.0 > 0.25 | direct | — |
| `more_scheduled_frequency_less_weight` | freq 5 < freq 1 | direct | — |
| `higher_encompassed_weight_less_weight` | encompassed 10 < 3 | direct | — |
| `higher_encompasses_weight_more_weight` | encompasses 10 > 3 | direct | — |
| `dead_end_more_weight` | cost(dead_end)<cost(base), weight > | direct | — |
| `candidate_cost_clamped` | favorable (depth 500, encompasses 500, dead_end) → ровно 0.05; unfavorable (freq 1000, encompassed 1000, velocity 10.0) → ровно 100.0 | direct | `toBe` |
| `candidate_weight_clamped` | urgency 0.0001 + favorable ⇒ ровно `MIN_CANDIDATE_WEIGHT` 0.05 | direct | — |
| `positive_velocity_more_weight` | v=1.0 > v=0.5 (score 2.0) | direct | — |
| `negative_velocity_less_weight` | v=−1.0 < без velocity | direct — **но при v=−1 ln_1p=−∞, cost=100; тест проходит через кламп; в TS нужен `rustMax`/корректный `log1p(-1)=-Infinity`** | — |
| `stagnant_low_score_gets_bonus` | v=0.05, score 2.0 ⇒ cost меньше, weight больше | direct | — |
| `stagnant_high_score_gets_penalty` | v=0.05, score 4.5 ⇒ cost больше, weight меньше | direct | — |
| `positive_velocity_reduces_cost` | v=0.5 (score 2.0) ⇒ cost ↓, weight ↑ | direct | — |
| `negative_velocity_increases_cost` | v=−0.5 ⇒ cost ↑, weight ↓ | direct | — |
| `adjusted_mastery_windows` | sr 0.85/0.75/0.90 — без изменений; 0.95 → new,target ↑, easy,mastered ↓; 0.60 → обратно; 0.30 сильнее, чем 0.60; сумма 5 окон = 1.0 (±1e-6) при sr ∈{0,.3,.6,.8,.95,1.0} | direct (добавить проверку квот f32 из §5.5) | таблица |
Пробелы (добавить): `select_candidates` (n≥len ⇒ без RNG; статистическая частота для 3 весов §5.5), `filter_candidates` целиком (порядок окон, highly→mastered, добор 3/4), NaN-velocity кейс (`v<−1 ⇒ weight 0.05`), f32-квоты.

## 5.10 LOC
Не-тест 341 (≈201) / тест 466 (≈399).

---

# 6. Сквозные решения для порта и открытые вопросы
1. **f32→f64**: везде допуск; исключение — квоты/проценты окон (`fround`-эмуляция, §5.5) и NaN-семантика `max/clamp` (`rustMax`, §5.3).
2. **Время в мс**: `MAX_CACHE_AGE=7_200_000`, `86_400_000` для суток в `days_since` (floor) и `apply_reward` (без floor); окно дедупа наград `< 86_400_000` мс (practice_rewards).
3. **Опции**: Rust держит устаревшие клоны в UnitScorer/filter/knocker/relearn_pile; порт — единый источник (`() => SchedulerOptions`) и тест на «изменение опций доходит до компонентов»; иначе поведение отличается от Rust (документированный дефект).
4. **`num_deltas` не используется** при чтении дельт (берётся `num_trials`=20 вместо `num_deltas`=10) — сохранить или исправить осознанно.
5. **Кэш trials-агрегатов без TTL** и `None`-исходы кэшируются (lesson blacklisted → `(None, now)`; course «нет валидных уроков» — не кэшируется) — воспроизвести, они наблюдаемы.
6. **`get_unit_score(exercise)` не проверяет blacklist**; lesson score не проверяет blacklist курса — оба поведения зависят от вызывающего кода (scheduler отсекает blacklisted раньше, через `all_valid_exercises_in_lesson`).
7. **FSRS-контракт для UnitScorer**: скорер обязан вернуть `{value∈[0,5], urgency∈[0,1], velocity: number|null}`; `apply_reward` и knocker используют шкалу 0–5; тесты `superseded_*` требуют, чтобы оценка после единственного trial «5» была ≥ 4.0 (`superseding_score`).
8. Не выяснено: вызовы `invalidate_cached_score` из других мест Trane помимо lib.rs:399-411 и scheduler.rs:1146,1163 (не искалось); поведение `Blacklist::blacklisted` — только точное совпадение id (blacklist.rs:194-196), вложенность курс→урок→упражнение обрабатывается в `SchedulerData::all_valid_exercises*`.

---

# Приложение: что запускалось
Каталог `specs/_verify_scoring_filter/` (Cargo-крейт `sf`, зависимость `rand = "0.10.2"`, офлайн из `~/.local/share/cargo/registry`; `target/` удалён):
```
CARGO_TARGET_DIR=$PWD/target cargo run --offline --release --bin cost_sampling
  A cost=4.282504 weight=0.28993616 | B cost=0.18490084 weight=2.0930185 | C cost=19.094902 weight=0.05
  v=-2: cost=NaN weight=0.05 | v=-1: cost=100.0 weight=0.1
  ab: 0.4162  ac: 0.4175  bc: 0.1663   (sample_weighted {a:2,b:1,c:1}, amount=2, n=200000)
  amount=2 [0,1]: 0.8506  [0,2]: 0.0052  [1,2]: 0.1442
CARGO_TARGET_DIR=$PWD/target cargo run --offline --release --bin quotas       # квоты окон f32 (12 строк, §5.5)
node chk.mjs   # члены log_cost, A-Res vs Plackett-Luce, Math.max(NaN,0.05)=NaN, reward_scorer 1.371/2.533/0.769
node q.mjs     # квоты наивной f64
node q2.mjs    # квоты через Math.fround — совпадают с Rust
```
Формулы `cost`/`weight` в `cost_sampling.rs` — копия `filter.rs:105-137` (f32), а не вызов исходного крейта (`trane-pristine` не модифицировался и не собирался).
