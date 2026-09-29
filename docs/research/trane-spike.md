# Spike: Trane v0.34.1 как scheduling engine (MVP local-first adaptive learning)

> **Статус артефактов (2026-09-29).** Каталог `spike/trane-mvp/` (код спайка, `run-output.txt`) удалён; отчёт остаётся. Курс сохранён в `engine-ts/reference/sql-course/`, исходник Trane — в `engine-ts/reference/trane-pristine/`. Раздел «Как воспроизвести» ниже не выполняется.

Всё ниже — наблюдения из реального запуска (`spike/trane-mvp`, release build, macOS arm64, Apple M5 Pro, Cargo 1.97) или чтения исходников `trane-src/` (shallow clone v0.34.1; лицензия AGPL-3.0-or-later подтверждена ранее). Полный сырой вывод: `spike/trane-mvp/run-output.txt`. Неподтверждённое помечено `[НЕ ПОДТВЕРЖДЕНО]`.

## Как воспроизвести

```
cd spike/trane-mvp
cargo build --release                    # ~35 c холодно; trane подключён как path-зависимость ./trane-src
B=target/release/trane-spike
$B gen                                   # пишет lib_json/ и lib_kb/ (курс SQL, 7 уроков x 3 упражнения)
$B frontier json|kb                      # п.2
$B runner json ; $B minimal json         # п.3
$B assets json|kb ; $B unknown           # п.4
$B encompass json Two|Three|Four|Five    # п.5
$B bench 1500                            # п.6
$B validate ; $B split ; $B replay       # доп. проверки для F2 / F7
```

Исходники: `src/main.rs` (все сценарии), `src/course.rs` (описание курса + генераторы обеих форм). Зависимость: только `trane` (path), `anyhow`, `ustr`, `serde_json`, `serde_yaml`, `vfs` (нужен только для `new_local_with_vfs`).

Курс (`src/course.rs`): `select`, `ddl` — корни; `where`, `aggregate` ← `select`; `join` ← `where`+`aggregate` (ромб); `subquery` ← `join` ← ... цепочка `join → subquery → window`. `encompassed`: `join→where 0.5` (зависимость с нестандартным весом), `subquery→select 0.7` и `window→aggregate 0.5` (не зависимости, транзитивные). 3 упражнения на урок.

---

## 1. Две формы авторинга курса

Обе формы загрузились без правок Trane; поведение планировщика идентично (см. п.2, вывод `frontier json` и `frontier kb` совпадает по структуре).

| | Ручной JSON | KnowledgeBase (`*.lesson`) |
|---|---|---|
| Файлов на курс (7 уроков x 3 упр.) | 43 (`find lib_json -type f`, без `.trane`) | 37 (`find lib_kb ...`) |
| Файлов на упражнение | 2–3: каталог упражнения + `exercise_manifest.json` (+ `.md`) | 1: `qN.front.md` |
| ID | пишутся полностью в каждом манифесте (`sql_json::join::q1`), `course_id`/`lesson_id` дублируются и проверяются | выводятся из имён каталогов/файлов (`sql_kb::join::q1`), зависимости пишутся короткими ID (`["where","aggregate"]`) и конвертируются в полные (`knowledge_base.rs`, `convert_to_full_ids`) |
| Тип ассета упражнения | любой `ExerciseAsset` (мы использовали `BasicAsset::MarkdownAsset` и `BasicAsset::InlinedAsset`) | всегда `FlashcardAsset{front_path, back_path}` (или inline при `"inlined": true`) |
| `encompassed` | `lesson_manifest.json`: `[["sql_json::where",0.5]]` | `lesson.encompassed.json`: `[["where",0.5]]` |

Вывод: **KnowledgeBase — заметно меньше трения** (1 файл на упражнение, короткие ID, нет дублирования `lesson_id/course_id`). Для MVP с Markdown-упражнениями с frontmatter это естественный формат: `qN.front.md` = условие + `check:`.

