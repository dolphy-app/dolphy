# Trane (trane-project) — отчёт

Метод: README и книга (https://trane-project.github.io/print.html), а также исходники, склонированные из `https://github.com/trane-project/trane` (HEAD, `Cargo.toml` version = 0.34.1, edition 2024, последний коммит 2026-09-11). Цитаты кода ниже — из этого клона (`src/...`).

## 1. Что это

Trane — «automated practice system for the acquisition of arbitrary, complex, and highly hierarchical skills» (https://github.com/trane-project/trane). Ядро — Rust-библиотека: граф зависимостей курсов/уроков/упражнений, планировщик, хранение результатов в SQLite. Изначально задумывался для практики джазовой импровизации (название — от Coltrane). Сам автор пишет, что это его первый серьёзный проект на Rust (`CONTRIBUTING.md`).

- Лицензия: AGPL-3.0 у `trane` и `trane-cli` (GitHub API). Книга при этом называет лицензию GPLv3 («incompatible with the GPLv3 license») — расхождение в документации. Официальные курсы `trane-music`, `trane-rustlings` — GPL-3.0 (GitHub API).
- Мейнтейнер: один человек (organization `trane-project`). `CONTRIBUTING.md`: «I am not accepting code contributions for this repository, as I would like to keep full control». Принимаются issues.
- Активность: `trane` — 847 звёзд, push 2026-09-11; `trane-cli` — 32 звезды, push 2026-08-27. Официальные курсы почти заброшены: `trane-music` — последний push 2023-10-31, `trane-rustlings` — 2023-02-02, `trane-earmaster` — 2023-11-28 (GitHub API org listing).
- Монетизация проекта — через отдельный продукт *Pictures Are For Babies* (литеральный тьютор на базе Trane, README).
- Компонентная схема из книги: `trane` (core lib), `trane-cli`, `trane-app` («UPCOMING»), `trane-server` («UPCOMING», HTTP REST для не-Rust клиентов). `trane-android`: репозиторий в организации не найден — `[НЕ ПОДТВЕРЖДЕНО]`. Ссылки на trane-app/server в книге — «under construction».

## 2. Архитектура и стек

- Язык: Rust. Зависимости из `Cargo.toml`: `rusqlite` (bundled SQLite) + `rusqlite_migration`, `serde`/`serde_json`, `postcard`, `chrono`, `rayon`, `parking_lot`, `ustr` (интернированные ID), `vfs` (виртуальная ФС, есть embedded-fs), `derive_builder`, `walkdir`, `noyalib` (compat serde_yaml).
- Модель развёртывания: локальная библиотека (in-process) + CLI. Никакого сервера/облака. «Trane library» = каталог с подкаталогом `.trane/`, создаётся автоматически при первом открытии (книга, quick start).
- Содержимое `.trane` (из `src/lib.rs` и книги): `practice_stats.db`, `practice_rewards.db`, `practice_deltas.db`, `blacklist.db` (все SQLite; константы `PRACTICE_STATS_PATH` и др. в `lib.rs`), `user_preferences.json`, каталог `filters/` (JSON), study sessions (JSON), review list (SQLite, `review_list.rs`).
- Схема практик-статистики (`practice_stats.rs`): таблицы `uids(unit_uid INTEGER PRIMARY KEY, unit_id TEXT NOT NULL UNIQUE)` и `practice_stats` с индексом `(unit_uid, timestamp)`. Хранятся только `score` и `timestamp` (док-комментарий: «Currently, only the score and the timestamp are stored»).
- Модули (README «Code Tour»): `data`, `graph`, `course_library`, `blacklist`, `practice_stats`, `exercise_scorer`, `scheduler`, `review_list`, `filter_manager`, `course_builder`, `lib.rs` (публичный API).
- Курсы — в файловой системе как JSON-манифесты + Markdown-ассеты. Курсы из git-репозиториев кладутся `repository add <url>` в каталог `managed_courses` (книга); при синхронизации библиотеки через git `managed_courses` советуют добавить в `.gitignore`.
- `trane-cli`: интерактивный REPL (clap + rustyline-подобные шорткаты), команды: `next`, `score`, `answer`, `current`, `open`, `blacklist`, `filter`, `list`, `search`, `scores`, `review-list`, `repository`, `instructions`, `material`, `debug` (книга/README trane-cli). Оценка сохраняется, но отправляется при переходе к следующему вопросу — можно поправить (README trane-cli).
- Публичная API-точка входа: `Trane::new_local(working_dir, library_root)`, `new_local_with_vfs`, `new_local_from_serialized` (`src/lib.rs`, строки ~309–358); `Trane` агрегирует `Blacklist`, `CourseLibrary`, `FilterManager`, `PracticeStats/Rewards/Deltas`, `PreferencesManager`, `ReviewList`, `StudySessionManager`, `ExerciseScheduler` (`DepthFirstScheduler`), `UnitGraph`. Крейт публикуется на crates.io/docs.rs (README-бейджи); сами страницы crates.io вернули HTTP 403 — `[НЕ ПОДТВЕРЖДЕНО]` для метаданных/даунлоадов.
- Интерфейс планировщика (`src/scheduler.rs`, trait `ExerciseScheduler`):
  `get_exercise_batch(filter: Option<ExerciseFilter>) -> Vec<ExerciseManifest>`, `score_exercise(exercise_id, score: MasteryScore, timestamp)`, `get_unit_score(unit_id) -> Option<f32>`, `invalidate_cached_score(...)`, `get/set/reset_scheduler_options`, `override_current_timestamp` (для тестов/бенчмарков).

## 3. Модель знаний и зависимостей

Три типа юнитов (`UnitType`): `Exercise`, `Lesson`, `Course`. Зависимости задаются только у курсов и уроков (упражнения не имеют зависимостей). Граф — DAG; `check_cycles()` вызывается при открытии библиотеки (`graph.rs`: «Performs a cycle check on the graph, done currently when opening the Trane library»; реализация — DFS с выводом пути цикла). Неявная зависимость урока от своего курса (`UnitType::Lesson` doc). Уроки внутри курса — без порядка между упражнениями («no dependencies between the exercises in a single lesson»).

Шесть отношений между юнитами (`graph.rs`): dependency/dependent, **encompassed**/encompasses («doing well in the exercises of B implies that the skills tested by A is being used»), **superseded**/supersedes («sufficient mastery of B makes showing exercises from A redundant»).

Структура каталога (книга, «Writing Trane Courses»):
```
course_root/
    course_manifest.json
    <LESSON_DIR>/
        lesson_manifest.json
        <EXERCISE_DIR>/
            exercise_manifest.json
```

### Поля манифестов (из `src/data.rs`, структуры `CourseManifest`, `LessonManifest`, `ExerciseManifest`)

`CourseManifest`: `id` (Ustr, напр. `music::instrument::guitar::basic_jazz_chords`), `name`, `dependencies: Vec<Ustr>`, `encompassed: Vec<(Ustr, f32)>`, `superseded: Vec<Ustr>`, `description: Option<String>`, `authors: Option<Vec<String>>`, `metadata: Option<BTreeMap<String, Vec<String>>>`, `course_material: Option<BasicAsset>`, `course_instructions: Option<BasicAsset>`, `generator_config: Option<CourseGenerator>`. Все, кроме `id`, имеют `#[serde(default)]`.

`LessonManifest`: `id`, `dependencies`, `encompassed`, `superseded`, `course_id` (обязательное), `name`, `description`, `metadata`, `lesson_material`, `lesson_instructions`.

`ExerciseManifest`: `id`, `lesson_id`, `course_id`, `name`, `description`, `exercise_type` (`Declarative` | `Procedural`, по умолчанию `Procedural`), `exercise_asset` (обязательное).

`BasicAsset`: `MarkdownAsset{path}`, `InlinedAsset{content}`, `InlinedUniqueAsset{content}`. Пути — относительно каталога манифеста; при загрузке нормализуются относительно корня библиотеки (`NormalizePaths`) и проверяются на существование (`VerifyPaths`).

`ExerciseAsset` (enum): `BasicAsset`, `FlashcardAsset{front_path, back_path?}`, `InlineFlashcardAsset{front_content, back_content?}`, `LiteracyAsset{lesson_type, examples, exceptions}`, `SoundSliceAsset{link, description?, backup?}`, `TranscriptionAsset{content, external_link?}`. Ответ (`back`) опционален — упражнение может быть open-ended.

`CourseGenerator`: `KnowledgeBase(KnowledgeBaseConfig)`, `Literacy(LiteracyConfig)`, `Transcription(TranscriptionConfig)`.

### Семантика encompassed / superseded (док-комментарии `data.rs`)

- `encompassed`: «By default, all dependencies are encompassed with a weight of 1.0». Запись нужна только если (а) encompassed-юнит не является зависимостью, или (б) зависимость не должна считаться encompassed — тогда weight 0.0. Веса в [0.0, 1.0] (`reward_propagator.rs`: «partial encompassings via weights in the range [0.0, 1.0]»).
- `superseded`: «If this course is mastered, then exercises from the superseded courses or lessons will no longer be shown». Точные условия (`unit_scorer.rs::is_superseded`): (1) все валидные упражнения superseded-юнита имеют хотя бы одну оценку; (2) все superseding-юниты имеют score ≥ `superseding_score` (по умолчанию 4.0). Проверка рекурсивная (`get_superseding_recursive`). Применение: урок/курс пропускается, если он superseded; superseded-зависимость считается выполненной (`scheduler.rs` ~556–560).
- Blacklist: юнит из blacklist не показывается, а зависимость от него считается выполненной; урок в blacklisted-курсе — тоже (`scheduler.rs` ~532–552).

### Реальные манифесты (verbatim, `tests/embedded_test_library/raw_course/`)

`course_manifest.json`:
```json
{
  "id": "embedded::raw_course",
  "name": "Embedded Raw Course",
  "dependencies": [],
  "encompassed": [],
  "superseded": [],
  "description": null,
  "authors": null,
  "metadata": null,
  "course_material": {
    "MarkdownAsset": {
      "path": "course.material.md"
    }
  },
  "course_instructions": {
    "MarkdownAsset": {
      "path": "course.instructions.md"
    }
  },
  "generator_config": null
}
```
`lesson/lesson_manifest.json`:
```json
{
  "id": "embedded::raw_course::lesson",
  "dependencies": [],
  "encompassed": [],
  "superseded": [],
  "course_id": "embedded::raw_course",
  "name": "Embedded Raw Lesson",
  "description": null,
  "metadata": null,
  "lesson_material": { "MarkdownAsset": { "path": "lesson.material.md" } },
  "lesson_instructions": { "MarkdownAsset": { "path": "lesson.instructions.md" } }
}
```
(в файле `lesson_material`/`lesson_instructions` записаны многострочно; здесь объекты свёрнуты в одну строку, ключи и значения те же.)

`lesson/exercise/exercise_manifest.json`:
```json
{
  "id": "embedded::raw_course::lesson::exercise",
  "lesson_id": "embedded::raw_course::lesson",
  "course_id": "embedded::raw_course",
  "name": "Embedded Raw Exercise",
  "description": null,
  "exercise_type": "Procedural",
  "exercise_asset": {
    "FlashcardAsset": {
      "front_path": "front.md",
      "back_path": "back.md"
    }
  }
}
```
Формат serde-enum (внешне тегированный: `{"FlashcardAsset": {...}}`) — не идиоматичный для ручного JSON, но однозначный.

### Generated courses

Курс с `generator_config` требует только `course_manifest.json`; манифесты уроков/упражнений генерируются при открытии библиотеки, после чего «Trane makes no distinction between normal and generated courses» (книга, «Generated Courses»). `KnowledgeBase`-генератор (`knowledge_base.rs`) распознаёт каталоги `*.lesson` и файлы: `lesson.dependencies.json`, `lesson.superseded.json`, `lesson.encompassed.json`, `lesson.name.json`, `lesson.description.json`, `lesson.metadata.json`, `lesson.instructions.md`, `lesson.material.md`, `lesson.default_exercise_type.json`, а для упражнения — `<name>.front.md`, `<name>.back.md`, `<name>.name.json`, `<name>.description.json` и т.д. Пример (`tests/large_test_library/improvise_for_real/sing_the_numbers_3/14.lesson/lesson.dependencies.json`): `["12","13"]`; `2_transposed.lesson/lesson.superseded.json`: `["2"]`.

Реальный `course_manifest.json` с генератором (`tests/large_test_library/.../jam_tracks_1/a/`, сокращён до 1 из 21 passage; ключи подлинные):
```json
{
    "id": "trane::music::improvise_for_real::jam_tracks::1::a",
    "name": "IFR Jam Tracks Level 1 - key of A",
    "authors": ["The Trane Project"],
    "metadata": { "course_series": ["improvise_for_real","jam_tracks"], "skill": ["music"], "key": ["a"], "ifr_level": ["1"] },
    "generator_config": {
        "Transcription": {
            "transcription_dependencies": ["trane::music::improvise_for_real::jam_tracks::1::d"],
            "skip_singing_lessons": true,
            "skip_advanced_lessons": true,
            "inlined_passages": [ { "asset": { "Track": { "short_id": "1_jazz", "track_name": "1st harmonic env, jazz, key of A", "album_name": "IFR Jam Tracks Level 1" } }, "intervals": { "1": ["Beginning of song", "End of song"] } } ]
        }
    }
}
```

`Literacy`-генератор — учит чтению по примерам/исключениям правил орфографии (`literacy.rs`); `Transcription` — 4 фазы по книге: Singing → Transcription / Advanced Singing → Advanced Transcription, с зависимостями между фазами.

Course-builder: книга рекомендует писать курсы как Rust-код (`course_builder`, `CirclesFifthCourse` для уроков по кварто-квинтовому кругу) — «breaking change to the manifest data structures ... will result in a compile error».

### Метаданные и фильтры

`metadata` — `key -> [values]` на курсе и уроке. Фильтры (`src/data/filter.rs`, `UnitFilter`): `CourseFilter{course_ids}`, `LessonFilter{lesson_ids}`, `MetadataFilter{filter: KeyValueFilter}`, `ReviewListFilter`, `Dependents{unit_ids}`, `Dependencies{unit_ids, depth}`. `KeyValueFilter` — `CourseFilter/LessonFilter{key,value,filter_type: Include|Exclude}`, `BasicFilter`, `CombinedFilter{op: All|Any, filters}`. Metadata-фильтр сохраняет зависимости: «Lessons which do not pass the filter are considered as mastered so that the scheduler can continue the search»; в коде `resolve_effective_dependencies` «bridges through» отфильтрованные юниты. Saved filters — JSON в `.trane/filters` (`SavedFilter{id, description, filter}`), пример «guitar» в книге. `StudySession` — сохранённые в файлы сессии с ограничением по времени (`study_session_manager.rs`). «Reference courses» как отдельная сущность в документации не найдены — `[НЕ ПОДТВЕРЖДЕНО]`; роль близка к обычным зависимостям между курсами разных репозиториев (общая ID-схема `trane::music::...`).

## 4. Алгоритм обучения/повторения

### Шкала самооценки
`MasteryScore` = One..Five (`data.rs`), маппится в f32 1.0..5.0. Смысл (книга «Mastery Score»): 1 — навык только вводится; 5 — «complete mastery», для музыки — свободная игра и импровизация. Объективных определений нет, «the main difference between them is the degree of unconscious mastery» (trane-cli README). Оценка самоотчётная.

### Скоринг упражнения (`src/exercise_scorer.rs`, `PowerLawScorer`)
Чистая детерминированная функция от истории проб; результат `ExerciseScore{value ∈ [0,5], urgency ∈ [0,1], velocity: Option<f32>}`. В док-комментарии: «inspired by FSRS ... but simplified for Trane's stateless architecture»; состояние стабильности не хранится, а пересчитывается replay истории (последние `num_trials`=20 проб).

1. Difficulty: `1 + failure_rate*9`, где failure = score < 3.0; диапазон 1..10, база 5.0.
2. Stability (дни): старт 1.0; для каждой пробы (хронологически, первую пропускают): `p = (score-1)/4 - 0.5`, `e = (11 - difficulty)/5`, `S' = S·(1 + 2.5·p·e·spacing_gain·min(Δdays,1))`, clamp [0.5, 730]. `spacing_gain = 1 + 0.65·(1 - R_pre)` при p > 0, иначе 1.0. Difficulty обновляется с mean-reversion (вес 0.16, scale 1.05).
3. Retrievability (power law): `R = (1 + factor·t/S)^decay`, decay = −0.2 (procedural) / −0.4 (declarative); `factor = 0.9^(−1/|decay|) − 1`, так что `R(t=S)=0.9`.
4. «Old-good floor»: если ≥2 проб, взвешенный score ≥ 4.0 и ≥ 50 дней, то R ≥ 0.75.
5. Weighted score: `0.8·time_avg + 0.2·pos_avg`; вес `0.95^weeks` (time) и `0.95^i` (position), минимум 0.1.
6. `value = clamp(R_eff · weighted_score + delta, 0, 5)`; `delta` — усреднённое отклонение «предсказанного vs фактического score» (`practice_deltas`), ×R/4, применяется при ≥2 дельт. `urgency = 1 − R`. Velocity — наклон OLS по пробам (score/день).
7. Без истории: value 0.0, urgency 1.0.

Автор явно отмечает, что это не чистое расписание повторов: «The returned score ... is a compact signal used by the scheduler ... rather than a direct review schedule», и «Spaced repetition is just one of many strategies». Книга: «computing a score ... rather than computing the optimal time at which the exercise needs to be presented again».

### Планировщик (`src/scheduler.rs`, `DepthFirstScheduler`)
Пять фаз (док-комментарий модуля):
1. DFS по графу, собирает пул кандидатов размером до `batch_size × 10` (`MAX_CANDIDATE_FACTOR`).
2. Review knocker (`review_knocker.rs`): удаляет/штрафует упражнения, сильно «encompassed» другими в пуле. Пороги: very highly = score ≥ 4.5 и weight ≥ 10.0 (удаляются); highly = score ≥ 3.75 и weight ≥ 5.0 (демотируются в окне).
3. Mastery windows: кандидаты группируются по score и выбираются с заданными долями.
4. Relearn pile: недавно проваленные упражнения (доля `relearn_fraction`=0.1) добавляются в батч.
5. Shuffle (группы ≤ 3 низкооценённых упражнений из одного курса подряд; новые группы слегка смещены к концу), инкремент частоты показа в сессии.

Ключевые опции по умолчанию (`SchedulerOptions::default()`): `batch_size` 50; окна: new [0,0.1) 20%, target [0.1,2.5) 20%, current [2.5,3.75) 30%, easy [3.75,4.5) 20%, mastered [4.5,5.0] 10%; `superseding_score` 4.0; `num_trials` 20, `num_deltas` 10, `num_rewards` 10; `max_lessons_in_progress` 10. Пользовательская настройка — только `batch_size` (`SchedulerPreferences`).

**Прохождение (mastery learning)** — `PassingScoreOptions`: `min_score` 3.0, `min_fraction` 0.5, `min_avg_trials` 1.8. Юнит открывает зависимых, если средний score ≥ `min_score` И среднее число проб на упражнение ≥ `min_avg_trials`. Плавность: доля упражнений урока, попадающих в кандидаты, растёт линейно: `fraction = min_fraction + (score − min_score)/(4.0 − min_score) · (1 − min_fraction)` от 0.5 при score = 3.0 до 1.0 при score = 4.0 (`FULL_CANDIDATES_SCORE`). Если урок не проходит порог — кандидаты помечаются `dead_end`, DFS перемешивает стек и идёт по другим веткам; при достаточном числе кандидатов останавливается раньше.

### Reward propagation (FIRe-подобный, `reward_propagator.rs`)
Явно «heavily inspired by Fractional Implicit Repetition (FIRe)» Math Academy (https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/). При оценке упражнения: начальный reward: 5 → +0.8, 4 → +0.4, 3 → −0.3, 2 → −0.5, 1 → −1.0. Хорошие оценки идут вниз по графу (в encompassed-юниты, положительный reward), плохие — вверх (в юниты, которые encompass это упражнение, отрицательный). Каждый шаг: `next = edge_weight · 0.9 · value`; вес затухает ×0.8; остановка при |reward| < 0.2 или weight < 0.2. Хранятся в `practice_rewards.db`. Применяются к упражнению при ≥ 3 проб (`MIN_TRIALS_FOR_REWARD`), полураспад 14 дней, веса: курс 0.3, урок 0.7 (`reward_scorer.rs`).

Кэш скоров юнитов — до 2 часов (`MAX_CACHE_AGE`). Score урока/курса — агрегат упражнений с учётом reward; детали агрегата отдельно не изучались — `[НЕ ПОДТВЕРЖДЕНО]` формула агрегации.

## 5. Верификация мастерства

Только **самооценка** 1–5 после попытки. Детерминированной проверки ответов нет: упражнение показывается (flashcard front/back, инструкция), пользователь смотрит `answer` и ставит оценку. Автоматических тестов/CAS/SQL нет; `LiteracyAsset` тоже оценивается человеком («scored based on how many they get right»). Планы на учителя («teacher could rate the mastery») в книге помечены как не реализованные («Most of the ideas in this section are not yet implemented»). Косвенная компенсация субъективности — `practice_deltas` (сравнение предсказанного и заявленного), reward propagation и требование `min_avg_trials`.

## 6. Синхронизация, офлайн, приватность, экспорт/импорт

- Полностью офлайн, локально: SQLite-файлы и JSON в `.trane`. Телеметрии/облака в прочитанных источниках нет — `[НЕ ПОДТВЕРЖДЕНО]` формальное заявление о приватности.
- Синхронизация: встроенной нет. Книга лишь упоминает вариант синхронизировать библиотеку через git, исключая `managed_courses`. Бинарные `.db` в git — потенциально конфликтуют; решения по merge в источниках не найдены.
- Курсы шарятся через git-репозитории (`repository add/list`).
- Экспорт/импорт прогресса: документированного формата нет (только сами SQLite-БД). `trane-server` (REST) и `trane-app` заявлены как будущие.
- `postcard` в зависимостях — для сериализованной библиотеки (`new_local_from_serialized`), назначение подробно не проверялось.

## 7. Авторинг контента

- Ручной: три уровня JSON-манифестов на каждый юнит — самая большая точка трения; сама книга признаёт: «quickly get out of hands». Поэтому предложено (а) генерация Rust-кодом (`course_builder`), (б) generated courses (`KnowledgeBase`, `Transcription`, `Literacy`) — из Markdown-файлов и мелких JSON рядом.
- Валидация при открытии: acyclicity (DFS), существование путей ассетов; ошибки Rust-типов (`UnitGraphError`, `serde`) как контракт формата.
- Примеры больших курсов: `trane-music`, `trane-earmaster` (конверсия EarMaster 7, нужна копия), `trane-leetcode`, `trane-rustlings` (расширяет rustlings) — по книге («Official Trane Courses»). Заброшенность — см. §1.
- LLM в авторинге не используется в прочитанных источниках; в `src/data/course_generator/transcription/course_instructions.md` — шаблонные инструкции. `[НЕ ПОДТВЕРЖДЕНО]` наличие LLM-инструментов вне репозиториев.
- Идея из vision: предполагается, что «majority of learners will follow the same path», поэтому граф надо определить один раз (книга «Vision»).

## 8. Монетизация / рынок / аудитория

Открытое ядро (AGPL) + коммерческий продукт *Pictures Are For Babies* (Lite-версия бесплатна, 200 уроков; полная — платная подписка/покупка; конкретные цены не проверялись — `[НЕ ПОДТВЕРЖДЕНО]`). Аудитория ядра: музыканты (джаз, гитара, саксофон), самоучки, программисты (leetcode/rustlings). Пользовательская база по звёздам — сотни.

## 9. Сильные и слабые стороны

Сильные:
- Полноценный DAG с тремя типами связей (dependency / encompassed с весами / superseded) — ближайший open-source аналог FIRe; encompass по умолчанию = dependency с весом 1.0 (мало ручной работы).
- Mastery learning мягкий: `min_fraction` + `min_avg_trials`, а не бинарный проход; «dead_end» обходит блокировку.
- Батч с mastery windows и relearn pile; stateless-скорер (replay истории) — легко тестировать, нет дрейфа состояния.
- Хорошо задокументированный код (module-level docs с обоснованием), обширные тесты, CI, coverage.
- Фильтры по metadata с сохранением зависимостей; blacklist как «уже освоил».
- Чистое разделение: контент (plain-text) отдельно от состояния (`.trane` SQLite).

Слабые:
- Только самооценка; нет автоматической верификации — риск завышения оценок и «grade inflation».
- Один мейнтейнер, закрыт для PR в ядро, AGPL при заявленной «GPLv3» — путаница.
- Официальный контент почти не развивается с 2023 г.; `trane-app`/`trane-server` не выпущены; Android-клиент не найден.
- Нет sync/экспорта прогресса; SQLite в git — конфликты.
- Формат манифестов многословен (три файла на юнит, serde-enum с внешним тегом); автор сам рекомендует писать Rust-код.
- Скорер — эвристика «inspired by FSRS», параметры не обучаются и не валидированы на данных (док-комментарий: «Adjustable constants ... can be tuned to calibrate»); нет опубликованных метрик.
- Курсы нужного уровня — узкая ниша (музыка), мало STEM-контента.

## 10. Что заимствовать / чего избегать

1. Заимствовать трёхтиповую связь **dependency / encompassed(weight) / superseded**, с default «encompassed = dependencies, weight 1.0» и явным `0.0` для отключения. Это минимизирует авторский труд.
2. Заимствовать мягкий gate: `min_score`=3.0 + `min_avg_trials`=1.8 + линейная `min_fraction` — вместо бинарного «освоено», плюс `dead_end`-обход для избежания блокировки (снижает remediation burnout).
3. Заимствовать mastery windows (new/target/current/easy/mastered с долями 20/20/30/20/10) и relearn pile 10% как готовые baseline-параметры; сделать их настраиваемыми в `SchedulerOptions` с `verify()` (сумма = 1, без разрывов).
4. Заимствовать stateless-скоринг: score = f(история проб), кэш ≤ 2 ч. Для нашей платформы стоит сравнить с настоящим FSRS (параметры оптимизируются на логах) и хранить журнал review в SQLite append-only — он же решает sync (merge журналов без конфликтов, в отличие от бинарных `.db` в git).
5. Заимствовать структуру `.trane`: контент и состояние раздельны, БД с миграциями (`rusqlite_migration`), таблица `uids` для интернирования ID.
6. Заимствовать generated courses / «KnowledgeBase»: каталог `*.lesson` с мелкими `lesson.dependencies.json`, `<ex>.front.md`/`.back.md` — низкое трение авторинга и хорошо ложится на Markdown/Obsidian-подход. Добавить LLM-генерацию в этот же формат с детерминированным валидатором.
7. Заимствовать проверки при загрузке: цикл-детектор с выводом пути цикла, `verify_paths`; дополнить транзитивной редукцией и проверкой гранулярности (в Trane их нет).
8. Избегать: чисто самооценки как единственной верификации — добавить исполняемые проверки (тесты/CAS/SQL) как основной источник оценки; самооценку оставить для процедурных навыков.
9. Избегать: serde external-tagged enum в ручном JSON и трёх обязательных манифестов на каждый юнит; выбрать YAML/Markdown frontmatter с одним файлом на урок, при этом сохранив явные ID.
10. Избегать: смешанной/двусмысленной лицензии, закрытого приёма PR и зависимости роадмапа от одного человека; для community-контента заранее продумать moderation и версионирование курсов (Trane это не решает).

## 11. Источники (фактически прочитаны)

- https://github.com/trane-project/trane (README, дерево файлов, GitHub API метаданные)
- https://trane-project.github.io/ и https://trane-project.github.io/print.html (Concepts, Vision, Quick Start, Using Trane, User Preferences, Saved Filters, Official Courses, Writing/Generated Courses — прочитаны первые ~1000 строк из 2320)
- https://github.com/trane-project/trane-cli (README, дерево)
- Исходники клона https://github.com/trane-project/trane (v0.34.1): `src/data.rs`, `src/graph.rs`, `src/scheduler.rs`, `src/scheduler/{unit_scorer,review_knocker,reward_propagator,relearn_pile,shuffler}.rs`, `src/exercise_scorer.rs`, `src/reward_scorer.rs`, `src/practice_stats.rs`, `src/practice_rewards.rs`, `src/data/filter.rs`, `src/data/course_generator/{knowledge_base,literacy}.rs`, `src/lib.rs`, `CONTRIBUTING.md`, `improvement_plan.md`, `tests/embedded_test_library/*`, `tests/large_test_library/*`
- GitHub API: организация `trane-project` (репозитории и даты push; `trane-android` в списке отсутствует)
- https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/ — только как ссылка из исходника, не читалась
- https://crates.io/api/v1/crates/trane — HTTP 403, не прочитан
