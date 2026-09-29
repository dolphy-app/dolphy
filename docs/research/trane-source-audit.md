# Аудит исходников Trane v0.34.1 (для роли scheduling engine)

Источник: `git clone --depth 1 --branch v0.34.1` в `/tmp/trane-audit` (HEAD `6f5f84a`, 2026-09-11). Пути `file:line` — относительно корня репозитория. Ничего не компилировалось и не запускалось: всё ниже получено чтением кода и запросами к GitHub API. То, что не проверялось, помечено `[НЕ ПОДТВЕРЖДЕНО]`.

---

## A. STATE / SYNC

### A.1 Файлы и схемы
Пять отдельных SQLite-файлов в `<library_root>/.trane/` (`src/lib.rs:107-122`; открываются в `new_local_helper`, `src/lib.rs:243-260`). Соединение открывается с `journal_mode=WAL`, `synchronous=OFF` (`src/utils.rs:19-22`).

| Файл | Схема (миграции) | Ключ уникальности |
|---|---|---|
| `practice_stats.db` | `uids(unit_uid INTEGER PK, unit_id TEXT NOT NULL UNIQUE)`; `practice_stats(id INTEGER PK, unit_uid NOT NULL REFERENCES uids, score REAL, timestamp INTEGER)`; индекс `trials(unit_uid, timestamp)` (`src/practice_stats.rs:49-81`) | **нет**. Только суррогатный `id` autoincrement. Дубль `(unit,score,ts)` вставится второй строкой |
| `practice_rewards.db` | `uids`; `practice_rewards(id PK, unit_uid, reward REAL, weight REAL, timestamp INTEGER)`; индекс `(unit_uid, timestamp)` (`src/practice_rewards.rs:106-130`) | **нет** |
| `practice_deltas.db` | `uids`; `practice_deltas(id PK, unit_uid, delta REAL, timestamp INTEGER)`; индекс `(unit_uid, timestamp)` (`src/practice_deltas.rs:49-66`) | **нет** |
| `blacklist.db` | `blacklist(unit_id TEXT NOT NULL UNIQUE)` (`src/blacklist.rs:48-59`) | `unit_id` |
| `review_list.db` | `review_list(unit_id TEXT NOT NULL UNIQUE)` (`src/review_list.rs:36-47`) | `unit_id` |

Замечания:
- `uids.unit_uid` — локальный числовой суррогат, назначается по порядку первой вставки → **у двух устройств `unit_uid` для одного `unit_id` разные**. Слияние файлов на уровне SQL по `unit_uid` некорректно, нужно джойнить по `uids.unit_id`.
- Разрешение времени: `timestamp` — `i64` секунды (`ExerciseTrial.timestamp: i64`, `src/data.rs:103-112`; `Utc::now().timestamp()` в `src/scheduler/unit_scorer.rs:107-111`). Два события одного упражнения в одну секунду неразличимы по времени.
- Поля device id / event id / uuid **отсутствуют** (`grep -ri "device\|event_id\|uuid" src` — пусто по коду хранения).
- `score REAL` — `f32` от `MasteryScore::float_score()` (1.0..5.0), то есть оценка 1-5 сохраняется как float.

### A.2 Путь записи (что первично, что производно)
`ExerciseScheduler::score_exercise(exercise_id, score: MasteryScore, timestamp: i64)` (`src/scheduler.rs:65-70`, реализация `src/scheduler.rs:1104-1163`) делает по порядку:
1. Читает текущий `existing_score = unit_scorer.get_unit_score(exercise_id)` и `num_trials` (`:1112-1121`). Если `num_trials > 0` — пишет **delta** = `score.float_score() - existing_score` в `practice_deltas` (`:1122-1133`). При первой попытке delta не пишется.
2. Пишет **trial** в `practice_stats` (`:1137-1145`).
3. Инвалидирует кэш, обновляет **in-memory** `relearn_pile` (1/2 → добавить, 3-5 → убрать; `src/scheduler/relearn_pile.rs`, не персистится) и success rate (`:1146-1148`).
4. `reward_propagator.propagate_rewards(...)` → `practice_rewards.record_unit_rewards(...)` (`:1150-1158`).

Итог: **первичное событие — только `practice_stats`** (exercise_id, score, timestamp). `practice_deltas` и `practice_rewards` — побочные эффекты `score_exercise`, вычисленные в момент записи от состояния графа и текущих оценок. `blacklist` и `review_list` — наборы (set) без истории.