Подводные камни (наблюдалось / прочитано):
- KB: у урока не должно быть `lesson_manifest.json`; каталог урока должен называться `<id>.lesson` (`knowledge_base.rs:344-361`); `course_manifest.json` обязан содержать `"generator_config": {"KnowledgeBase": {}}`, иначе `*.lesson` не будут прочитаны `[по чтению кода course_library.rs:300-312]`.
- KB: тип `ExerciseAsset` фиксирован = flashcard. Своего asset-типа нет (см. п.4).
- JSON: `exercise_manifest.json` — ровно один на каталог; путь `MarkdownAsset.path` относителен каталогу манифеста, но в возвращённом `ExerciseManifest` он нормализован к пути **относительно корня библиотеки** (`sql_json/join/q1/q1.md`) — см. вывод п.4.
- Оба: `dependencies` на несуществующий юнит **принимается молча** (`validate`: `missing dependency -> accepted silently`).
- Неявный `course_manifest.json` нужен всегда (для JSON — минимум `{"id": ...}`).

## 2. Frontier gating (`get_exercise_batch(None)` + `score_exercise`)

Каждый шаг: `override_current_timestamp(T0 + step*86400)`, batch, все упражнения из batch оцениваются `MasteryScore::Four` с тем же `ts`. Вывод `frontier json` (выдержка; `kb` — то же самое):

```
step 0 batch=6 lessons: ddlx3 selectx3   NEW: ["ddl", "select"]
step 1 batch=4 lessons: ddlx2 selectx2   NEW: []
step 2 batch=4 lessons: ddlx2 selectx2   NEW: []
step 3 batch=7 lessons: aggregatex3 selectx1 wherex3   NEW: ["aggregate", "where"]
        scores: select=3.97 ddl=3.81 where=4.00 aggregate=4.00 join=0.00 ...
step 6 batch=10 lessons: aggregatex1 ddlx2 joinx3 selectx2 wherex2   NEW: ["join"]
step 8 ... join=3.84 subquery=0.00 window=0.00     (subquery/window за 9 дней не открылись)
```

Наблюдения:
- В начале в batch только корневые уроки (`ddl`, `select`) — gating работает. `join` (ромб) открылся только после того, как **оба** `where` и `aggregate` прошли порог.
- Открытие происходит не сразу после первого успешного ответа: `where/aggregate` открылись на шаге 3 (после 3 шагов; на шагах 1–2 batch содержал только по 2 упражнения из 3 на урок).
- Batch не «весь список разблокированного»: размер 4–10 при 21 упражнении; состав/размер определяют mastery-окна и `select_candidates` (для уроков с avg ≥ 3.0 возвращается только часть упражнений, минимум `min_fraction=0.5`, `scheduler.rs:315-340`). Состав batch случаен (shuffle), поэтому для отображения «разблокированных уроков» нужно либо агрегировать несколько batch, либо считать frontier самим по графу (см. friction).
- `get_unit_score` урока = среднее по **всем** упражнениям урока, где ненесыгранные считаются как 0 (`unit_scorer.rs:430-500`), плюс награды от других юнитов.
- Оценка «Four» на следующий день падает (4.00 → 3.87): score зависит от времени (decay в `PowerLawScorer`).

## 3. Имитация runner’а и минимальное число ответов

Фейковый верификатор (`verify(exercise_id, attempt) -> Verdict{passed, attempts}`, лимит 3 попытки) и маппинг (`to_mastery` в `src/main.rs`):
pass с 1-й попытки → `Five`; pass со 2-й → `Three`; pass с 3-й → `Two`; fail → `One`. В `MasteryScore` нет `Copy` (только `Clone`) — мелкое неудобство.

**STRONG learner** (все с первой попытки): последовательно открываются `ddl,select` (шаг 0) → `where,aggregate` (шаг 2) → `join` (шаг 4) → `subquery` (шаг 6) → `window` (шаг 8):
```
step 2 batch= 7 [aggregatex3 ddlx1 wherex3] NEW=["aggregate", "where"]
step 4 batch=10 [aggregatex2 ddlx2 joinx3 selectx1 wherex2] NEW=["join"]
step 6 batch=10 [aggregatex2 ddlx2 joinx2 subqueryx3 wherex1] NEW=["subquery"]
step 8 batch=10 [ddlx2 selectx2 subqueryx2 wherex1 windowx3] NEW=["window"]
```

**WEAK learner** (`where`: pass со 2-й попытки → `Three`; `join`: fail): `where` устойчиво сидит на ≈3.00–3.08, и `join` **не появляется в batch ни разу за 9 дней**:
```
step 4 batch=10 [aggregatex3 ddlx3 selectx1 wherex3] NEW=[]   where=3.08 aggregate=5.00 join=0.00
step 8 batch=10 [aggregatex2 ddlx3 selectx2 wherex3] NEW=[]   where=3.06 aggregate=5.00 join=0.00
```
Проверка (`SAMPLE=1 trane-spike runner json`): сразу **после** скоринга шага 4 в 30 batch `join` присутствует 3 раза в каждом; но на следующий день перед новым скорингом — нет. Согласуется с гипотезой: между повторениями score `where` падает ниже `min_score=3.0` (time decay), и dependents закрываются, а после нового ответа `Three` снова открываются (`passes_threshold`, `scheduler.rs:523-535`). Строго причина падения не изолирована `[НЕ ПОДТВЕРЖДЕНО]`, но сам эффект (gating «мигает» при оценке ≈3) воспроизведён.

**Вывод для маппинга F5:** `Three` (= ровно `min_score`) как «pass после retry» непригоден для gating — открывать зависимые уроки будут только `Four`/`Five`. Если retry-pass должен засчитываться, его нужно маппить в `Four` либо менять `SchedulerOptions.passing_score.min_score` через `set_scheduler_options` (в трейте `ExerciseScheduler`, реализован и для `Trane`; в спайке не запускалось `[НЕ ПОДТВЕРЖДЕНО]`).

### Минимальное число правильных ответов для открытия зависимого урока (defaults: min_score 3.0, min_avg_trials 1.8)

Урок-зависимость `select` (3 упражнения), проверка «появился ли `where` в batch» после каждой попытки (`trane-spike minimal json`; `kb` даёт те же результаты):

```
q1 x1 Five                                        -> НЕ открылся (select score=1.5)
q1..q3 x1 Five (3 trials)                         -> НЕ открылся (score 4.23, но avg trials=1.0)
q1 x6 Five (одно и то же упражнение)              -> НЕ открылся (score 1.67)
q1,q2 x2 Five (4 trials, q3 не тронут)            -> НЕ открылся (score 3.18)
q1 x3, q2 x2 Five (5 trials, q3 не тронут)        -> НЕ открылся (score 3.23)
q1,q2 x3 Five (6 trials, q3 не тронут)            -> ОТКРЫЛСЯ после 6 (score 3.33)
q1,q2,q3 x2 Five (6 trials)                       -> ОТКРЫЛСЯ после 6 (score 4.71)
q1,q2,q3 x2 Four (6 trials)                       -> ОТКРЫЛСЯ после 6 (score 3.66)
q1,q2,q3 x2 Three (6 / 9 trials)                  -> НЕ открылся (score 2.54–2.88, даже в ту же секунду)
q1,q2,q3 x2 Two                                   -> НЕ открылся (score 1.81)
```
Вывод: для урока из N упражнений нужно **≥ ceil(1.8·N) попыток суммарно** (N=3 → 6; 5 не хватило — `get_lesson_num_trials` считает среднее по упражнениям, у непопробованных 0 trials), **и** средний по уроку score ≥ 3.0 при том, что непопробованные упражнения входят в среднее как 0. При оценках `Four/Five` минимум = **6 верных ответов** на урок из 3 упражнений (наблюдалось: 2 упражнения по 3 раза Five при нетронутом третьем → 3.33; то есть можно не трогать одно упражнение, но с Four средний score урока (÷3 с нулём) ниже 3.0 — это не проверялось `[НЕ ПОДТВЕРЖДЕНО]`). Один правильный ответ никогда не открывает зависимое; `Three` никогда не хватает.

## 4. Кастомная check-спека в упражнении

Frontmatter `check: {runner: sql, fixture: ..., expected: ..., timeout_ms: 2000}` записан в:
- JSON: `BasicAsset::MarkdownAsset` (`q1.md`, `q2.md`) и `BasicAsset::InlinedAsset` (`q3`, спека в строке `content`);
- KB: `qN.front.md` (`FlashcardAsset.front_path`).