### A.3 Можно ли пересчитать rewards/deltas из одних stats?
- **Кода перестройки (rebuild/replay) нет**: в `src/` ни одной функции, которая читает `practice_stats` и восстанавливает `practice_rewards`/`practice_deltas`. Единственные "массовые" операции — `trim_*` и `remove_*_with_prefix` (трейты `PracticeStats/Rewards/Deltas`).
- **Трейты записи публичны**: `PracticeStats::record_exercise_scores(&[ExerciseTrial])`, `PracticeRewards::record_unit_rewards(&[UnitReward])`, `PracticeDeltas::record_exercise_deltas(&[ExerciseDelta])` (`src/practice_stats.rs:28`, `src/practice_rewards.rs:37`, `src/practice_deltas.rs:28`), и реализованы на самом `Trane` (`src/lib.rs:522-609`). То есть **импортировать** события можно через публичный API без SQL: вызвать `score_exercise(id, score, ts)` для каждого события в порядке возрастания времени — это полный "replay" (deltas и rewards пересоздаются сами).
- **Детерминизм replay — под вопросом**: `score_exercise` считает `existing_score` через `unit_scorer.get_unit_score`, а тот использует `now()` = `override_timestamp` либо `Utc::now()` (`src/scheduler/unit_scorer.rs:107-111`), **а не** параметр `timestamp` (`src/scheduler.rs:1112-1116`). Значит при replay старых событий delta зависит от текущих часов, если не вызывать `override_current_timestamp(Some(ts))` (публично: `src/scheduler.rs:101-103`, реализовано на `Trane`, `src/lib.rs:505`) перед каждым событием. Также кэш оценок валиден до 2 часов (`MAX_CACHE_AGE`, `unit_scorer.rs:22-23`) — при replay с override нужно инвалидировать (`score_exercise` делает это сам для упражнения). `[НЕ ПОДТВЕРЖДЕНО]` — сам replay с override не запускался.
- Дедуп rewards: `RewardCache` в памяти (10 записей на unit, `src/practice_rewards.rs:57-93`) пропускает "похожий" reward (то же value, |Δt|<1 день, |Δweight|<0.1) и хранение обрезается до 20 записей на unit (`:215-222`). Это не идемпотентный ключ, а эвристика, и кэш пуст после перезапуска процесса (создаётся в `LocalPracticeRewards::new`, `:144-153`).
- Вывод по F7 (union по логу событий + пересчёт производного): **идея реализуема**, если хранить свой append-only лог `(event_id, device_id, exercise_id, mastery 1..5, ts)`, а Trane-БД считать кэшем: при изменении лога удалять `.trane/practice_*.db` и проигрывать лог через `score_exercise` в порядке `(ts, event_id)` с `override_current_timestamp`. Прямое слияние SQLite-файлов Trane непригодно (нет ключей, разные `unit_uid`, хранение обрезается `trim`, rewards/deltas зависят от порядка).
- `trim_scores(n)` / `trim_rewards` / `trim_deltas` — деструктивны (`DELETE ... NOT IN (... LIMIT n)` + `VACUUM`, `src/practice_stats.rs:162-184`); сама Trane их вызывает только по запросу пользователя API (`src/lib.rs:540-601`). Scorer читает по `num_trials=20`, `num_deltas=10`, `num_rewards=10` (`src/data.rs:1073-1076`), но ничего не удаляет автоматически, кроме rewards (20 на unit, `:219`).
- Блеклист: `add_to_blacklist_helper` делает голый `INSERT` (не `OR IGNORE`), защищаясь кэшем (`src/blacklist.rs:107-121`) — два процесса на одной БД могут получить UNIQUE-ошибку. `review_list` использует `INSERT OR IGNORE` (`src/review_list.rs:79`).