Trane загружает файл как есть (содержимое ассета не парсится). Вывод `assets json` / `assets kb`:
```
join::q1: BasicAsset::MarkdownAsset path=sql_json/join/q1/q1.md
    check.runner=String("sql") check.fixture=String("fixtures/join.sql") first-line-of-file="---"
join::q3: BasicAsset::InlinedAsset (183 bytes)
    check.runner=String("sql") check.fixture=String("fixtures/join.sql") first-line-of-file="---"
join::q1: FlashcardAsset front=sql_kb/join.lesson/q1.front.md back=None
    check.runner=String("sql") check.fixture=String("fixtures/join.sql") first-line-of-file="---"
```
Спека читается обратно: из `ExerciseManifest` берём путь ассета (`exercise_asset`) (или `content` для inline), читаем файл (путь **относительно корня библиотеки**, не каталога манифеста) и парсим YAML сами (`serde_yaml` у нас). Метаданных в `ExerciseManifest` нет — спека доступна только через файл ассета.

Неизвестные JSON-ключи (`trane-spike unknown`):
```
extra key `check` in exercise_manifest.json     -> OK (loaded; extra key survives in returned ExerciseManifest JSON: false)
extra key `check` in lesson_manifest.json       -> OK (... false)
extra key `x_custom` in course_manifest.json    -> OK (... false)
extra key inside BasicAsset::MarkdownAsset      -> OK (... false)
unknown asset enum variant `SqlAsset`           -> ERROR: cannot parse manifest file ...: unknown variant `SqlAsset`, expected one of `BasicAsset`, `FlashcardAsset`, `InlineFlashcardAsset`, `LiteracyAsset`, `SoundSliceAsset`, `TranscriptionAsset`
```
Итого: неизвестные **поля** в манифестах молча игнорируются и **теряются** (serde без `deny_unknown_fields`; в возвращаемом манифесте их нет) — хранить `check` в JSON-манифесте бессмысленно. Неизвестный **вариант** enum `exercise_asset` — ошибка, поэтому `SqlAsset` без форка невозможен. Рабочий путь: check-спека в frontmatter Markdown-ассета (F1/F5 можно строить без форка). Побочная проверка: `metadata` есть только у Course/Lesson (`data.rs:359-560`), у упражнений нет.

## 5. Encompassing / reward propagation

Сценарий (`trane-spike encompass json <Base>`): 3 дня оцениваем все упражнения `select/where/aggregate` баллом Base, затем 3 упражнения `join` → `Five`, потом `join` → `One`, затем `where` → `One`.

Unit scores (`get_unit_score`) — реально меняются:
```
Base=Four: BEFORE join: select=4.74 where=4.38 aggregate=4.38
           AFTER join x3 Five: select=4.82 where=4.78 aggregate=5.00 join=5.00   (exercise-level: where 4.38->4.78, aggregate 4.38->5.00)
Base=Two : BEFORE join: select=2.06 where=1.60 aggregate=1.60
           AFTER join x3 Five: select=2.06 where=1.74 aggregate=1.94 join=5.00
Base=Three: select 3.19->3.91, where 2.92->3.03, aggregate 2.92->3.21
```
Вес влияет: `aggregate` (вес 1.0 по умолчанию) выросла на +0.34…+0.62, `where` (вес 0.5) — на +0.14…+0.40. Исходники (`reward_propagator.rs`): начальные награды `Five +0.8, Four +0.4, Three -0.3, Two -0.5, One -1.0`; положительная награда идёт вниз к encompassed с `edge_weight`, ×0.9 и вес ×0.8 на каждом шаге; отрицательная — **вверх** к encompassed_by; распространение останавливается при `|reward| < 0.2` или `weight < 0.2`. Отсюда: `Four` (+0.4) через ребро 0.5 = 0.2 — на границе. Транзитивная награда до `select` в Base=Two не дошла (select=2.06 без изменений), в Base=Three/Four дошла — механика зависит от контекста; точная причина не изолирована `[НЕ ПОДТВЕРЖДЕНО]`.
- Отрицательная награда: `join` → `One` после `Five` дал `join=2.99` (он сам), `where/aggregate/select` не изменились. Проверка «провал `where` → падает ли `join`» (`where` → `One` после `join`): `where` 4.78→3.64 (Base=Four), `join` осталась 2.99 — **`join`-score не упал**. `[НЕ ПОДТВЕРЖДЕНО]` почему; по коду отрицательные награды идут к `encompassed_by`, но эффекта на `join` не наблюдалось.

Выпадение упражнений из batch (review knocker): **в нашем малом курсе knocker не срабатывает**. Пороги в `review_knocker.rs`: удаляются только упражнения со score ≥ 4.5 и суммарным encompassed-весом ≥ 10.0 (very highly), «highly» — score ≥ 3.75 и вес ≥ 5.0; в графе из 7 уроков веса не достигают этих порогов. Наблюдаемое падение частоты (Base=Three: `where` 60→20 упражнений на 20 batch после `join`=Five) объясняется не knocker’ом, а `select_candidates` (для avg ≥ `min_score`=3.0 берётся ~50% упражнений урока: `where` пересёк 3.0 при 2.92→3.03) — контролем служит Base=Two, где частота осталась ≈ той же (`where` 34→33). Т.е. **эффект encompassing на состав batch в малом курсе — только через unit score/окна, а не через knockout**.

## 6. Производительность (release, синтетический курс)

Курс: 1500 уроков x 3 упражнения = 4500 упражнений, ≈3 зависимости на урок (DAG: зависимости только от уроков в пределах 50-блока, корень каждого 50-го урока → 30 корней), один course, 10 507 файлов на диске, 41 МБ (`du -sh`). Вывод `bench 1500`:

```
generated 1500 lessons x 3 ex ~3 deps in 738 ms
open (Trane::new_local): 168 ms  RSS 23 MB (before 7 MB)
get_exercise_batch cold-start (nothing scored): [(2.28ms,7),(126µs,7),(118µs,7),(116µs,7),(113µs,7)]
  day 0..29: batch 7 -> 46 упражнений, latency 1.9 ms -> 8.3 ms, RSS 24 MB   (за 30 дней оценено 820 упражнений)
saturate: 9000 score_exercise calls in 223 ms (24.8 µs/call), RSS 26 MB
get_exercise_batch with everything mastered (full graph): [(48.0ms,50),(4.4ms,50),(4.3ms,50),(4.5ms,50),(4.4ms,50)]
re-open with 4500 scored exercises in .trane: 169 ms, RSS 28 MB
first batch after re-open: 52 ms (50 ex)
.trane dir size: 1636 KB
```
Итого: open ≈ 0.17 с, batch — единицы миллисекунд (до ~50 мс при первом вызове на полностью освоенном графе, затем ~4 мс), RSS ≈ 24–28 МБ. Масштаб 1500 уроков не проблема. Ограничение синтетики: один course, случайные зависимости в блоке 50; реальные структуры (много курсов, глубокие цепочки) не измерялись. RSS — через `ps -o rss`.

---

## Дополнительно (влияет на F2 и F7)

**F2 — что валидирует Trane при открытии** (`trane-spike validate`):
```
cycle a->b->c->a          -> ERROR: ... cycle in dependency graph detected: c::a -> c::c -> c::b -> c::a
self-dependency           -> ERROR: unit c::a cannot depend on itself
missing dependency        -> accepted silently
encompassed weight 1.5    -> ERROR: ... weights within the range [0.0, 1.0]
redundant edge (c->a,b)   -> accepted silently   (транзитивная редукция не проверяется)
```
Циклы (с путём), self-dep и диапазон весов Trane даёт «бесплатно»; отсутствующие зависимости, транзитивная редукция, «у упражнения есть check», гранулярность — придётся писать самим (компилятор поверх манифестов).

**F7 — учебное состояние**:
- `Trane::new_local(working_dir, library_root)` кладёт `.trane/` **внутрь** каталога библиотеки (`lib_json/.trane`: `blacklist.db, practice_deltas.db, practice_rewards.db, practice_stats.db, review_list.db, filters/, study_sessions/, user_preferences.json`). Это можно развести: `Trane::new_local_with_vfs(state_dir, &VfsPath)` — курсы читаются из VFS, состояние в `state_dir/.trane` (проверено: `split`). Требует прямой зависимости на `vfs`.
- SQLite в WAL-режиме (при работе видны `*.db-wal`, `*.db-shm`) — файлы `.db` синхронизировать нельзя.
- **Производное состояние зависит от порядка поступления, не только от множества trial’ов.** `replay`: одни и те же 60 trial’ов, 2 «устройства», случайные ts за 10 дней; те же ts, разный порядок вызова `score_exercise`:
```
sorted by ts      : select=2.51 where=2.39 aggregate=3.16 join=2.97
sorted again      : select=2.51 where=2.39 aggregate=3.16 join=2.97   (детерминированно)
A-log then B-log  : select=2.47 where=2.22 aggregate=3.14 join=2.94
reverse ts order  : select=2.36 where=2.23 aggregate=3.03 join=2.63
```
Причина (по коду `scheduler.rs:1104-1160`): `score_exercise` при записи считает `delta` от текущего score и пишет rewards/deltas в БД (материализуются в момент записи). Следовательно, идея «append-only лог + union + пересчёт» работает, если пересчёт = **пересоздать `.trane` и проиграть объединённый лог отсортированным по (ts, id)** — тогда результат воспроизводим. Инкрементально дописывать чужие события «в прошлое» нельзя (даёт другой результат).