### A.4 Миграции и хрупкость экспортёра
Все БД управляются `rusqlite_migration` (`M::up/down`, `to_latest`): у stats 6 миграций, в т.ч. пара, создающая и тут же удаляющая индекс `unit_scores` — комментарий явно говорит, что миграции нельзя убирать, иначе сломаются БД старых версий (`src/practice_stats.rs:66-75`). Версия схемы хранится в `PRAGMA user_version` (это поведение `rusqlite_migration` `[НЕ ПОДТВЕРЖДЕНО]` по исходникам этой библиотеки, в репозитории Trane не проверялось). Схема за последние релизы менялась (индексы, рефакторы `Batch DB updates`, PR #426). Внешний SQL-экспортёр, читающий `.db` напрямую, хрупок; безопасный путь — публичные трейты (`get_scores`, `get_rewards`, `get_deltas`, `get_blacklist_entries`, `get_review_list_entries`).

**Fork needed? Нет** — для F7 с собственным логом достаточно публичного API (`score_exercise` + `override_current_timestamp`). Форк понадобился бы только для идемпотентной вставки событий с ключом внутри самой БД Trane; от этого можно отказаться (см. A.3).

---

## B. GRAPH API

- `Trane::get_unit_graph()` / трейт `CourseLibrary::get_unit_graph() -> Arc<RwLock<InMemoryUnitGraph>>` (`src/course_library.rs:67`); `Trane` сам реализует `UnitGraph` (`src/lib.rs:653-765`). Модуль `graph` публичный (`src/lib.rs:61`), `InMemoryUnitGraph` — `pub struct` с `Default` (`src/graph.rs:181-182`), значит внешний валидатор может даже строить граф без библиотеки.
- Читающие методы `UnitGraph` (`src/graph.rs:105-160`): `get_unit_type`, `get_course_lessons`, `get_starting_lessons`, `get_lesson_course`, `get_lesson_exercises`, `get_exercise_lesson`, `get_dependencies`, `get_dependents`, `get_dependency_sinks`, `get_encompasses` / `get_encompassed_by` (с весами `(Ustr, f32)`), `get_supersedes` / `get_superseded_by`, `check_cycles`, `generate_dot_graph`. Манифесты — `get_course_manifest`, `get_lesson_manifest`, `get_exercise_manifest`, `get_all_exercise_ids`, `get_matching_prefix` (`src/course_library.rs:38-60`).
- Нюанс: если авторы не заводили `encompassed`, граф encompassing **не хранится** (очищается `set_encompasing_equals_dependency`, `src/graph.rs:559-567`), а `get_encompasses` возвращает зависимости с весом 1.0 (`:659-666`). Внешний валидатор должен вызывать `encompasing_equals_dependency()`.
- **Циклы**: `check_cycles` проверяет 3 графа (dependency, superseded, encompassed) и **выводит путь цикла** в тексте ошибки: `"cycle in dependency graph detected: a -> b -> ... -> a"` (`src/graph.rs:411-459`, форматирование `:439-449`; сообщения `:480`, `:497`). Ошибка — `UnitGraphError::CheckCycles(anyhow::Error)` (`src/error.rs:157`), путь только строкой (не структурой). Вызывается при открытии библиотеки (`src/course_library.rs:417`). Полнота DFS (visited-при-pop + путь в стеке) не проверялась на контрпримерах `[НЕ ПОДТВЕРЖДЕНО]`; тест на цикл лишь проверяет `is_err` (`src/graph.rs:1213-1234`). Достаточно ли одного пути (первого найденного) — да, других циклов не перечисляет.
- Проверки при открытии помимо циклов: непустой `id`; согласованность `lesson_id`/`course_id` в манифестах; существование asset-путей (`src/course_library.rs:194-297`); упражнение не может иметь зависимости, unit не может зависеть от себя, unit должен быть добавлен до `add_dependencies` (`src/graph.rs:327-347`); веса encompassed в `[0.0, 1.0]` (`:376-381`); дубль id курса/урока (`:266-…`); конфликт типа unit (`:257-272`); согласованность прямого и обратного графов (`check_reverse`, `:471-479`).
- **Зависимость на несуществующий unit — НЕ ошибка**: такой id попадает в `dependency_sinks` как "sink" (`src/graph.rs:226-252`, комментарий `:239-243`, доккомментарий `:136-144`); `get_unit_type(missing)` вернёт `None`. Внешний валидатор находит опечатки так: для каждой зависимости `get_unit_type(dep).is_none()`.
- **Ссылки `encompassed` на несуществующие units** — тоже не проверяются (в `add_encompassed_helper`, `src/graph.rs:370-410`, есть только проверка диапазона весов). `[НЕ ПОДТВЕРЖДЕНО]` для нижней части функции после строки 410, но `ensure!` на существование отсутствует в видимой части.
- **Транзитивная редукция / избыточные зависимости**: **не обнаружено** ни в коде, ни в `grep -i "redundan|transitive"` (только комментарий про лесson↔course и `redundancy` в стоимости кандидата, `src/scheduler/filter.rs:36`). Внешний валидатор пишется поверх `get_dependencies` (BFS по графу; сложность — стандартная).
- Проверки granularity, orphan, "у каждого упражнения есть исполняемая проверка" в Trane нет (у `ExerciseManifest` нет поля для проверки, см. E).
- Неявная зависимость урока от курса: lesson без зависимостей неявно зависит от курса (`src/graph.rs:136-139`, `:234-241`) — учитывать при построении редукции.

**Fork needed? Нет** для F2 (валидатор — внешний код на `UnitGraph` + манифестах). Часть проверок (существование ссылок) Trane не делает — реализуются снаружи.

---

## C. SCORING / SCHEDULER

### C.1 Потребление MasteryScore
`enum MasteryScore {One..Five}` (`src/data.rs:25-56`), `float_score()` 1.0..5.0 (`:61-69`). `score_exercise` принимает его напрямую (`src/scheduler.rs:65-70`). Внутри: (1) float в `practice_stats`; (2) `initial_reward`: Five 0.8, Four 0.4, Three −0.3, Two −0.5, One −1.0 (`src/scheduler/reward_propagator.rs:63-71`); (3) relearn pile: One/Two → в пилу, Three+ → из пилы (`src/scheduler/relearn_pile.rs`). Runner→MasteryScore — ответственность интегратора (F5 реализуем: `score_exercise(id, MasteryScore::…, ts)` публичен).

### C.2 Агрегат lesson/course (формула, которую ты пометил непроверенной)
- **Exercise**: `PowerLawScorer::score(exercise_type, trials, deltas, now)` (`src/exercise_scorer.rs:443-498`) — пустая история → value 0.0, urgency 1.0; иначе `clamp(effective_retrievability * weighted_score + delta, 0, 5)`. Читает до `num_trials=20` попыток **и до `num_deltas=10` дельт** (значит scorer — не «чистый replay последних 20 trials», он также зависит от `practice_deltas` и `now`; см. `src/scheduler/unit_scorer.rs:192-255`).
  Затем **rewards**: если `scores.len() >= MIN_TRIALS_FOR_REWARD (3)`, берутся rewards урока и курса (`num_rewards=10`), `WeightedRewardScorer::score_rewards` (`src/reward_scorer.rs`): период полураспада 14 дней, `MIN_EFFECTIVE_WEIGHT 0.05`, смесь `course 0.3 / lesson 0.7`; и **прибавляются к оценке упражнения**: `final = clamp(score + reward, 0, 5)` если `apply_reward` (`unit_scorer.rs:255-283`, `reward_scorer.rs` `apply_reward`: не применять положительный reward при среднем последних 3 < 3.0 за <7 дней, и не применять отрицательный при среднем >3.5 за <7 дней).
- **Lesson** = **простое среднее** оценок упражнений (невалидные/blacklisted исключены; упражнения без попыток имеют оценку 0.0 и **входят** в среднее): `scores.iter().sum() / scores.len()` (`unit_scorer.rs:430-507`, формула `:487-…`). Rewards отдельно к оценке урока не применяются — они уже вошли в оценки упражнений.
- **Course** = **простое среднее** оценок уроков курса (`unit_scorer.rs:509-577`, `avg_score = sum / len`).
- Blacklisted и superseded (при score superseding ≥ `superseding_score=4.0`) unit → `Ok(None)` — «нет оценки», и **считается выполненной зависимостью** (`unit_scorer.rs:575-580` doc; `src/scheduler.rs:540-563`).
- Кэш оценок: 2 часа (`unit_scorer.rs:22-24`).

### C.3 dead_end, min_avg_trials, min_fraction
`PassingScoreOptions` по умолчанию `min_score 3.0, min_fraction 0.5, min_avg_trials 1.8` (`src/data.rs:860-868`).
- **Переход к зависимым** (`passes_threshold`, `src/scheduler.rs:521-531`): урок «проходит», если `avg_score >= min_score && avg_trials >= min_avg_trials`; если значения недоступны (нет кандидатов/blacklist) — считается пройденным.
- Если не проходит → все кандидаты урока помечаются `dead_end = true`, путь дальше не идёт (обход зависимых пропущен), стек перемешивается (`:828-862`, `:844`). `dead_end` затем повышает вес/понижает cost кандидата в `CandidateFilter` (`src/scheduler/filter.rs:112`, тесты `:563-…`).
- `min_fraction` (`select_candidates`, `src/scheduler.rs:315-345`): для уроков со score в `[min_score, 5)` в батч берётся доля упражнений от `min_fraction` (при score = min_score) до 1.0 (при 5.0), линейно, минимум 1. Ниже `min_score` или ≥5.0 — все кандидаты.
- `min_avg_trials` защищает от «прошёл с одной попытки»: при 1.8 нужно ≈2 попытки на упражнение в среднем.
- Другие лимиты: `batch_size=50`, `relearn_fraction=0.1`, `max_lessons_in_progress=10`, окна мастерства new/target/current/easy/mastered 20/20/30/20/10% по диапазонам (0–0.1, 0.1–2.5, 2.5–3.75, 3.75–4.5, 4.5–5.0) (`src/data.rs:1046-1081`).

### C.4 Можно ли получить frontier / due по отдельности?
- **Публичного API нет.** `ExerciseScheduler` содержит только `get_exercise_batch`, `score_exercise`, `get_unit_score`, `invalidate_*`, опции (`src/scheduler.rs:52-104`). Тип `Candidate` и поля `dead_end/urgency` — приватные (`src/scheduler.rs:120-158` без `pub`); `get_avg_trials` — `pub(super)` (`unit_scorer.rs:684`). `get_exercise_batch` возвращает только `Vec<ExerciseManifest>` (`:1055-1101`), где новые и повторения смешаны по окнам мастерства.
- Обходной путь без форка: `get_unit_score(unit)` публичен для course/lesson/exercise (возвращает `Option<f32>`), `get_scores(exercise, n)` даёт число попыток, `get_dependencies/dependents` — граф. Значит **frontier** (все зависимости с avg≥min_score и avg_trials≥min_avg_trials, сам урок без попыток) вычисляется снаружи (~100–200 LOC, повторяя `passes_threshold`); **due** — по `urgency = 1 − retrievability`, но она приватна (`CachedScore.urgency`, `unit_scorer.rs:37-46`; `get_exercise_urgency` — `pub(super)`) → нужен собственный расчёт или доступ через форк.
- Фильтры (`ExerciseFilter::{UnitFilter, StudySession}`, `UnitFilter::{CourseFilter, LessonFilter, MetadataFilter, ReviewListFilter, Dependents, Dependencies}`, `src/data/filter.rs:203-233, 378-384`) позволяют сузить батч: `Dependents{unit_ids}` / `Dependencies{unit_ids}` пригодны для ремедиации (см. D) и для диагностики по поддереву.

### C.5 Диагностика / placement
`grep -rniE "diagnostic|placement"` по `src`, `README.md`, `improvement_plan.md` → **0 совпадений**. Placement-теста в Trane нет. Ближайшие механизмы: blacklist и superseding.

### C.6 Blacklist как «уже известно»
- Blacklisted unit → `get_unit_score = None`, считается **удовлетворённой зависимостью**, упражнения не планируются (`unit_scorer.rs:449-458`; `src/scheduler.rs:540-546`; `all_valid_exercises_in_lesson` возвращает пусто, `src/scheduler/data.rs:342-346`). Плюс: открывает дорогу к зависимым. Минус: такое знание **никогда не повторяется** (нет повторений/забывания) и не отличается от «не хочу учить»; blacklist — множество без времени/источника.
- Альтернатива для placement: записать синтетические попытки `Five` (≥2 на упражнение из-за `min_avg_trials=1.8`) через `score_exercise` — тогда unit выглядит освоенным, но будет подлежать обычному забыванию/повторению (**рекомендуется отличать от реальных событий в своём логе**).
- Кэш blacklist в памяти, инвалидируется самим `Trane` (`src/scheduler.rs:75-86`).

**Fork needed? Для F3/F4 (placement, раздельный список frontier/due) — нет для MVP** (можно считать снаружи), **да, если нужна точная согласованность с внутренней urgency/frontier** (тогда: сделать `Candidate`/`get_candidates_*` публичными, ~30–60 LOC форка `[оценка по коду]`).

---

## D. REMEDIATION

- Механизма «упражнение → ключевой prerequisite» **нет**: у `ExerciseManifest` нет зависимостей или метаданных (поля: `id, lesson_id, course_id, name, description, exercise_type, exercise_asset`, `src/data.rs:758-792`); зависимости имеют только Course и Lesson (`CourseManifest.dependencies` `src/data.rs:373-376`).
- **Направление negative reward** (документировано и подтверждено кодом): `src/scheduler/reward_propagator.rs:1-8` — «Good scores propagate a positive reward to the units encompassed by the exercise, that is to say down the graph. Bad scores propagate a negative reward to the units that encompass the exercise, that is to say up the graph». Код: `get_next_units(reward > 0)` → `get_encompasses(unit)` (то, что unit охватывает — по умолчанию его **зависимости/prerequisites**), иначе → `get_encompassed_by(unit)` (кто охватывает unit — по умолчанию его **dependents**) (`:75-80`). Так как по умолчанию encompassed ≡ dependencies с весом 1.0 (`src/graph.rs:659-666`, doc `reward_propagator.rs:26-29`):
  - положительный reward идёт **к prerequisites** (хорошее выполнение продвинутого = повторение базового);
  - отрицательный reward идёт **к dependents** (провал базового снижает уверенность в зависящих от него), **не** к prerequisites.
  Затухание: `WEIGHT_FACTOR 0.8`, `REWARD_FACTOR 0.9`, порог остановки `|reward|<0.2` или `weight<0.2` (`:46-58`). Rewards записываются на уровне lesson/course, а не упражнения.
- Итого: Trane **не** возвращает ученика к prerequisite после провала — наоборот, снижение оценки dependents. Следовательно F6 «дважды провалил → назначить prerequisite» в Trane отсутствует.
- Что нужно для F6 (без форка): своя надстройка над публичным API — (1) хранить в собственном лог-слое `упражнение → key_prerequisites` (метаданные вашего Markdown-формата, не в Trane); (2) считать подряд идущие провалы (`get_scores(id, 2)` оба ≤ 2.0, либо ваш лог); (3) вызывать `get_exercise_batch(Some(ExerciseFilter::UnitFilter(UnitFilter::LessonFilter{lesson_ids: [prereq]})))` или `UnitFilter::Dependencies{unit_ids:[failed_lesson]}` (`src/data/filter.rs:225-233`) для выдачи материала prerequisite; (4) при желании добавить `add_to_review_list(unit)` + `ReviewListFilter` (`src/review_list.rs`, `src/scheduler.rs:922-1001`). ≈ 80–150 LOC внешнего кода. Форк нужен лишь чтобы отрицательный reward шёл к prerequisites (изменить `get_next_units`, 1-3 LOC, но это ломает семантику FIRe и тесты `reward_propagator.rs`).

**Fork needed? Нет** (надстройка через `LessonFilter`/`Dependencies` фильтр и внешние метаданные упражнения).

---

## E. EXTENSIBILITY

| Точка | Тип | Оценка |
|---|---|---|
| `ExerciseScorer` (`src/exercise_scorer.rs:15-26`) | публичный трейт, **но зашит**: `exercise_scorer: Box::new(PowerLawScorer {})` в `UnitScorer::new` (`src/scheduler/unit_scorer.rs:95`), `UnitScorer` — приватный (`pub(super)`), параметров подмены нет | Замена (FSRS через fsrs-rs): **fork yes**. Изменение: добавить в `SchedulerData`/`DepthFirstScheduler::new` поле `Box<dyn ExerciseScorer + Send + Sync>` и прокинуть в `UnitScorer::new` — ≈ 15-30 LOC + сам адаптер FSRS (внешний код ≈ 150-300 LOC; FSRS хранит состояние (stability/difficulty) — а трейт принимает только историю trials/deltas, так что адаптер должен пересчитывать состояние из ≤20 trials `[оценка]`) |
| `RewardScorer` (`src/reward_scorer.rs`) | публичный трейт, зашит `WeightedRewardScorer` (`unit_scorer.rs:96`) | fork для замены, ≈ 15 LOC |
| `PracticeStats/Rewards/Deltas/Blacklist/ReviewList/FilterManager/CourseLibrary/UnitGraph` | **`Arc<RwLock<dyn Trait>>` в публичном `SchedulerData`** (`src/scheduler/data.rs:26-60`, `pub mod data` `src/scheduler.rs:17`) | **Подмена без форка**: можно реализовать свои `PracticeStats` (например поверх собственного append-only лога) и собрать `DepthFirstScheduler::new(SchedulerData{…})` (`src/scheduler.rs:190-205`, `pub fn new`). Собственная сборка аналога `Trane::new_local_helper` (`src/lib.rs:243-305`, приватная функция) ≈ 60-80 LOC. Поля `SchedulerData.frequency_map/trial_counts` публичны, `Arc<RwLock<..>>` можно создать самому |
| `ExerciseScheduler` | публичный трейт; можно реализовать свой планировщик (например обёртку над `DepthFirstScheduler`) | без форка |
| `ExerciseAsset` (`src/data.rs:599-644`): `BasicAsset`, `FlashcardAsset`, `InlineFlashcardAsset`, `LiteracyAsset` | **закрытый `enum` с serde**, без `#[non_exhaustive]`/`Custom` | Новый вариант: fork yes. Ссылок на `ExerciseAsset::` вне тестов: 22 в `data.rs`, 4+8+3 в генераторах курсов, 1 в `course_builder.rs`, 1 в `course_library.rs` → добавление варианта (напр. `RunnerAsset{ runner, spec_path }`) ≈ 30-60 LOC (enum + `NormalizePaths`/`VerifyPaths` + match-места) |
| Метаданные/зависимости уровня exercise | `ExerciseManifest` — только поля `id..exercise_asset` (`src/data.rs:758-792`); `metadata` есть у `CourseManifest`/`LessonManifest` (`:411-419`) | Добавить `metadata: Option<BTreeMap<..>>` к exercise: fork yes ≈ 20-40 LOC (поле + фильтры метаданных в `src/data/filter.rs`, `scheduler/filter`). **Зависимости на уровне exercise** (граф до упражнения): fork yes, **крупно** — граф, скоринг, обход, reward-пропагация и кэш построены по course/lesson (`graph.rs:327-347` запрещает зависимости у упражнений) → сотни LOC, ломает архитектуру. Обходной путь без форка: одно упражнение = один lesson (или lesson-«атом»), зависимости на lesson-уровне; хранение runner-спецификации в **вашей** таблице по `exercise_id`, а Trane отдаёт только `BasicAsset` с путём к описанию |
| Multi-user | одна БД на каталог `.trane` в `library_root` (`src/lib.rs:243-260`), состояние per-instance; кэш и `relearn_pile`/`frequency_map` в памяти | без форка: один `Trane` (или своя сборка `SchedulerData` с собственными `PracticeStats`) **на пользователя** (свой `library_root`/`.trane` на пользователя или свои Local* через `new_from_disk(path)` — они `pub`, `src/practice_stats.rs:104`). Память: граф целиком в памяти на экземпляр (`graph.rs:178-180`: «<20 МБ на большую библиотеку») |
| Потокобезопасность | `unsafe impl Send/Sync for Trane` (`src/lib.rs:767-768`) — единственный `unsafe` в репозитории; внутри `UnitScorer` используются `RefCell` (`unit_scorer.rs:50-64`) | учитывать: `Trane` помечен Sync вручную, но кэши на `RefCell` → параллельные вызовы одного экземпляра небезопасны `[вывод из кода, не тестировалось]` |

**Fork needed? Yes для**: FSRS-скорера, нового `ExerciseAsset`, exercise-level metadata. **No для**: custom event source (через трейты + `SchedulerData`), multi-user (экземпляр на пользователя), F1–F2, F5–F7.

---

## F. Quality signals

- **Тесты**: 353 вхождения `#[test]` в `src` + `tests/` (`grep -rn "#\[test\]" src tests | wc -l`); `improvement_plan.md:145-147` сообщает `cargo test --offline --release --lib`: 297 passed (со слов самого файла, не запускалось мной). Интеграционные тесты: `tests/{basic,blacklist,large,metadata,generated_courses,superseded}_tests.rs` + тестовые библиотеки. Есть coverage-workflow (`.github/workflows/coverage.yaml`) и `#[cfg_attr(coverage, coverage(off))]` в коде.
- **CI**: `.github/workflows/build.yml` — `cargo nextest run --release` на stable, `cargo fmt --check`, `cargo clippy -- -D warnings` (на PR и push в master).
- **unsafe**: единственное — `unsafe impl Send/Sync for Trane` (`src/lib.rs:767-768`).
- **Edition/MSRV**: `edition = "2024"` (`Cargo.toml:4`); поля `rust-version` **нет** → MSRV не заявлен (edition 2024 требует ≥ Rust 1.85 — по спецификации языка). CI использует stable.
- **Зависимости** (`Cargo.toml`): `rusqlite 0.40.2` (bundled SQLite), `rusqlite_migration 2.6.0`, `rand 0.10.2`, `chrono 0.4.45`, `serde 1.0.229`, `thiserror 2.0.20`, `ustr 1.1.0`, `postcard 1.1.3`, `parking_lot 0.12.5`, `rayon 1.12.0`; версии свежие на момент релиза (PR #431 «Update version and dependencies», 2026-08-18). В зависимостях есть `clap` и `tempfile` (последний — обычная, не dev-зависимость). Лицензия AGPL-3.0-or-later (`Cargo.toml:6`) — подтверждена.
- **Релизы** (GitHub releases API): v0.30.0 2026-08-19, 0.31.0 08-31, 0.32.0 08-31, 0.33.0 09-01, 0.34.0 09-02, 0.34.1 09-11; ранее 0.29.0 2026-06-04, 0.28.0 03-18, 0.27.0 03-10, 0.26.x 02-2026, 0.25.0 01-2026; до этого 0.24.1 2025-09-11 … 0.22.0 2024-08-11. Каданс нерегулярный: пачки релизов при крупных рефакторингах, паузы по несколько месяцев. До 1.0 не дошли (0.x → semver-совместимость API не гарантирована). Всего ~632 коммита (Link header GitHub), 847 звёзд.
- **Issues**: GitHub API `issues?state=all` возвращает **0 не-PR issues** и `open_issues_count=0` — публичного issue-трекера с обсуждениями нет (либо отключён). Проект ведётся через PR: последние PR (#414–#442, март–сентябрь 2026) — упрощение скорера, «Adjust scores based on deltas» (#419), tuning констант (#421), review knocker (#422), performance (#423, #437), batch DB updates (#426), fix `max_lessons_in_progress` (#428), literacy-курсы (#429–433), виртуальная ФС (#435), дедуп кандидатов (#438), фиксы бенчмарка (#442). Темы: **активная переработка скорера/планировщика** — т.е. поведение меняется быстро от версии к версии.
- **`improvement_plan.md`** (156 строк, дата ревью 2026-09-05, ревизия `be41416`): самоаудит без новых изменений в коде. Таблица приоритетов: (1) буферизация JSON, (2) пропуск ненужных запросов оценок, (3) дедупликация exercise id в выборе кандидатов, (4) истечение кэша оценок + выравнивание часов, (5) удаление лишних индексов/проверок ФС — всё помечено DONE; (6) эксперимент «Verify Selected Coverage» — контрпример: review knocker вычисляет покрытие от начального пула, а не от итогового батча, поэтому упражнение может быть вырезано без выбранного покрывающего (это **не исправлено**, эффект на обучение не доказан). «Validation cautions»: (a) `set_scheduler_options` обновляет только верхнеуровневые `SchedulerData`, а компоненты держат клонированные опции (`src/scheduler.rs:1183` в момент ревью; **в v0.34.1 то же**: `set_scheduler_options` меняет `self.data.options`, `unit_scorer`/`relearn_pile` не обновляются) — рантайм-смена опций может не доходить до компонентов; (b) бенчмарк `days_to_mastery` симулирует оценки фиксированной вероятностью лапса, не реальным забыванием — не подходит как независимое доказательство качества. Упоминает, что удалены `FSRS_PLAN.md` и др. — то есть FSRS-скорер рассматривался и **не реализован**.

---

## Сводка «fork needed?»

| Возможность | Форк? | Почему |
|---|---|---|
| F1 Markdown-курсы | нет | Trane принимает манифесты JSON/файлы; Markdown→манифесты — внешний компилятор |
| F2 валидатор | нет | `UnitGraph`/манифесты публичны; редукции, orphan, ссылки на несуществующее — писать снаружи (Trane не проверяет) |
| F3 placement | нет для MVP | В Trane отсутствует; blacklist или синтетические `Five` (≥2 попытки) |
| F4 план дня | частично | frontier/due не раздельны и приватны; рассчитывать снаружи (или ~30-60 LOC форка для доступа) |
| F5 runner→MasteryScore | нет | `score_exercise` публичен; runner-спека — во внешней таблице по `exercise_id` |
| F6 ремедиация | нет | Механизма нет; надстройка на фильтрах `LessonFilter`/`Dependencies` и внешних метаданных. Negative reward идёт к **dependents**, не к prerequisites |
| F7 sync | нет | Собственный лог + replay через `score_exercise` с `override_current_timestamp`; БД Trane — кэш, а не источник истины |
| FSRS вместо PowerLaw | да | `Box::new(PowerLawScorer{})` зашит, `unit_scorer.rs:95` |
| Новый `ExerciseAsset`, exercise-metadata | да | закрытый enum, поля манифеста |
| Exercise-level dependencies | да, крупно | вся архитектура lesson/course-уровня |