## Список API friction points

1. `MasteryScore` не `Copy` (только `Clone`) — `.clone()` всюду.
2. `override_current_timestamp` требует `&mut Trane`; нет чтения «текущего времени». Стенд/тесты времени — только через этот метод; `score_exercise` принимает `timestamp: i64` явно (хорошо для replay).
3. Нет публичного API «какие уроки сейчас на frontier/разблокированы»: можно только вывести из batch (случайная выборка, размер ограничен окнами) или дублировать логику `passes_threshold`/`get_avg_trials` (они `pub(super)`/private: `unit_scorer.rs:596,684` `pub(super)`). Для F3/F4 (диагностика, «новые темы на frontier») понадобится собственный расчёт по `get_unit_score` + графу или форк/PR.
4. `get_avg_trials`/число trial’ов упражнения не доступны публично, а именно `avg_trials ≥ 1.8` определяет разблокировку. Число попыток нужно вести самим (наш лог).
5. `PassingScoreOptions.min_fraction` — только для `select_candidates` (доля упражнений при avg ≥ min_score), а не для gating; gating = `min_score` + `min_avg_trials` (`passes_threshold`).
6. Упражнения в KB — только `FlashcardAsset`; `ExerciseAsset` — закрытый enum, `SqlAsset` невозможен без форка. Обход: frontmatter в Markdown (проверено).
7. Неизвестные поля манифеста молча теряются (нет `deny_unknown_fields`) — опечатки в ключах не ловятся; кастомные поля хранить в JSON нельзя.
8. `ExerciseManifest` не содержит `metadata`; `metadata` только у Course/Lesson — фильтровать упражнения по метаданным упражнения нельзя.
9. Пути ассетов в возвращённых манифестах нормализованы относительно корня библиотеки (нужно знать корень; при `new_local_with_vfs` — корень VFS).
10. Валидатор Trane не ловит отсутствующие зависимости (`missing dependency -> accepted silently`) и транзитивно-избыточные рёбра; сообщения об ошибках дублируют текст (`...: <same message>`), но путь цикла присутствует.
11. Learner state внутри каталога курса по умолчанию (`.trane` в `library_root`); для разделения курса и состояния нужен `new_local_with_vfs` + прямая зависимость на `vfs`.
12. Порядок-зависимое производное состояние (см. F7) — для sync нужен полный replay.
13. Форк Trane не потребовался ни для одного из 6 пунктов; все пункты собрались на публичном API v0.34.1 (`Trane`, `ExerciseScheduler`, `CourseLibrary`, `data::*` — все публичны). Экспорты `trane::course_library::CourseLibrary::{get_all_exercise_ids,get_exercise_manifest}` реализованы для `Trane` и доступны.
14. `trane` как crates.io-зависимость не проверялась (использован path к клону v0.34.1) `[НЕ ПОДТВЕРЖДЕНО]`.
15. Сборка: 35 с холодная release; `target/` ≈ 304 МБ (удалён после прогона; `trane-src/.git` удалён).

## Что осталось неподтверждённым

- Причина «мигания» gating при оценке `Three` — гипотеза о time decay согласуется с наблюдением, но decay-функция отдельно не измерялась.
- Почему транзитивная награда до `select` не дошла при Base=Two и почему отрицательная награда от `where` не понизила `join` — не изолировано.
- Влияние `set_scheduler_options(min_score…)` на gating не запускалось.
- Производительность на реальной структуре (много курсов, глубина) не измерялась; синтетика — один course.
