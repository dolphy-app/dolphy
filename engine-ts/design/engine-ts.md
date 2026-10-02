# engine-ts: слой бизнес-логики (TypeScript-порт Trane на ts-fsrs) для Electron-приложения

Статус: проект v1, 2026-09-29 (v0 + слой F1–F7 и результаты пяти спайков F-слоя). Код движка — в `packages/engine` и соседних пакетах; основания проверены в песочнице `engine-ts/spike/`. Пометки: **[ИЗМЕРЕНО]** — получено прогоном; **[ВЫВОД]** — наше умозаключение; **[ОЦЕНКА]** — расчёт, не замер; **[НЕ ПОДТВЕРЖДЕНО]** — не проверено.
Связанные документы (в этом же каталоге): `engine-ts-api.md` (контракт для UI), `engine-ts-electron.md` (псевдокод сервисов и транспорта в Electron), `engine-ts-testing.md` (стратегия тестов на vitest), `engine-ts-diagram.html` (схема). Спеки и отчёты агентов (`engine-ts/research/`, `fsrs-in-trane*.md`) удалены из рабочего дерева и остались в истории git: `git show 75d8d08:<путь>`; ссылки на них ниже сохранены как цитаты. Код и fixtures песочницы: `engine-ts/spike/`. Предшествующий документ: `docs/design/build-vs-port.md`. Пути внутри отчётов и спек, написанные до переноса, указывают на `spike/engine-ts/` — теперь это `engine-ts/spike/`. Каталоги `spike/trane-mvp/` и `spike/trane-fsrs/` удалены по решению владельца; эталон Rust-Trane v0.34.1, образцовый курс и Rust-адаптер FSRS — в `engine-ts/reference/` (`trane-pristine/`, `sql-course/`, `fsrs-scorer/`).

> **Лицензия — решение владельца (2026-09-29): вопрос не блокирует работу.** Порт повторяет структуру, константы и тесты Trane (AGPL-3.0-or-later), то есть это производная работа; при публикации или распространении приложения обязательства AGPL применимы [ВЫВОД, не юридическая оценка; `LICENSE` и `Cargo.toml` Trane прочитаны ранее]. Запасной путь — «чистая комната» (без переноса констант, кода и тестов, только по опубликованным идеям FIRe, KST, FSRS); решение отложено до первого внешнего релиза.

## 0. Решения в одной таблице

| Вопрос | Решение |
|---|---|
| Язык, рантайм | TypeScript 7.0.2 (`strict`, `erasableSyntaxOnly`, ESM). Dev/CI: Node ≥ 22.12 и 24; прод: Electron 44.4.5 = Node 24.21.0 [ИЗМЕРЕНО] |
| Границы | 4 пакета: `@dolphy-app/engine-contract` (типы для UI), `@dolphy-app/engine` (домен + приложение + fs/memory-адаптеры, без нативных зависимостей), `@dolphy-app/engine-sqlite` (better-sqlite3 13.0.3), `@dolphy-app/engine-sql-runner` (раннер проверок SQL в дочерних процессах на `node:sqlite`, §6a.4); пятый пакет `@dolphy-app/engine-rpc` (клиент для renderer, диспетчер для хоста, `MessageEndpoint`; `engine-ts-electron.md` §2) |
| Хост | Движок не импортирует `electron`. API асинхронный, только plain-DTO. Размещение — `utilityProcess` (решение владельца, 2026-09-29); на код движка не влияет |
| Модель памяти | ts-fsrs 5.4.2 (pin) за портом `MemoryModel`; вызывать `next_state` + `forgetting_curve`, **не** `next()`/`Card` |
| Скорер | Интерфейс `ExerciseScorer` как в Trane. По умолчанию `FsrsScorer` (вариант H: `value = R_fsrs × performance`). `PowerLawScorer` — эталон для сверки |
| Состояние ученика | Append-only журнал событий (SQLite) + проекции в памяти. `practice_deltas` удалены, rewards — чистая проекция, blacklist/review list — LWW-флаги в журнале |
| Курсы | JSON-манифесты Trane wire-совместимо + необязательный объект `engine`; генератор KnowledgeBase; Literacy/Transcription не переносим |
| Тесты | vitest 5.0.2. Дифференциальные golden-тесты против настоящего Rust-Trane, порт ≈ 280 из 353 тестов, property/simulation/contract-тесты |
| Лицензия | Не блокирует работу (решение владельца); порт повторяет Trane, AGPL-3.0-or-later применима (A1) |
| Долговечность | WAL + `synchronous=FULL` + `fullfsync=ON` на macOS по умолчанию (≈ 3 мс на коммит [ИЗМЕРЕНО]); `normal` — опция. Потеря питания не проверялась |
| Курс и компилятор (F1, F2) | Каталог Markdown/JSON + `engine`-frontmatter; компилятор собирает все диагностики за проход и пишет JSON-артефакт `.engine/compiled.json` (загрузка 33 мс); свежесть — stat-равенство, источник истины — content-`revision`; `yaml` только в компиляторе (§6a.1) |
| Диагностика (F3) | Пробы по середине самой длинной цепочки нерешённых тем на транзитивной редукции, жёсткое замыкание; при проверках с угадыванием `known` после двух независимых проходов (§6a.3) |
| План дня (F4) | Фронтир + просроченные + интерливинг всегда; неявный повтор (FIRe) — за флагом, по умолчанию выключен, кредит только по явным `encompassed` (§6a.2) |
| Проверка ответов (F5) | Пул дочерних процессов (не `worker_threads`); `node:sqlite` на Node ≥ 24.15 с authorizer; kill по таймауту и RSS; `error` не пишет событие (§6a.4) |
| Ремедиация (F6) | Проекция журнала без новых событий: две подряд неудачи → шаги по `keyPrerequisites`, иначе по прямым зависимостям; [ВЫВОД, спайка нет] (§6a.5) |
| Синхронизация (F7) | Журнал = множество записей + карантин конфликтов; `at` по HLC-правилу; вектор = непрерывный префикс; транспорт — общая папка неизменяемых сегментов (`FolderSync`), подходит файловый синхронизатор или Git (§6a.6) |

## 1. Проблема и границы

**Одним предложением:** библиотека на TypeScript (Node, без Electron), которая загружает библиотеку курсов Trane, планирует батчи упражнений с mastery-gating на модели памяти FSRS, пишет попытки учащегося в append-only журнал и отдаёт асинхронный DTO-API, который позже вызовет Electron-UI через IPC.

**Функциональные требования**
- FR1. Загрузить каталог курсов (JSON-манифесты + Markdown-ассеты), проверить, построить граф юнитов (course → lesson → exercise; dependencies, encompassed с весами, superseded).
- FR2. Валидатор библиотеки: все диагностики за один проход (циклы с путём, ссылки, веса, избыточные рёбра, ассеты).
- FR3. `getBatch(filter?)`: следующий батч (новое на фронтире + повторения) с фильтрами Trane (курс, урок, метаданные, review list, dependents/dependencies, study session).
- FR4. `recordAttempt`: оценка 1–5 или результат проверки → журнал → проекции → награды.
- FR5. Запросы прогресса: оценка юнита, история попыток, **фронтир** и **due** (в Trane их публичного API нет).
- FR6. Кураторство: blacklist, review list, сохранённые фильтры, study sessions, настройки планировщика, сброс прогресса юнита (событием `progress_reset`, журнал остаётся append-only).
- FR7. Порт проверки ответов (`Verifier`): результат раннера → оценка (первый адаптер — SQL, M5).
- FR8. Примитивы синхронизации: экспорт/импорт журнала, детерминированный rebuild (транспорт вне области).
- FR9. Ремедиация по `keyPrerequisites` (F6).
- FR10. Диагностический вход-тест на графе (F3).
- FR11. План дня: фронтир + просроченные + интерливинг; сжатие повторов через неявный кредит — за флагом (F4).
- FR12. Компиляция курса в артефакт и проверка его свежести; курс как Markdown-репозиторий с `engine`-frontmatter (F1, F2).

**Нефункциональные требования** (числа — цели, замеры в §2)
- NF1. Производительность: открытие библиотеки 3 000 уроков ≤ 2 с; `getBatch` тёплый p95 < 100 мс, холодный < 500 мс; `recordAttempt` p95 < 20 мс.
- NF2. Долговечность: после ответа `recordAttempt` событие не теряется при падении процесса приложения (SIGKILL-тест: 600 убийств, 0 потерь [ИЗМЕРЕНО]); по умолчанию WAL + `synchronous=FULL` + `fullfsync=ON` (macOS), чтобы пережить потерю питания — по документации SQLite [ВЫВОД, не проверялось]; `NORMAL` — опция, может откатить последние коммиты.
- NF3. Детерминизм: при заданных (библиотека, журнал, `Clock`, seed `Rng`) результат воспроизводим; состояние — чистая функция журнала.
- NF4. Локальность и приватность: никакой сети в движке.
- NF5. Совместимость: реальные курсы Trane открываются без изменений (кроме курсов с Literacy/Transcription).
- NF6. Тестируемость: домен без I/O; все источники времени, случайности и идентификаторов инъектируются.
- NF7. Переносимость: Node 22 (vitest) и Node 24 (Electron 44); проверено только macOS arm64.

**Вне области сейчас:** UI; main/preload/IPC-обвязка Electron (только контракт и требования к транспорту); LLM-авторинг курсов; облачный транспорт синхронизации (F7 закрыт папкой сегментов); несколько пользователей в одном профиле; генераторы Literacy/Transcription и SoundSlice; обучение параметров FSRS (M7, по данным).

**Допущения:** A1 лицензия (выше); A2 один процесс-писатель на профиль (`requestSingleInstanceLock` в приложении); A3 один пользователь на профиль; A4 движок работает в одном потоке; A5 часы устройств могут расходиться (в тестах ±1 сутки) и шагать назад; порядок событий держит HLC-правило `at` (§5.1); часы в далёком будущем (2099) не измерялись.

### 1.1 Трассировка F1–F7 → требования, API, вехи

Исходный список F1–F7: `docs/design/platform-synthesis.md` §4. Все семь входят в область engine-ts. В v0 F3, F6 и сжатие повторов из F4 стояли как «позже» (FR9); теперь у каждого есть дизайн (§6a), веха и приёмка, а реализуемость проверили пять спайков (`research/report-*.md`).

| F | Требование | FR | Реализация в engine-ts | Веха | Приёмка (автоматическая) | Основание |
|---|---|---|---|---|---|---|
| F1 | Курс — репозиторий Markdown/JSON: пререквизиты, веса охвата, вопросы, исполняемые проверки | FR1, FR12 | Раскладка Trane (JSON и KB) + необязательный `engine` (`verification`, `keyPrerequisites`, `tags`, `bloom`, `dok`) из YAML-frontmatter `<ex>.front.md`, `lesson.engine.json` или ключа манифеста; `library.readAsset` срезает frontmatter | M1 | оба layout грузятся; `readAsset` без frontmatter; Rust-Trane открывает курс с `engine`-frontmatter | `report-compiler.md` §1–2: 7 библиотек; открытие Rust-Trane курса с frontmatter [НЕ ПОДТВЕРЖДЕНО] |
| F2 | Компилятор и валидатор: цикл с путём, транзитивная редукция, диапазоны весов, у каждого упражнения исполняемая проверка, гранулярность | FR2, FR12 | `library.validate()`, `library.compile()`, CLI `engine-cli validate\|compile`; 36 кодов (`E_CYCLE_*` с путём, `W_REDUNDANT_EDGE`, `E_ENC_WEIGHT`, `E_NO_VERIFICATION`, `W_FAN_IN`, …); новые `W_GRANULARITY` и `E_REFERENCE_FAILS` (эталонное решение проходит собственную проверку, флаг `--run-checks`); артефакт `.engine/compiled.json` | M1 (валидация, артефакт), M5 (`--run-checks`) | матрица ≥ 48 внесённых дефектов: каждый найден с ожидаемым кодом и файлом; чистые библиотеки — 0 ошибок и предупреждений; `loadCompiled == loadDirectory` | `report-compiler.md` §3.2, §4: 48 дефектов, 35 из 36 кодов [ИЗМЕРЕНО]; `W_GRANULARITY` и `E_REFERENCE_FAILS` не прототипировались |
| F3 | Диагностический вход-тест на графе | FR10 | `placement.start/nextProbe/answer/finish/abort`: V3 на редукции с жёстким замыканием; `finish` пишет по 2 попытки на упражнение `known`-уроков, `source: 'placement'`, одной транзакцией; `minPass = 2`, если у проверки есть угадывание | M6 | безшумный прогон не противоречит истинному downset; после `finish` строгий гейт открывает ровно вычисленный фронтир; сессия детерминирована по (seed, ответы) | `report-diagnostic.md`: N = 3 000, шум 3%: 20 проб → 87.5%, 40 → 89.3%; выбор пробы ≤ 0.33 мс; синтетический downset — круговая модель |
| F4 | План дня: новое на фронтире + просроченные + сжатие повторов + интерливинг | FR3, FR5, FR11 | `practice.getFrontier/getDue` (M3); `plan.getDay` (M6): due по R, резерв 25% под новое, интерливинг по курсу и тегам; сжатие — неявный кредит `stepFractional` + жадное покрытие, за флагом, выключено | M3 (фронтир, due), M6 (план, интерливинг, кредит) | `≤ maxItems`; детерминизм при равном seed; интерливинг соблюдён, если выполним; `rebuild == incremental` побитово; `getFrontier` совпадает с Rust | `report-fire-plan.md`: план 1.6–2.7 мс; в круговой модели очередь due ×8 меньше, при ложности допущения доля R ≥ 0.8 падает с 0.99 до 0.42–0.47 |
| F5 | Проверка ответов локальными детерминированными раннерами → оценка | FR7 | `Verifier` (порт), `GradePolicy` (результат → оценка 1–5), `SqlVerifier`: пул процессов, `node:sqlite` + authorizer на Node ≥ 24.15, kill по таймауту и RSS; `beginAttempt/submitAnswer/completeAttempt` | M5 | батарея угроз (30 случаев): 0 эффектов в профиле `full`; `error` не пишет событие; 1 000 проверок ≤ 1 с на прогретом пуле (порог с запасом, проект `bench`) | `report-sql-runner.md`: 27 из 30 угроз закрыты authorizer'ом; 153 теста Node 22, 154 Node 24; kill процесса 1–8 мс |
| F6 | Точечная ремедиация по ключевым пререквизитам | FR9 | `RemediationTracker` (проекция журнала, событий нет): две подряд неудачи → шаги по `engine.keyPrerequisites`, иначе по прямым зависимостям; `remediation.getPlan`; поле `remediation` в `RecordResultDto`; элементы `reason: 'remediation'` в `getBatch` и `getDay` | M6 | детерминизм; `rebuild == incremental`; после двух неудач в плане есть ключевой пререквизит, после успеха на нём упражнение возвращается | спайка нет [НЕ ПОДТВЕРЖДЕНО]; в Trane ремедиации нет (аудит v0.34.1) |
| F7 | Несколько устройств без облака, не через Git | FR8 | Журнал-множество + карантин конфликтов, HLC-правило `at`, вектор — непрерывный префикс, реестр сегментов; `FolderSync` (`<dir>/<deviceId>/seg-*.jsonl` + `head.json`); `sync.folder.*`, `sync.getConflicts` | M4 | property: слияние коммутативно, ассоциативно, идемпотентно; сходимость 4 устройств; матрица отказов (16 строк); SIGKILL-тест SQLite | `report-journal-sync.md`: 65 тестов; четыре дыры v0 найдены и исправлены; iCloud/Syncthing/Dropbox не проверялись |

### 1.2 Что изменили спайки F-слоя в дизайне v0

1. **SQL-раннер: процесс, не worker.** `worker.terminate()` не прерывает запрос в `sqlite3_step`, `process.exit()` зависает, `interrupt` нет ни у `node:sqlite`, ни у better-sqlite3; kill процесса — 1–8 мс [ИЗМЕРЕНО]. Правки: §6a.4, §9, M5. Формулировка v0 «завершение worker по тайм-ауту» неверна.
2. **Время событий: HLC-правило вместо зажима.** `at ≤ now + 5 мин` не защищает порядок от перекоса часов (≥ 60 с) и шага часов назад [ИЗМЕРЕНО]. Правки: §5.1.
3. **Слияние: карантин вместо «отклонить».** Правило «отклонить конфликтующую запись» не коммутативно (контрпример fast-check) [ИЗМЕРЕНО]. Правки: §5.1, §9.
4. **Дельта-экспорт: непрерывный префикс и реестр сегментов.** Вектор `maxSeq` пропускает переставленные файлы и подменённый диапазон seq; клон и восстановление `deviceId` тихо теряют публикацию [ИЗМЕРЕНО]. Правки: §5.1, §6a.6.
5. **Долговечность: FULL + `fullfsync`.** SIGKILL-тест не отличает NORMAL от FULL; на macOS `fullfsync` выключен по умолчанию, и FULL без него почти бесполезен для носителя [ИЗМЕРЕНО]. Правки: NF2, §5.1.
6. **Числа.** Чтение 500k строк с маппингом в `LogEntry` — 0.21 с, не 0.1 с (§2).
7. **F4: неявный повтор выключен по умолчанию.** Плотные рёбра `encompassed = зависимости @1.0` дают 144 обновления на попытку и rebuild 500k = 17.6 с; если неявного повтора в реальности нет, удержание падает вдвое [ИЗМЕРЕНО в модели] (§6a.2).
8. **Гейт фронтира.** Спайки прочли `passes_threshold` при отсутствии данных по-разному (`None → true` против «нетронутая зависимость блокирует»). `getFrontier` определён как «нет данных = закрыто» и сверяется дифференциально с Rust на M3 [НЕ ПОДТВЕРЖДЕНО].
9. **Образцовый курс неполон.** Все 21 вопрос `sql-course` ссылаются на несуществующие `fixtures/*.sql` и `*.expected.csv`, ключ проверки — `check:`, а не `engine.verification`. Правка: миграция на M1; канонический формат — `engine.verification`.

## 2. Оценки масштаба

| Величина | Допущение / измерение | Результат | Что следует |
|---|---|---|---|
| Библиотека | верх замеров: 3 000 уроков × 3–5 упражнений, ≈ 9 000 рёбер | 15 001 манифест [ИЗМЕРЕНО] | вся библиотека в памяти |
| Открытие библиотеки | Node 22, macOS arm64, кэш ОС горячий | async 0.50 с; sync 0.31–0.34 с; zod ≈ +10 мс; циклы ≈ 1 мс; редукция ≈ 1 мс; обход как у планировщика 1.5–3.5 мс [ИЗМЕРЕНО]; холодный диск не мерили | snapshot-кэш не нужен; sync-загрузка в utilityProcess быстрее и легче по RSS (129 против 209 МБ) |
| События | 300 попыток/день (пик) | 1.1·10⁵ в год, 5.5·10⁵ за 5 лет [ОЦЕНКА] | читаем журнал при старте целиком |
| Чтение журнала | 500k строк `ORDER BY at, device_id, seq` | better-sqlite3: `.all()` 77–104 мс без разбора строк; с маппингом в `LogEntry` 210 мс (тёплый кэш); `integrity_check` 838 мс [ИЗМЕРЕНО] | старт с реплеем без снапшотов |
| Размер БД | 150–200 Б/строка с индексами | 80–110 МБ за 5 лет [ОЦЕНКА] | без сжатия журнала |
| Запись | 300 autocommit-INSERT (WAL, NORMAL) | 3 мс, то есть ≈ 10 мкс/строка [ИЗМЕРЕНО] | синхронная запись в одной итерации event loop |
| Память проекций | ≤ 20 попыток на упражнение ≈ 1 КБ; ≤ 20 наград на юнит | ≤ 15 МБ + ≤ 3 МБ при 15 000 упражнений [ОЦЕНКА] | |
| Скоринг упражнения | ts-fsrs `next_state`, 20 обзоров | 3.84 мкс; `next()` — 28 мкс [ИЗМЕРЕНО] | холодный проход 15 000 упражнений: 58 мс против 421 мс |
| Батч | Rust: 2–8 мс тёплый, 54 мс первый при полностью освоенном графе [ИЗМЕРЕНО ранее] | TS: ×3–10 ⇒ 10–100 мс [ОЦЕНКА, не мерили] | бюджет NF1 проверить на M3 |
| Полезная нагрузка IPC | батч ≤ 60 упражнений × ≈ 1 КБ | ≈ 60 КБ [ОЦЕНКА]; 30 МБ одним `postMessage` — 158 мс [ИЗМЕРЕНО] | пагинация всех списков, тексты ассетов по запросу |
| Холодный старт целиком | библиотека 0.03 с (артефакт) или 0.3–0.6 с (каталог) + журнал 0.21 с + первый проход 0.06 с | ≈ 0.3 с с артефактом, ≈ 0.6–0.9 с без [ВЫВОД по суммам замеров] | в utilityProcess не блокирует UI |
| Компилятор курса | 3 000 уроков × 4 упражнения, Node 22, тёплый кэш | полный compile 0.75 с (KB) / 1.2 с (JSON); артефакт JSON 6.7 МиБ грузится 33 мс против 368 / 590 мс из каталога; проверка свежести по stat 35 мс (12k файлов) / 126 мс (40k), по содержимому 97 / 405 мс [ИЗМЕРЕНО] | компиляция в фоне при открытии; артефакт — быстрый путь |
| Неявный повтор (FIRe) | журнал 500k событий, 1 500 уроков × 4 упражнения | rebuild: 0.4 с без кредита, 1.1 с при разреженных явных `encompassed` (5.5 обновления на попытку), 17.6 с при «зависимость = охват @1.0» (144 обновления); инкремент 0.5 / 2.1 / 35 мкс на событие [ИЗМЕРЕНО] | кредит только по явным рёбрам, выключен по умолчанию |
| План дня | 40 позиций из due-набора 500–5 000 | 1.6–2.7 мс без кредита; 8–23 мс в плотном режиме [ИЗМЕРЕНО] | укладывается в NF1 |
| Диагностика | 3 000 тем, выбор пробы | ≤ 0.33 мс у V3; до 22 мс у V2 при жёстком замыкании [ИЗМЕРЕНО]; `answer()` отдельно не мерили | не блокирует |
| Проверка SQL | прогретый пул, фикстура 9 строк | 0.06–0.15 мс на проверку; свежий worker 23–26 мс; свежий процесс 44–47 мс; kill 1–8 мс [ИЗМЕРЕНО] | пул процессов, не процесс на проверку |
| Синхронизация папкой | 500k записей, один писатель | импорт ≈ 0.6 М зап/с (0.83 с); экспорт 180–470k зап/с при 1k–50k записей в сегменте; 184 Б на запись JSONL; head ≈ 160 Б на сегмент [ИЗМЕРЕНО] | сегмент на сессию, компактация старше 30 суток |
| Запись с fsync | коммит одной записи, macOS | NORMAL 0.018 мс; FULL без `fullfsync` 0.054 мс; FULL + `fullfsync` 3.0 мс [ИЗМЕРЕНО] | FULL + `fullfsync` по умолчанию |

## 3. Что сохраняем из Trane и что меняем

Модули Rust (LOC без тестов, комментариев и пустых строк) → модули TS. Полные спеки: `engine-ts/research/spec-*.md`.

| Rust | LOC | TS (`packages/engine/src/…`) | Изменение |
|---|---|---|---|
| `data.rs` (манифесты, `MasteryScore`, `ExerciseTrial`…) | 675 | `domain/manifest/*`, `domain/types.ts` | wire-совместимо; расширение `engine`; время в мс; мягкий парсинг + строгий lint |
| `graph.rs` | 479 | `domain/graph/unitGraph.ts`, `validate.ts` | + избыточные рёбра, недостающие ссылки; порядок вставки детерминирован |
| `course_library.rs` | 464 | `library/loader.ts`, `library/courseLibrary.ts`, порт `CourseSource` | async, сортировка обхода, сбор всех диагностик, только `*.json` в служебных каталогах |
| `data/course_generator/knowledge_base.rs` | 481 | `library/generators/knowledgeBase.ts` | порт; Literacy/Transcription не переносятся |
| `exercise_scorer.rs` | 281 | `scoring/powerLawScorer.ts`, `scoring/performance.ts` | эталон + общий модуль «performance»; переключатель `precision` (f64/f32-двойник) |
| — | — | `scoring/fsrsScorer.ts`, `scoring/memoryModel.ts` | новое |
| `reward_scorer.rs` | 87 | `scoring/rewardScorer.ts` | 1:1, мс |
| `scheduler/reward_propagator.rs` | 108 | `scheduler/rewardPropagator.ts` | 1:1 |
| `scheduler/unit_scorer.rs` | 509 | `scheduler/unitScorer.ts` | опции из общего holder; `Clock` |
| `scheduler/review_knocker.rs` | 158 | `scheduler/reviewKnocker.ts` | 1:1; переименованы карты весов |
| `scheduler/filter.rs` | 201 | `scheduler/candidateFilter.ts` | `Rng`, взвешенная выборка A-ExpJ, `precision`-двойник для квот окон |
| `scheduler/relearn_pile.rs`, `shuffler.rs` | 47, 58 | `scheduler/relearnPile.ts`, `shuffler.ts` | `Rng` |
| `scheduler.rs` | 839 | `scheduler/depthFirstScheduler.ts` | `Clock` вместо `Utc::now()` в study sessions; фронтир и due наружу |
| `scheduler/data.rs` | 310 | `scheduler/schedulerData.ts` | интерфейсы вместо `Arc<RwLock<dyn>>` |
| `data/filter.rs` | 237 | `domain/filter/*`, `wire.ts` | DTO camelCase + кодек Trane wire |
| `filter_manager`, `study_session_manager`, `preferences_manager` | ≈ 200 | `settings/*`, порт `SettingsStore` | атомарная запись, только `*.json` |
| `practice_stats`, `practice_rewards`, `practice_deltas`, `blacklist`, `review_list` | ≈ 740 | `state/eventLog.ts`, `state/projections/*` | журнал событий + проекции |
| `lib.rs` (`Trane`) | 553 | `app/engine.ts`, `app/services/*` | async DTO-фасад из сервисов |
| `test_utils.rs`, `benchmark.rs` | — | `testing/*` | порт: билдеры курсов, профили студентов |

**Сохраняется (поведение подтверждается golden/портированными тестами):** модель данных и wire-формат манифестов; правила графа (dependency sinks, стартовые уроки, `superseded`, encompassed по умолчанию = зависимости с весом 1.0); весь планировщик — DFS, `passes_threshold` (`min_score` 3.0 и `min_avg_trials` 1.8), `dead_end`, `select_candidates`, `max_lessons_in_progress`, knocker, candidate filter (окна 20/20/30/20/10, поправка на success rate, взвешенная выборка без возвращения), relearn pile, shuffler; агрегаты упражнение → урок → курс (среднее) с кэшем 2 ч; rewards и их применение (≥ 3 попыток); фильтры и study sessions; фасад, разбитый по обязанностям.

**Меняется:**
- Скорер: `PowerLawScorer` → `FsrsScorer` за тем же интерфейсом (FSRS ставит калиброванную вероятность, у Trane она хуже константы — `docs/research/fsrs-vs-trane.md`).
- Состояние ученика: SQLite-таблицы `practice_*` с побочными эффектами записи → журнал + проекции. Причина — порядко-зависимый replay Trane (расхождение оценки до 1.1–1.2 при перестановке одних и тех же событий, `fsrs-in-trane.md` §3).
- Время: секунды → миллисекунды; `Clock` вместо `Utc::now()`/`override_current_timestamp`; сидируемый `Rng` вместо thread RNG.
- Опции планировщика: единый holder. В Rust `set_scheduler_options` обновляет только копию в `DepthFirstScheduler`, а `UnitScorer`, `CandidateFilter`, `ReviewKnocker`, `RelearnPile` держат устаревшие клоны [ИЗМЕРЕНО чтением спеки].
- Загрузка: fail-fast «всё или ничего» → сбор всех диагностик за проход (строго по умолчанию), детерминированный порядок обхода.
- Каталог данных: `.trane` внутри библиотеки → отдельный `dataDir` (в Electron — каталог профиля).
- API: синхронные Rust-трейты → async-фасад с сервисами и типизированными ошибками.

**Добавляется:** запросы фронтира и due; `Verifier`; attempt sessions; примитивы синхронизации и импорт `.trane`; расширение манифестов `engine`; диагностика движка.

**Убирается:** Literacy/Transcription/SoundSlice, `course_builder` как публичный API, `benchmark` как бинарь (остаются симуляции для тестов), `SerializedCourseLibrary`, `practice_deltas` (не воспроизводимы из журнала: считаются относительно часов планировщика; `num_deltas` в Rust вообще не читается).

**Поправки к прежним отчётам (найдено при чтении спек):** неявная зависимость урок → курс в графе не хранится (реализована исключением из `dependency_sinks` и логикой стартовых уроков); режим «encompassed = зависимости» включается глобально, если ни один манифест не задаёт `encompassed`; загрузка в Rust «всё или ничего», а `filter_manager`/`study_session_manager` падают на любом файле в каталоге, включая `.DS_Store`; `remove_*_with_prefix` использует SQL `LIKE` с подстановочными `_` и `%`; `ORDER BY timestamp DESC` без тай-брейка.

## 4. Высокоуровневый дизайн

Схема: `engine-ts-diagram.html`. Стиль — порты и адаптеры (hexagonal): домен чистый и синхронный, I/O только на границах.

```
@dolphy-app/engine-contract     типы DTO, коды ошибок, CONTRACT_VERSION   (renderer-safe, import type)
        ▲
@dolphy-app/engine              domain ──► scoring ──► scheduler ──► app (LearningEngine, сервисы)
        │                  модули F-слоя: authoring/ (F1, F2), placement/ (F3), planning/ (F4, F6),
        │                                 verify/ (порт F5), sync/ (F7)
        │                  порты: CourseSource, EventStore, SettingsStore, Clock, Rng, IdGenerator,
        │                         Logger, Verifier, MemoryModel
        │                  адаптеры без нативного кода: NodeFsCourseSource, MemoryEventStore, JsonSettingsStore,
        │                         SystemClock, CryptoRng, Uuidv7Generator, FolderSync   (subpath ./node)
@dolphy-app/engine-sqlite       SqliteEventStore, миграции, порт SqlDatabase (better-sqlite3 13.0.3)   ← типы портов из @dolphy-app/engine
@dolphy-app/engine-sql-runner   SqlVerifier (реализует порт Verifier), пул дочерних процессов, раннер на node:sqlite   ← типы портов из @dolphy-app/engine
@dolphy-app/engine-rpc          client (renderer) / host (диспетчер, zod), MessageEndpoint, in-process пара   ← типы из @dolphy-app/engine-contract
@dolphy-app/testkit             FakeClock, SeededRng, TestId, билдеры курсов и журнала (dev-пакет, не публикуется)
apps/desktop (позже)     main (супервизор) / utilityProcess-хост движка / preload / renderer
```

**Корень композиции** (в `@dolphy-app/engine`; SQLite подключает приложение, чтобы ядро осталось без нативных зависимостей):

```ts
export interface EngineDeps {
  clock: Clock; rng: Rng; ids: IdGenerator; logger: Logger;
  courseSource: CourseSource; eventStore: EventStore; settings: SettingsStore;
  memoryModel: MemoryModel; verifiers: readonly Verifier[];   // SqlVerifier из @dolphy-app/engine-sql-runner регистрируется здесь
}
export async function createEngine(deps: EngineDeps, config: EngineConfig): Promise<LearningEngine>;
// EngineConfig = { libraryRoot, dataDir, durability?: 'full' | 'normal', authorMode?: boolean } — тип из @dolphy-app/engine-contract;
// хост: createEngine({ ...nodeDefaults(), eventStore: openSqliteEventStore({ path }), verifiers: [new SqlVerifier(...)] }, config)
```

**Поток записи попытки** (`PracticeService.recordAttempt`, аналог `score_exercise`):
1. Проверить: упражнение есть в библиотеке; `grade ∈ 1..5`; `at` по HLC-правилу (§5.1): `max(min(now, now + 5 мин), maxAtУвиденный + 1, свойПрошлыйAt)`.
2. Собрать событие: `id = requestId ?? uuidv7()`, `deviceId`, `seq = next()`, `at`, `recordedAt = now`.
3. `eventStore.append([event])` — одна транзакция, дубликат `id` даёт прежний результат (идемпотентность).
4. Применить к проекциям: попытки упражнения, награды по графу (чистая функция события и графа). Если событие старше последнего применённого для затронутых упражнений, перестроить их проекции, иначе O(1).
5. Сбросить кэши `UnitScorer` (упражнение → урок → курс, затронутые награды); обновить relearn pile и success rate.
6. Отправить событие `progress`.
Сбой на шаге 3: состояние не изменилось. Сбой на 4–6: движок помечает себя `dirty` и перестраивает проекции при следующем чтении. Вся секция 2–6 синхронна в одной итерации event loop, гонок между командами нет.

**Поток `getBatch`:** фильтр/сессия → DFS по графу с `UnitScorer` (`FsrsScorer`: реплей ≤ 20 попыток → R) → `ReviewKnocker` → `CandidateFilter` (окна × success rate, взвешенная выборка `Rng`) → relearn pile → `Shuffler` → манифесты в `ExerciseDto`, `frequencyMap++`. Вызов не идемпотентен (RNG и счётчик показов), UI кэширует результат.

**Поток `plan.getDay`** (M6; область курсов `courseIds` сужает все три источника — просроченное, новое и ремедиацию — как blacklist, но без записи в журнал, API §4.1): `getDue` и `getFrontier` (плюс неявный кредит, если включён) → жадное покрытие или «наименьшая R первой» → резерв под новое → интерливинг → `DayPlanDto`. Вызов — чистая функция состояния и `seed`: не меняет `frequencyMap` и `SessionState`, в отличие от `getBatch`.

| Компонент | Какое требование или число обслуживает |
|---|---|
| `@dolphy-app/engine-contract` | FR/NFR6: renderer импортирует только типы, не тянет `ts-fsrs` и fs |
| Домен и планировщик (порт Trane) | FR1–FR3, NF5: поведение и wire Trane |
| `FsrsScorer` + `MemoryModel` | FR3/FR5: калиброванная R; NF: `next_state` 7× быстрее `next()` |
| `EventStore` + проекции | FR4, FR8, NF2, NF3: журнал — единственный факт |
| `SqliteEventStore` | NF2: WAL, транзакции; 500k строк читаются за ≈ 0.2 с с маппингом (0.08 с без него) |
| `SettingsStore` | FR6: фильтры, сессии, предпочтения в JSON (формат Trane) |
| `Verifier` (порт) | FR7: детерминированная проверка вместо самооценки |
| `Clock`, `Rng`, `IdGenerator` | NF3, NF6: воспроизводимые тесты |
| `LearningEngine` (фасад) | граница с UI: async, DTO, коды ошибок |
| `authoring/` (компилятор, артефакт) | FR2, FR12 (F1, F2): все диагностики за проход, загрузка артефакта 33 мс |
| `placement/` | FR10 (F3): 20–40 проб на 3 000 тем, выбор пробы ≤ 0.33 мс |
| `planning/` (план дня, интерливинг, `RemediationTracker`, `MemoryIndex`) | FR9, FR11 (F4, F6): план на 40 позиций 1.6–2.7 мс |
| `SqlVerifier` (`@dolphy-app/engine-sql-runner`) | FR7 (F5): изоляция процессом, kill 1–8 мс |
| `sync/` (`Replica`, `FolderSync`) | FR8 (F7): слияние без сервера, сходимость 4 устройств |

## 5. Модель данных

### 5.1 Журнал событий (единственный первичный факт)

```ts
type LogEntry = AttemptEntry | UnitFlagEntry | ProgressResetEntry;
interface EntryBase { id: string /* uuidv7 */; deviceId: string; seq: number /* по устройству, без пропусков */;
                      at: number /* мс, время события */; recordedAt: number /* мс, wall-clock записи */ }
interface AttemptEntry extends EntryBase { kind: 'attempt'; exerciseId: string; grade: 1|2|3|4|5;
                      source: 'self' | 'runner' | 'placement' | 'trane-import' }
interface UnitFlagEntry extends EntryBase { kind: 'unit_flag'; unitId: string;
                      flag: 'blacklist' | 'review'; op: 'set' | 'unset' }
interface ProgressResetEntry extends EntryBase { kind: 'progress_reset'; unitId: string /* курс, урок или упражнение */;
                     libraryRevision?: string /* revision артефакта на момент записи; диагностика расхождения версий курса, хранится в extra */ }
```

SQLite (`PRAGMA journal_mode=WAL`, `synchronous=FULL` и `fullfsync=ON` на macOS по умолчанию — опция `durability: 'normal'` даёт `NORMAL`; `foreign_keys=ON`, версия схемы в `PRAGMA user_version`, миграции — обычные `.sql`-строки):

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;   -- device_id, created_at
CREATE TABLE log_entry (
  device_id TEXT NOT NULL, seq INTEGER NOT NULL,
  id TEXT NOT NULL UNIQUE,                       -- идемпотентность записи и импорта
  kind TEXT NOT NULL CHECK (kind IN ('attempt','unit_flag','progress_reset')),
  at INTEGER NOT NULL, recorded_at INTEGER NOT NULL,
  unit_id TEXT NOT NULL,                         -- exerciseId или unitId
  grade INTEGER, source TEXT,                    -- attempt
  flag TEXT, op TEXT,                            -- unit_flag
  extra TEXT,                                    -- JSON, прямая совместимость
  PRIMARY KEY (device_id, seq),
  CHECK ((kind='attempt' AND grade BETWEEN 1 AND 5 AND source IS NOT NULL)
      OR (kind='unit_flag' AND flag IS NOT NULL AND op IN ('set','unset'))
      OR (kind='progress_reset'))
) STRICT;
CREATE INDEX log_order ON log_entry (at, device_id, seq);      -- порядок проекций
CREATE INDEX log_unit  ON log_entry (unit_id, at, device_id, seq);
-- Записи, попавшие в конфликт (`id-content`, `seq-two-ids`) или в карантин по часам (`clock-skew`), переносятся сюда
-- и скрыты от проекций. Решение пользователя (`resolveConflict`) локально и переживает повторный импорт.
-- [ВЫВОД: в спайке конфликты хранились в памяти; эта схема не проверялась]
CREATE TABLE log_conflict (
  conflict_id TEXT NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('id-content','seq-two-ids','clock-skew')),
  entry_hash TEXT NOT NULL,                      -- sha256 канонического JSON записи
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','kept','discarded')),
  id TEXT NOT NULL, device_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL,
  detected_at INTEGER NOT NULL, PRIMARY KEY (conflict_id, entry_hash)
) STRICT;
-- Реестр применённых сегментов FolderSync: повторное использование диапазона seq видно по другому sha256.
-- [ВЫВОД: в спайке реестр был в памяти; после рестарта без него импорт перечитывает всё, ≈ 0.8 с на 500k]
CREATE TABLE imported_segment (
  device_id TEXT NOT NULL, name TEXT NOT NULL, sha256 TEXT NOT NULL,
  first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL, imported_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, name, sha256)
) STRICT;
```

Порядок событий везде **`(at, deviceId, seq)`**; при равенстве `(deviceId, seq)` (бывает только при конфликте) последним ключом идёт `id` (в Trane тай-брейка не было: при равных секундах «новее» решал `rowid`).

**Время `at` при записи:** `at = max(min(now, now + 5 мин), maxAtУвиденный + 1, свойПрошлыйAt)` (HLC-подобное правило). Один зажим `now + 5 мин` порядок не защищает: устройство с часами на сутки вперёд пишет записи, которые побеждают сброс и `unset` с верных часов, а шаг часов назад делает новую попытку «старше» собственного сброса; HLC-правило исправляет оба случая [ИЗМЕРЕНО, контрпримеры 3 и 4 в `report-journal-sync.md`]. Не измерено: устройство с часами в 2099 году отравляет `maxAtУвиденный` у всех; защита — карантин при импорте записей с `at > recordedAt + 24 ч` [ВЫВОД].

**Слияние:** состояние реплики — множество записей, `merge` — объединение по `id`. Конфликт — запись с тем же `id`, но другим содержимым (`id-content`), либо с тем же `(deviceId, seq)`, но другим `id` (`seq-two-ids`): **обе** записи уходят в `log_conflict`, скрыты от проекций, видны через `sync.getConflicts()`, проекции пересобираются полностью. Записи с `at > recordedAt + 24 ч` попадают туда же с причиной `clock-skew` [ВЫВОД, в спайке не реализовано]. Формулировка «отклонить входящую запись» не коммутативна (контрпример fast-check); множество с карантином коммутативно, ассоциативно, идемпотентно (3 000 прогонов на свойство) [ИЗМЕРЕНО]. **Решение конфликта** `sync.resolveConflict({ conflictId, keep })`: выбранная запись возвращается в `log_entry` (`kept`), остальные помечаются `discarded`; решение **локально** и переживает повторный импорт (записи с хэшем `discarded` пропускаются); репликация решений между устройствами вне v1, поэтому пока устройства решили по-разному, их проекции могут расходиться [ВЫВОД, не проверено].

**Вектор состояния** для дельта-экспорта — `{deviceId: contiguous}` (непрерывный префикс seq), не `maxSeq`: при переставленных файлах максимум пропускает дыры; список `missing` хранится отдельно. Флаги — LWW-множество по тому же порядку. **Сброс прогресса** (аналог `remove_scores_with_prefix`, но без удаления строк): запись `progress_reset` для юнита; попытки этого юнита и всех вложенных в него упражнений с ключом порядка `≤` ключа сброса игнорируются проекциями; сброс курса или префикса раскрывается в записи по верхнеуровневым юнитам при вызове (обычно одна запись). Проекция зависит от графа курса: если обновление курса перенесло упражнение в другой урок, устройства с разными версиями курса получат разные проекции; `libraryRevision` в записи нужен, чтобы это расхождение диагностировать [ИЗМЕРЕНО тестом; решение — ВЫВОД].

### 5.2 Проекции в памяти (всё выводится из журнала)

| Проекция | Содержимое | Трансформация относительно Trane |
|---|---|---|
| `AttemptIndex` | на упражнение: последние N=20 неотменённых попыток (не покрытых `progress_reset`) по убыванию `(at,…)` и их число | замена `practice_stats.get_scores` |
| `RewardIndex` | на юнит: ≤ 20 наград `{value, weight, at}` | чистая функция `(событие, граф)`; дедуп «похожих» наград детерминированный на отсортированной последовательности (в Rust — кэш в памяти процесса, обнулялся при рестарте) |
| `FlagState` | множества blacklist и review list | LWW по `(at, deviceId, seq)`; `removePrefix` раскрывается в id при вызове |
| `MemoryIndex` | на упражнение `{S, D, lastAt}`; только при включённом неявном повторе: обновляется реальными попытками (`step`) и кредитом по `encompassed` (`stepFractional`) | реплей журнала целиком: 1.1 с на 500k событий при разреженных явных рёбрах; `FsrsScorer` берёт состояние отсюда вместо реплея окна из 20 попыток [ВЫВОД] |
| `SessionState` | `frequencyMap`, relearn pile, счётчики success/fail | эфемерно, как в Rust; сбрасывается `startSession()` |

**Rebuild:** потоково читать журнал `ORDER BY at, device_id, seq`, сложить проекции, сбросить кэши. Выполняется при открытии, после импорта событий старше применённых, при появлении конфликта и при `dirty`. Инвариант: инкрементальное применение в любом порядке (с дубликатами) даёт то же состояние, что полный rebuild; быстрый путь — хронологический приход (0 пересчётов для попыток и флагов), запись старше применённых пересчитывает свой юнит [ИЗМЕРЕНО property-тестами `journal-sync`].

### 5.3 Файлы на диске

`dataDir/engine.db` (журнал), `dataDir/settings/user_preferences.json`, `dataDir/settings/filters/*.json`, `dataDir/settings/study_sessions/*.json` — те же wire-форматы, что у Trane, запись атомарная (tmp + rename), читаются только `*.json`. Библиотека курсов остаётся read-only и может лежать в Git. Импорт существующего `.trane/*.db` в журнал — `sync.importFromTrane(path)`; секунды ×1000, `source: 'trane-import'`.

### 5.4 Манифесты и расширение `engine`

Базовые поля — wire Trane (serde-совместимо: внешне тегированные enum, `Option` как отсутствие или `null`, неизвестные ключи вырезаются). Наши расширения — в необязательном объекте `engine`, который Trane игнорирует, поэтому курс работает и в Trane (без проверки и ремедиации):

```json
{ "id": "sql::window::rank::q1", "lesson_id": "sql::window::rank", "course_id": "sql",
  "exercise_asset": { "FlashcardAsset": { "front_path": "q1.front.md" } },
  "engine": { "verification": { "runner": "sql", "fixture": "fixtures/emp.sql",
                                 "expected": "checks/rank-1.csv", "timeoutMs": 2000 },
              "keyPrerequisites": ["sql::window::over"], "tags": ["window"] } }
```

Парсинг мягкий (как serde), а строгая схема отдельно порождает предупреждения `W_UNKNOWN_KEY` (каталог кодов компилятора, §6a.1) — опечатки ловятся, чужие курсы не ломаются. Особенности, потребовавшие кода [ИЗМЕРЕНО, `report-loader-bench.md`]: enum-обёртка строго с одним ключом, читаемые сообщения вместо `invalid_union` zod, `Option` = отсутствие или `null`, семантика `join` путей (ведущий `/`, `..` у корня, завершающий `/` — ошибка), вес `encompassed` сравнивается как f32.

## 6. Скоринг: FSRS внутри Trane-архитектуры

**Порт памяти** (изолирует API ts-fsrs, у которого идёт линия 6.0.0-beta):

```ts
interface MemoryState { readonly stability: number; readonly difficulty: number }
interface MemoryModel {
  readonly id: string;                                    // 'fsrs-6/ts-fsrs@5.4.2/w:<hash>'
  step(state: MemoryState | null, wholeDays: number, rating: 1|2|3|4): MemoryState;
  retrievability(state: MemoryState, days: number): number;   // дробные дни
}
```

Реализация на ts-fsrs 5.4.2 по проверенному рецепту (`report-fsrs-check.md`): один экземпляр `fsrs({ enable_short_term: true, learning_steps: [], relearning_steps: [], enable_fuzz: false, maximum_interval: 36500 })`; шаг = `alg.next_state(state, t, rating)` с `t = max(0, floor((at_i − at_{i−1}) / 86 400 000))`, первый `t = 0`; `R = alg.forgetting_curve(max(0, now − lastAt) / 86 400 000, stability)`. Почему не `next()`:
- `next()` считает `elapsed_days` по разнице календарных UTC-дат, а не по 24-часовому окну; на 47% интервалов (8 416 из 17 964) результат расходится с py-fsrs, у 584 из 600 историй stability отличается до 2.17 [ИЗМЕРЕНО];
- `next()` для Review-карточки считает сразу четыре оценки: 28 мкс против 3.84 мкс на 20 обзоров [ИЗМЕРЕНО];
- `get_retrievability` округляет возраст вниз до целых дней и по умолчанию возвращает строку.
`next_state` с `t = floor(Δ/24 ч)` совпадает с py-fsrs 6.3.2: относительная ошибка stability ≤ 1.4e-7, ошибка R ≤ 7e-9 на 600 историях (18 564 обзора) [ИЗМЕРЕНО]. Риск: `next_state` — метод публичного класса, но не описанный как стабильный API; защита — pin точной версии, контрактные тесты на эталоне py-fsrs (`fsrs-check/fixtures/reference.json`), порт `MemoryModel`.

**`FsrsScorer` (вариант H, значение по умолчанию):** по историям упражнения (≤ N = 20 последних, по убыванию времени; при `now < последней попытки` возраст зажимается в 0):
1. пусто → `value 0`, `urgency 1`, `velocity` не задан;
2. реплей попыток по возрастанию через `MemoryModel.step` (оценка → рейтинг по `RatingMap`);
3. `R = retrievability(state, дни с последней попытки)`;
4. `performance` = взвешенная оценка `0.8·time_avg + 0.2·pos_avg` из `PowerLawScorer`, посчитанная «во время последней попытки»; `velocity` — наклон OLS тех же оценок;
5. `value = clamp(R × performance, 0, 5)`, `urgency = 1 − R`.
Дальше как в Trane: `final = clamp(value + reward, 0, 5)`, если `applyReward` (≥ 3 попыток), урок и курс — среднее. Почему H, а не «чистый» вариант P (`5·R·min(1, S/2)`): P почти не отличает Hard от Good и после одного `Four` сразу даёт 5.0; H держит калибровку окон и ворот Trane (`fsrs-in-trane.md` §4). Запас H на воротах тонкий (2.968 против порога 3.0 в сценарии S3), поэтому маппинг и параметры — конфигурация под контрактными тестами.

**`RatingMap`:** `runner` (1–2 → Again, 3–4 → Hard, 5 → Good) по умолчанию; `anki` (1–2 → Again, 3 → Hard, 4 → Good, 5 → Easy) для самооценки. Выбирать по данным на M2 [НЕ ПОДТВЕРЖДЕНО]. **Окно:** `numTrials = 20` достаточно — усечение до 20 попыток не меняет Log Loss больше чем на 0.0002 (29 пользователей Anki); окно ≤ 10 вредно [ИЗМЕРЕНО]. Кэш оценок жив 2 ч, как в Trane.

**Rewards (FIRe-подобное распространение)** переносятся без изменений и по-прежнему прибавляются к `value`; они не меняют состояние FSRS. Неявный повтор поверх FSRS (частичный кредит охваченным урокам) — отдельное расширение за флагом, §6a.2.

**Точность чисел:** продукция — f64; модули с чувствительными порогами (`PowerLawScorer`, `CandidateFilter`, `selectCandidates`) содержат переключатель `precision: 'f64' | 'f32'` (f32-двойник через `Math.fround`) только для сверки с Rust. Обоснование замерами: f32-двойник совпадает с Rust на 5 829 кейсах (velocity бит-в-бит, value/urgency ≤ 1 ulp, 0 пересечений порогов); чистый f64 даёт 3 флипа условия «old-good floor» и 7 ничьих на порогах; квота окна `current` при success rate > 0.9 и `batch_size = 50` — 15 в f32 и 14 в наивном f64 [ИЗМЕРЕНО].

**Оптимизация параметров** — порт `ParameterTrainer` (M7): `@open-spaced-repetition/binding` 0.5.0 (napi, бета) в отдельном процессе; невалидный item убивает процесс (panic → abort), поэтому валидировать вход заранее; параметр `timeout` — интервал опроса прогресса, а не дедлайн [ИЗМЕРЕНО]. Без данных используются `default_w`.

## 6a. Слой F1–F7: решения по результатам спайков

Общий принцип: логика F-слоя — чистые функции над проекциями и графом, порты и адаптеры те же, что в §4. Новые модули `@dolphy-app/engine`: `authoring/` (F1, F2), `placement/` (F3), `planning/` (F4, F6), `verify/` (порт F5), `sync/` (F7); раннер SQL — пакет `@dolphy-app/engine-sql-runner`. Числа — из `research/report-*.md`; все симуляции синтетические, круговость указана рядом с числом.

### 6a.1 Курс и компилятор (F1, F2) — `report-compiler.md`

- **Авторинг (F1).** Курс — каталог в раскладке Trane: JSON-манифесты или KB-генератор `<lesson>.lesson/` (Markdown-материал, `<ex>.front.md`/`.back.md`, `lesson.dependencies.json`, `lesson.encompassed.json`). Расширение `engine` (`verification {runner, timeoutMs, …}`, `keyPrerequisites`, `tags`, `bloom`, `dok`; на курсе `requiresChecks`, на уроке `nonAncestor`) читается из YAML-frontmatter в начале `<ex>.front.md`, из `lesson.engine.json` или из ключа `engine` манифеста. Канонический формат один — `engine.verification`; ключ `check:` старого `sql-course` даёт `W_UNKNOWN_KEY` и переносится на M1. `library.readAsset` срезает frontmatter; Rust-Trane видит его как текст карточки [НЕ ПОДТВЕРЖДЕНО прогоном Rust на таком курсе — тест M1].
- **Компилятор (F2):** `compile(dir) → {diagnostics, artifact?}`. 36 кодов `E_*/W_*/I_*` (каталог — `report-compiler.md` §3.1), каждая проверка — маленькая чистая функция, все диагностики за один проход (Trane останавливается на первой ошибке): циклы dependency/superseded/encompassed с полным путём (`E_CYCLE_*`), транзитивно избыточные рёбра (`W_REDUNDANT_EDGE`), вес `encompassed` вне [0, 1] (`E_ENC_WEIGHT`), цель `encompassed` не предок (`E_ENC_NOT_ANCESTOR`), упражнение без проверки в курсе с `requiresChecks` (`E_NO_VERIFICATION`, иначе `I_NO_VERIFICATION`), `keyPrerequisites` не предки (`E_KEYPREREQ_NOT_ANCESTOR`), `W_FAN_IN` (> 7 пререквизитов), `W_ORPHAN_LESSON`, ассеты за корнем библиотеки, включая симлинки (`E_ASSET_ESCAPES_ROOT`), неподдерживаемые генераторы (`W_UNSUPPORTED_GENERATOR`). Два кода добавляются сверх спайка: `W_GRANULARITY` (в уроке меньше 3 или больше 12 упражнений; пороги — `engine.granularity` курса, значения по умолчанию не калибровались) и `E_REFERENCE_FAILS` (эталонное решение не проходит собственную проверку; нужен `Verifier`, только с `--run-checks`; ловит и `fixture_error`/`expected_error` раннера).
- **YAML:** пакет `yaml` 2.9.1 только в компиляторе: 12 000 блоков — 425 мс против 25 мс у мини-парсера при идентичном выводе; в рантайме YAML не разбирается (`engine` берётся из артефакта, `readAsset` только срезает блок), поэтому мини-парсер не нужен [ИЗМЕРЕНО].
- **Артефакт:** `<library>/.engine/compiled.json`: `formatVersion`, `revision`, `stat`, манифесты + `engine` + `src` (файл:строка), граф в формате CSR с флагами редукции, сводка диагностик. JSON, не `v8.serialize`: загрузка 33 мс против 45 мс при том же размере; gzip (в 18 раз меньше) — только для экспорта. Загрузка быстрее, чем из каталога, в 11 раз (KB) и 18 раз (JSON) [ИЗМЕРЕНО].
- **Свежесть:** быстрый путь — набор файлов и `(path, size, mtimeMs, ctimeMs, ino)` равны сохранённым (35 мс на 12k файлов, 126 мс на 40k); иначе content-`revision` (sha256 по отсортированным `path\0len\0bytes`, 97 / 405 мс) — источник истины. Сравнение «mtime новее артефакта» запрещено: файловые синхронизаторы и `touch -r` восстанавливают старый mtime. Проверка `git checkout`, Syncthing и Dropbox на реальных репозиториях не проводилась.
- **`library.reload()`:** свежий артефакт → `loadCompiled` (без проверки циклов); иначе `compile`; при ошибках прежний граф остаётся, наружу — диагностики; без ошибок — атомарная запись артефакта (temp + rename) и подмена графа. Компиляция идёт в хосте при открытии, в фоне; CLI `engine-cli validate|compile` — для CI репозитория курса (код выхода 1 при ошибках).
- **До внедрения:** не читать файлы дважды (сканер и `revision`), добавить `ctime` и `ino` в `stat`, реализовать `isFresh`, хранить строки подполей `engine`. Холодный кэш диска не измерялся.

### 6a.2 План дня и неявный повтор (F4) — `report-fire-plan.md`

- **Фронтир (`practice.getFrontier`):** урок не начат, и все его зависимости «проходят порог» Trane (среднее value ≥ 3.0, среднее число попыток ≥ 1.8) по данным `UnitScorer` (спайк использовал прокси `R·5`, это не value Trane). **Нет данных = закрыто.** Спайки прочли `passes_threshold` по-разному, поэтому семантика фиксируется здесь и сверяется дифференциально с Rust `get_candidates` на M3: сравнивается множество уроков-источников новых упражнений [НЕ ПОДТВЕРЖДЕНО]. До результата теста `getBatch` (паритет Trane) может показать урок, которого нет во фронтире; `getDay` берёт новое только из `getFrontier` и из начатых уроков с упражнениями без попыток.
- **`practice.getDue`:** упражнения с состоянием и `R ≤ targetRetention` (0.9), `need = 1 − R`; `courseIds` оставляет упражнения выбранных курсов.
- **`plan.getDay({maxItems, seed?, courseIds?})` (M6):** due по возрастанию R (при включённом кредите — жадное покрытие, `gain = Σ min(остаток, кредит)·need`, ленивая куча); резерв `ceil(0.25·maxItems)` позиций под новое (сначала недоделанные упражнения начатых уроков, затем уроки фронтира по кругу между курсами); затем повтор упражнений начатых уроков, не прошедших порог Trane (среднее value ≥ 3.0 и среднее число попыток ≥ 1.8), даже если они не просрочены — аналог «тупиковых» уроков поиска Trane, чьи кандидаты идут в батч всегда; без этого после одного прохода план пуст до забывания, а следующие уроки закрыты порогом попыток; лимит `maxLessonsInProgress` в плане не применяется; интерливинг — не более 2 подряд из одного курса, общие теги разнесены на ≥ 2 позиции, если выполнимо (флаг `interleaveOk`); детерминизм по (состояние, seed). План на 40 позиций из due-набора 500–5 000 — 1.6–2.7 мс без кредита [ИЗМЕРЕНО]. `getBatch` остаётся портом Trane (паритет) для практики с фильтрами и сессиями; `getDay` — продуктовый путь ежедневного плана; какой из них UI зовёт по умолчанию — вопрос §12.
- **Неявный повтор** (`scheduler.implicitCredit.enabled`, по умолчанию `false`). Пройденная попытка на упражнении урока L даёт каждому охваченному уроку u вес `w_u = max по путям (∏ весов рёбер · λ^глубина)` (λ = 0.9, обрез при `w < 0.2`); каждому упражнению u с состоянием — дробный шаг `stepFractional(state, now, min(rating, Good), w_u)`: `S' = S + w(S⁺ − S)`, `R' = R + w(1 − R)`, виртуальный момент последнего обзора выбирается так, чтобы `R(now) = R'`. Свойства проверены (fast-check, 8 свойств × 3 000 прогонов): `w = 1` ≡ реальный обзор, `w = 0` ≡ тождество, R не убывает, NaN и Infinity нет; 0.30 мкс против 0.21 мкс у `step` [ИЗМЕРЕНО]. Решения по рискам: (а) кредит идёт только по **явно объявленным** `encompassed` (режим `declared`), не по автоправилу Trane «зависимость = охват @1.0» (иначе 144 обновления на попытку и rebuild 500k = 17.6 с); (б) в v1 кредит **не меняет D**: в спайке `D' = D + w(D⁺ − D)` при десятках кредитов на попытку неограниченно снижает D к 1, дрейф не измерен [ВЫВОД]; (в) провал кредита не даёт, упражнения без состояния кредита не получают.
- **Почему выключено.** Выигрыш измерен только в круговой модели (ученик подчиняется той же модели): очередь due 236 → 29, к 90-му дню введено 292 из 300 уроков против 204. Если неявного повтора в реальности нет, доля упражнений с R ≥ 0.8 падает с 0.99 до 0.42–0.47 в плотном режиме и до 0.65–0.68 в разреженном, а жадное сжатие оказывается хуже одного кредита (0.42 против 0.47). Сжатие поверх кредита добавляет лишь +5–11% введённых уроков. В разреженном режиме результат чувствителен к `minCredit`: 0.4 поднимает очередь с ≈ 80–97 до ≈ 100–140. Включать — только после A/B на реальных ответах (множитель κ на кредит, λ, `minCredit`).

### 6a.3 Диагностический вход-тест (F3) — `report-diagnostic.md`

- **API:** `placement.start({ courseIds?, budget, seed? })` → `sessionId`; `nextProbe(sessionId)` → `{ probeId, lessonId, exerciseId } | null`; `answer({ probeId, result })`, где `result` — `{ kind: 'attempt', attemptId }` (итог открытой попытки с вердиктом `Verifier`) или `{ kind: 'grade', grade }` (самооценка), «пройдено» ⇔ оценка ≥ 3; `finish({ sessionId, requestId })` → `{ known, unknown, uncertain, frontier }`; `abort`. Не более одной активной сессии на профиль, `budget` от 1 до 200, TTL сессии 24 ч (все три границы — предположения [ВЫВОД]). Состояние сессии — в памяти хоста; события пишутся одной транзакцией только в `finish` (идемпотентно по `requestId`); падение хоста до `finish` теряет сессию, журнал не затронут.
- **Метод:** темы — уроки на транзитивной редукции (расстояния зависят от неё, поэтому всегда на ней); вероятность знания по теме в логитах; проба — середина самой длинной цепочки нерешённых тем (вариант V3); **жёсткое замыкание** (pass закрывает всех предков, fail — всех потомков; λ = 1, K = ∞); тема решена при `p ≤ 0.15` или `p ≥ 0.85`; пробы не повторяются; детерминизм по (seed, ответы). Пробы берутся из упражнений с `verification` (шум ≈ 0); для проверок с угадыванием `known` требует двух независимых проходов (`minPass = 2`).
- **Что измерено** (синтетические ученики; known-множество — случайный downset, то есть замыкание угадывает структуру, которую задал сам генератор — **круговость**): N = 3 000, шум 3%: 10 проб → accuracy 85.1%, 20 → 87.5%, 40 → 89.3%, 100 → 92.3%; порога 90% за ≤ 100 проб достигают 67% учеников; N = 200: 60 проб → 90.6%. False-known при безшумных ответах 0.0% во всех ячейках; при шуме 10% и 40 пробах — 7% предсказанных `known` на N = 3 000, 18% на N = 200; `minPass = 2` снижает до 1.0% и 7.6% ценой 4–8 п.п. accuracy. Выбор пробы ≤ 0.33 мс. Мягкая пропагация (λ = 0.7, K = 3) и выбор без пропагации на больших N почти ничего не решают (12–19% за 100 проб).
- **Ограничения:** accuracy завышена большим хвостом `unknown` (читать macro-F1); предсказанный фронтир завышен (precision 0.37–0.48, recall 0.71–0.80), потому что включает `uncertain`-границу, цена — одна вводная попытка; реальные ученики нарушают downset — не измерено; доверительные интервалы не считались.
- **Применение:** для каждого `known`-урока — по 2 попытки на каждое упражнение (`grade = 4`, `source: 'placement'`, шаг 1 с): строгий гейт (value ≥ 3.0 и среднее число попыток ≥ 1.8) открывает ровно вычисленный фронтир (тесты на графе из 8 тем и на `sql-course`). Первые повторения `known`-уроков на границе попадают в ближайший план (подтверждение placement) [ВЫВОД, не измерено].

### 6a.4 Проверка ответов (F5) — `report-sql-runner.md`

- **Изоляция — пул дочерних процессов** (`child_process.fork`; в Electron — `utilityProcess`), не `worker_threads`: `worker.terminate()` не завершается, пока запрос стоит в `sqlite3_step` (нагрузка 1.00 ядра, `process.exit()` зависает), а у `node:sqlite` и better-sqlite3 нет `interrupt`. `SIGKILL` процесса — 1–8 мс, следующая проверка на новом процессе через 41–52 мс [ИЗМЕРЕНО на обеих Node и обоих драйверах].
- **Драйвер раннера:** `node:sqlite` на Node ≥ 24.15 (Electron 44 = Node 24.21): `setAuthorizer` закрывает 27 из 30 угроз батареи без эффектов, `db.limits.length` останавливает `randomblob(1e9)` за 1 мс, `defensive`. Запасной профиль (Node 22, better-sqlite3): `query_only` + read-only + префильтр. Наблюдатель RSS работает во всех профилях: порог 256–400 МБ, опрос 20 мс; при пороге 400 МБ измеренный пик 378–488 МБ; без `db.limits` (Node 22, better-sqlite3) запрос без наблюдателя занимает 1–4 ГБ, поэтому наблюдатель обязателен; `ps` на Windows нет, замена не проверялась. Префильтр — не защита: `WITH c AS (SELECT 1) DELETE FROM emp` проходит его, а лексер расходится с SQLite (NBSP, NUL). Фикстура считается **публичной** (`sqlite_master` и `pragma_*` доступны): секретов в ней нет.
- **Протокол:** `{type:'check', id, req}` → `{type:'verdict', id, verdict, rssKb}`; молчание дольше `timeoutMs + 100 мс` → kill и `error/timeout`; пул `min(4, cores − 1)`, `recycleAfter ≈ 500–1000` проверок (утечки не измерялись), респавн в фоне. Лимиты по умолчанию: `timeoutMs 2000`, `maxRows 10 000`, `maxBytes 1 МБ`, SQL ≤ 100 000 символов (кап в хосте до IPC).
- **Владелец пула и зависимости:** пулом владеет `SqlVerifier` в процессе хоста движка; детей он порождает через `child_process.fork` (внутри `utilityProcess` Electron 44.4.5 работает с `ELECTRON_RUN_AS_NODE=1` [ИЗМЕРЕНО], §12.13). `@dolphy-app/engine-sql-runner` зависит от `@dolphy-app/engine` только типами портов, как `@dolphy-app/engine-sqlite`; приложение регистрирует его в `EngineDeps.verifiers`, ядро от него не зависит.
- **Вердикт:** `passed`; `failed` (вина ученика: `mismatch`, `sql_error`, `forbidden`, `row_limit`, `byte_limit`, `sqlite_limit`) — вердикт входит в число использованных попыток и в оценку, которую `GradePolicy` считает при `completeAttempt`; `error` (не вина ученика: `fixture_error`, `expected_error`, `timeout`, `resource_kill`, `worker_crash`, `internal`) — журнал не затрагивается, повтор разрешён. `submitAnswer` сам событий не пишет: единственная запись — `completeAttempt` (или `recordAttempt` для самооценки). `timeout` и `resource_kill` не отличают бесконечный CTE ученика от медленной машины, поэтому это `error`; правило отчёта «считать `timeout` ошибкой ученика, если эталон проходит быстрее `timeoutMs/10`» не принято ради простоты, UI может предложить самооценку. Ошибка `VERIFIER_TIMEOUT` — общий дедлайн вызова `submitAnswer`, включая ожидание в очереди пула [ВЫВОД]. Ожидаемые строки (`detail`) отдаются только при `EngineConfig.authorMode`.
- **Сравнение:** мультимножество строк по умолчанию (`orderSensitive` — только при полном `ORDER BY` в эталоне); `1 == 1.0`; допуск `|a − b| ≤ tol·max(1, |a|, |b|)`, `tol = 1e-9`; `TEXT '1' ≠ INTEGER 1`. На SQLite 3.51.3 и 3.53.4 идентичны 38 из 41 проб; расходятся `sqlite_version()` и `median`/`percentile` (в эталонных решениях не использовать).
- **CI:** Node 22 (153 теста, 1 пропущен) и Node 24 (154); возможности Node 24 проверяются feature-detection, а не версией; батарея угроз — контрактный тест профиля `full`.
- **Не решено:** DDL/DML-уроки (нужен режим «скрипт + проба»); ОС-песочница раннера; Windows и Linux; смоук в настоящем Electron 44 (спайк — Node 24.21 без Electron), в том числе способ порождения процессов раннера изнутри `utilityProcess`.

### 6a.5 Ремедиация (F6) — спайка нет [ВЫВОД]

- `RemediationTracker` — проекция журнала, новых событий нет (чистая функция журнала, безопасна при синхронизации). Триггер: две подряд неудачи на упражнении E (оценка ≤ 2 или вердикт `failed`) по `AttemptIndex`. Шаги: `engine.keyPrerequisites` упражнения (компилятор проверяет, что это предки); если не заданы — прямые зависимости урока с наименьшей R. На каждый шаг — упражнения с наименьшей R (не начатые — по порядку id), всего не больше `remediation.maxItems` (3). Снятие: успех на каждом шаге после триггера.
- Проявление: `remediation.getPlan({ exerciseId })` → шаги; поле `remediation` в `RecordResultDto`, когда порог пересечён этой попыткой; элементы `reason: 'remediation'` вставляются в `getBatch` и `plan.getDay` перед новым материалом.
- Проверка: тесты на детерминизм и `rebuild == incremental`; поведение на реальных учениках не измерено, пороги (2 неудачи, 3 элемента) — предположения. В Trane ремедиации нет: отрицательные награды идут зависимым юнитам, а не пререквизитам (аудит v0.34.1).
- Границы: попытки, покрытые `progress_reset`, в триггер не входят (`AttemptIndex` их исключает). Элементы ремедиации входят в лимит плана (`maxItems`) и батча (`batchSize`), вытесняя самые низкоприоритетные новые [ВЫВОД].

### 6a.6 Синхронизация без сервера (F7) — `report-journal-sync.md`

- **Транспорт:** каждое устройство пишет только **свои** неизменяемые сегменты `<syncDir>/<deviceId>/seg-<first>-<last>.jsonl` (temp → `fsync` → `rename` → `fsync` каталога; строки — канонический JSON, sha256 воспроизводим) и `head.json` `{deviceId, maxSeq, segments[{name, firstSeq, lastSeq, count, sha256}], seen}` (атомарная замена). Подходит любая папка: файловый синхронизатор или Git (сегменты неизменны, `head.json` перезаписывается целиком).
- **Настройка:** `sync.folder.configure({ dir })` сохраняет путь в `dataDir/settings/sync.json` (JSON, запись атомарная, как остальные настройки); папка синхронизации не совпадает с `dataDir` и каталогом БД [ВЫВОД].
- **Импорт:** сегмент применяется целиком или не применяется (sha256, число строк, схема каждой строки, `deviceId`, непрерывность seq); неполные, обрезанные и испорченные остаются `pending` до следующего раунда; отчёт `{inserted, duplicates, rejected, pending, …}`. Реестр применённых сегментов `device/name#sha256` хранится в БД (`imported_segment`).
- **Защита `deviceId`:** `head.json` публикует `seen`; при старте `checkRestore()`: свой хвост в папке длиннее локального → догнать и продолжить с `maxSeq + 1`; данных нет нигде → **форк** на новый `deviceId`; `export()` бросает `SYNC_DEVICE_ID_CLASH`, если sha256 последнего объявленного сегмента не совпал с локальным (клон `deviceId`). `deviceId` хранится в `meta`, не в синхронизируемой папке. Незамеченное восстановление (пиры не видели, папка откатилась) не ловится: остаются конфликты `seq-two-ids`, реальные записи скрыты до решения пользователя.
- **Политика сегментов:** один сегмент на сессию синхронизации; компактация старше ~30 суток до ~10 000 записей (500k → 50 сегментов, head 8 КБ); размер последнего сегмента ограничен (проверка клона пересчитывает его sha256: 144 мс при 100k записей).
- **Проверено** [ИЗМЕРЕНО]: 65 тестов; 16 строк матрицы отказов (обрезка, перестановка, дубли, устаревший head, компактация, восстановление, клон) — потерь 0; сходимость 4 устройств (150 прогонов) и два OS-процесса, пишущие одновременно. Не проверено: iCloud, Syncthing, Dropbox, Git (только имитация копированием и обрезкой файлов), потеря питания, kill посреди `export()`.

## 7. API (сводка; полный контракт в `engine-ts-api.md`)

`LearningEngine` = сервисы + события + `close()`. Все методы асинхронные, вход и выход — plain-DTO, ошибки — `EngineError` с кодом.

| Сервис | Методы |
|---|---|
| `library` | `getInfo`, `getDiagnostics`, `validate`, `compile`, `reload`, `listCourses/listLessons/listExercises`, `getUnit`, `getGraph`, `matchPrefix`, `readAsset` |
| `practice` | `startSession`, `getBatch`, `beginAttempt`, `submitAnswer`, `completeAttempt`, `recordAttempt`, `getUnitScore`, `getAttempts`, `getProgress`, `getFrontier`, `getDue`, `resetProgress` |
| `curation` | `blacklist.*`, `reviewList.*`, `filters.*`, `sessions.*` |
| `settings` | `getScheduler/setScheduler/resetScheduler` (с `verify`), `getPreferences/setPreferences`, `getScorer` |
| `sync` | `getState`, `exportSince`, `import`, `rebuild`, `importFromTrane`, `getConflicts`, `resolveConflict`, `folder.configure/sync/checkRestore` |
| `plan` | `getDay` |
| `placement` | `start`, `nextProbe`, `answer`, `finish`, `abort` |
| `remediation` | `getPlan` |
| события | `progress`, `library-reloaded`, `library-compiled`, `state-rebuilt`, `settings-changed`, `sync-conflict`, `remediation-triggered` |

Правила: списки постраничные (курсор), лимиты (страница списка по умолчанию 100, максимум 500; `getGraph` до 2 000 узлов; ассет ≤ 2 МБ; `plan.getDay` `maxItems` 1–200); идемпотентность по `requestId`/`attemptId`; аддитивная эволюция контракта под `CONTRACT_VERSION`; никаких классов, функций, `Symbol` в DTO (structured clone Electron превращает экземпляры классов в plain-объекты, функции бросают `DataCloneError` [ИЗМЕРЕНО]).

## 8. Ключевые решения и компромиссы

| Решение | Решает | Ухудшает | Менять, когда |
|---|---|---|---|
| Порт на TS вместо встраивания Rust-движка | Один язык и один toolchain с Electron, отладка и типы; движок переиспользуем на сервере | Поведение приходится держать в паритете вручную; ≈ 11–12 тыс. строк [ОЦЕНКА]; AGPL | Дрейф паритета дороже бюджета → заморозить golden и встроить Rust через napi |
| Сохранить границы модулей Trane | Трассируемость к апстриму, перенос тестов и спек, дешёвое сравнение с будущими релизами | Тащим Rust-идиомы (`Candidate` с 11 полями, раздельные кэши) | Граница мешает фиче (фронтир API) — менять локально |
| Журнал событий вместо `practice_*` | Sync без конфликтов, воспроизводимость, идемпотентный импорт | Отклонение от Trane при ≥ 3 попыток на упражнение с deltas; реплей при старте | Реплей > 2 с → снапшот проекций с ключом версии |
| Удалить deltas | Убирает зависимость от часов планировщика | Нет обратной связи «предсказано/факт» в PowerLaw; FSRS сам обновляет состояние | Появятся данные, что калибровка требует поправки |
| FSRS (H) за портом `ExerciseScorer` и `MemoryModel` | Калиброванная R; смена реализации локальна | Зависимость от семантики `next_state`; тонкий запас на воротах | ts-fsrs 6 ломает API или числа → `MemoryModel` на `fsrs-rs`/своей реализации |
| `next_state`, а не `next()`/`Card` | ×7 быстрее, совпадает с py-fsrs, без `Date` | Метод не документирован как стабильный | В ts-fsrs 6 появится публичный чистый API — перейти |
| Async DTO-фасад над синхронным доменом | UI/IPC-безопасно, транспорт-агностично, без гонок внутри команды | Двойная типизация (DTO и домен), мапперы | Профилировка покажет, что маппинг дорог — пакетные ответы |
| better-sqlite3 13 за портом `SqlDatabase` | Один prebuild для Node 22 и Electron 44 (N-API), SQLite 3.53.4 везде, быстрее `node:sqlite` в 1.5–2.5× | Нативный модуль в упаковке; один мейнтейнер; Windows/Linux не проверены | Проблемы упаковки → адаптер на `node:sqlite` (RC в Node 24) |
| Строгая загрузка по умолчанию, диагностики сразу | Опечатки видны все за раз, поведение как у Trane | Одна ошибка блокирует библиотеку | Пользователям нужен частичный режим → `lenient` с карантином юнитов |
| f64 в продукции + f32-двойник в тестах | Читаемый код, паритет проверяем | Две ветви в трёх модулях | Нужно бит-в-бит воспроизводить решения Trane → f32 в продукции |
| zod 4.6.5 за `parseManifest()` | strictObject, дискриминированные union, JSON Schema | 453 КБ min, если попадёт в renderer | Renderer импортирует схемы → `zod/mini` или valibot |
| Пул процессов для SQL вместо `worker_threads` | `terminate()` не прерывает `sqlite3_step` (измерено), kill процесса 1–8 мс | Респавн 41–52 мс после каждого зависшего запроса; процесс на ядро пула; Windows и Linux не проверены | В драйвере появится `interrupt` или в Electron — ОС-песочница раннера |
| Журнал = множество + карантин конфликтов | Слияние коммутативно, ассоциативно, идемпотентно (property-тесты) | Конфликт скрывает обе записи до решения пользователя; полный rebuild при конфликте | Конфликты частые → автоматическое разрешение по правилу |
| HLC-правило для `at` | Порядок устойчив к перекосу часов ±1 сутки и шагу назад | «Отравление» будущим `at` (часы в 2099) — нужен карантин при импорте | Реальные данные покажут перекосы > 24 ч |
| Неявный повтор (FIRe) за флагом, выключен | Не платим риском непроверенной модели и rebuild 17.6 с | Теряем выигрыш модели (очередь due ×8 меньше в круговой симуляции) | Есть A/B на реальных ответах |
| Диагностика: жёсткое замыкание по цепочкам | 20–40 проб на 3 000 тем, выбор пробы < 1 мс | Один угаданный pass даёт каскад false-known; реальные ученики нарушают downset (не измерено) | `minPass = 2` мало → ограничить дальность замыкания, подтверждать ранними повторами |
| FULL + `fullfsync` по умолчанию | Последние коммиты переживают потерю питания (по документации, не измерено) | +3 мс на коммит на macOS | p95 `recordAttempt` превысит NF1 → `normal` |
| Компиляция курса + артефакт | Загрузка 33 мс, все диагностики за проход | Второй источник правды (артефакт) и риск устаревания | Проверка свежести даёт ложные срабатывания → только content-`revision` |

Точка слома дизайна: если реплей журнала и первый проход скоринга в TS не укладываются в NF1 на 3 000 уроков, потребуется снапшот проекций и предпрогрев в фоне (§11, M4/M7).

## 9. Отказы, деградация, безопасность

| Отказ | Поведение и восстановление |
|---|---|
| Ошибка манифеста или цикл в библиотеке | `getInfo` возвращает диагностики, движок в состоянии `library-invalid` (практика недоступна, настройки и журнал доступны); исправить курс и `library.reload()` — атомарная подмена неизменяемой библиотеки |
| Курс обновили и переименовали id | События остаются в журнале, проекции пропускают неизвестные id, `getDiagnostics` перечисляет сирот (код `W_ORPHAN_EVENTS`, его выдаёт движок при открытии, не компилятор); `aliases` в манифесте — M7 |
| SQLite: busy/locked, диск полон, порча | `append` бросает `STORE_*`, проекции не меняются; при порче — открыть в `readOnly` и предложить `exportSince` + пересоздание; периодический экспорт JSONL как резерв |
| Сбой при применении события к проекциям | флаг `dirty`, автоматический rebuild на следующем чтении; журнал уже записан |
| Расхождение часов | `at` по HLC-правилу (§5.1): не меньше уже увиденного и не дальше `now + 5 мин` от собственных часов; шаг часов назад и перекос ±1 сутки не переворачивают порядок сброса и флагов; на чтении возраст не отрицателен; часы в далёком будущем — карантин при импорте (`at > recordedAt + 24 ч`) [ВЫВОД] |
| Процесс-хост упал (utilityProcess) | Авто-перезапуска в Electron нет [ИЗМЕРЕНО]: супервизор в main поднимает хост, UI переподключается и повторяет идемпотентные запросы (`requestId`) |
| Верификатор завис или упал | kill процесса раннера через `timeoutMs + 100 мс`, вердикт `error` (`timeout`, `resource_kill`, `worker_crash`), событие не пишется; пул респавнит процесс (41–52 мс); UI предлагает повтор или самооценку (`recordAttempt`) |
| Незавершённая попытка при падении | `attemptId` в памяти теряется, `ATTEMPT_NOT_FOUND`; резерв — `recordAttempt` |
| Второй процесс-писатель | приложение держит single-instance lock; движок дополнительно берёт `BEGIN IMMEDIATE` и при `SQLITE_BUSY` отдаёт `STORE_BUSY` [спайком не проверялось] |
| Тяжёлая операция (открытие, rebuild) блокирует поток | выполнять в utilityProcess; rebuild порциями с `setImmediate`, если хост — main |
| Конфликт записей журнала (`id-content`, `seq-two-ids`) | Обе записи скрыты от проекций, полный rebuild, событие `sync-conflict`; `sync.getConflicts` и `resolveConflict`; журнал ничего не удаляет |
| Сегмент синхронизации обрезан, испорчен или пришёл раньше `head` | Сегмент не применяется (`pending`), повтор в следующем раунде; потерь нет (16 сценариев матрицы отказов) |
| Клон или восстановление `deviceId` из бэкапа | `checkRestore()`: догнать свой хвост из папки или форк на новый `deviceId`; `SYNC_DEVICE_ID_CLASH` при экспорте; незамеченное — конфликты `seq-two-ids` |
| Артефакт курса устарел или повреждён | Быстрая проверка по stat, при расхождении content-`revision`, иначе `compile`; при ошибках прежний граф остаётся, наружу — диагностики |

**Безопасность: содержимое курса — недоверенный вход.** Пути ассетов приводятся по правилам `join` Trane (`..` у корня зажимается к корню; сохраняем ради совместимости), дополнительно проверяется `realpath` внутри корня библиотеки (симлинки; компилятор даёт `E_ASSET_ESCAPES_ROOT`); лимиты размера манифеста (1 МБ) и ассета (2 МБ), JSON без `__proto__`-загрязнения (парсинг через схему), никаких `eval`. Движок отдаёт Markdown сырым, санитайзинг — обязанность UI. Раннер SQL (M5) — пул дочерних процессов (не `worker_threads`, §6a.4): свежая in-memory база из фикстуры, authorizer и лимиты `node:sqlite` на Node ≥ 24.15, `query_only` и префильтр как запасной профиль, kill по таймауту и RSS; фикстура считается публичной; ОС-песочница не проверялась. Нет сетевых вызовов; журнал не покидает устройство без явного `exportSince` или настроенной папки синхронизации.

## 10. Тестирование (подробно в `engine-ts-testing.md`)

Уровни: unit (быстрые, in-memory) → golden против Rust-Trane → property → contract (порты) → integration (fs + SQLite) → simulation → bench. Опоры:
- **Дифференциальные тесты.** Настоящий Rust-Trane порождает fixtures, TS сверяется: чистые функции (PowerLaw — 5 919 кейсов уже есть), граф на реальных библиотеках (15 секций дампа), оценки после скриптовых последовательностей, частоты попадания в батч на 2–5 тыс. батчей (распределительный паритет, потому что планировщик случаен). Допуски: f32-двойник — строго; f64 — `atol + rtol`; дискретные решения без допуска [ИЗМЕРЕНО на PowerLaw].
- **Портирование:** из 353 тестов Trane переносим ≈ 280 (домен 195, менеджеры 13, фасад 11, интеграционные ≈ 43, хранилища переписываются под журнал ≈ 21); пропускаем 26 (Literacy/Transcription), 6 (deltas), большую часть служебных (`benchmark`, `test_utils`, `course_builder`).
- **Найденные дефекты Trane становятся регрессионными тестами:** опции доходят до всех компонентов; детерминированный дедуп наград; `.DS_Store` в каталогах настроек; тай-брейк порядка; `next()` календарных дней; закрытие ворот без «old-good floor».
- **vitest 5.0.2:** Node ≥ 22.12; `pool: 'forks'`; `test.projects` вместо workspace; `bench` теперь фикстура теста; `clearMocks` по умолчанию `true`.
- **Тесты F-слоя** (сверх T-01..T-20 из `engine-ts-testing.md`): слияние журнала (коммутативность, ассоциативность, идемпотентность, порядок прихода, конфликты, reset, LWW, скос часов при HLC) — property-тесты с фиксированным seed; матрица отказов `FolderSync` (16 сценариев), сходимость 4 устройств и два OS-процесса; SIGKILL-тест SQLite (300 итераций на режим); батарея угроз SQL (30 случаев) по профилям и `portability` (41 проба) на Node 22 и 24; матрица дефектов компилятора (≥ 48 дефектов) и `loadCompiled == loadDirectory`; инварианты планировщика (`≤ maxItems`, детерминизм, интерливинг, `rebuild == incremental` побитово); placement: безшумный прогон не противоречит downset, строгий гейт открывает ровно фронтир; дифференциальный тест `getFrontier` против Rust; ремедиация: детерминизм и `rebuild == incremental`.

## 11. Эволюция и дорожная карта

Критерий каждой вехи — автоматическая приёмка; оценки строк — [ОЦЕНКА] (порт ×1.25 от Rust: измерено 1.15× код, 1.26× с типами на `PowerLawScorer`).

| Веха | Содержание | Приёмка | ≈ строк TS |
|---|---|---|---|
| M0 Каркас | pnpm-workspace, tsconfig (TS 7, `tsc -b`), vitest projects, ESLint + Prettier, CI на Node 22 и 24; `contract`, `@dolphy-app/testkit` (dev-пакет: FakeClock, SeededRng, TestId, билдеры курсов и журнала, генераторы синтетических библиотек); перенос артефактов песочницы | `pnpm test` и typecheck зелёные на обеих Node; эталон py-fsrs проходит контрактный тест `MemoryModel` | 800 |
| M1 Данные, библиотека, компилятор (F1, F2) | схемы манифестов и кодек wire, граф, loader, генератор KnowledgeBase, `CourseSource` (fs, memory); authoring (`engine`-frontmatter, `yaml` только в компиляторе), компилятор (36 кодов + `W_GRANULARITY`; `E_REFERENCE_FAILS` — на M5), артефакт JSON, `isFresh`, CLI `engine-cli`; миграция `sql-course` на `engine.verification` и реальные фикстуры | 0 ошибок схемы на всех JSON-манифестах Trane; граф совпадает с Rust на 6 библиотеках без генераторов; матрица ≥ 48 дефектов и по одному на `W_GRANULARITY`; `loadCompiled == loadDirectory` на 7 библиотеках; Rust-Trane открывает курс с `engine`-frontmatter; ≈ 95 портированных тестов | 4 200 |
| M2 Скоринг | performance, PowerLaw (из песочницы), `FsrsScorer` + `MemoryModel`, награды, `UnitScorer` | golden L1 (PowerLaw 5 919 кейсов) и L1b (FSRS против py-fsrs и Rust-адаптера); портированные тесты скореров (31 + 12 + 8 + 9) | 1 900 |
| M3 Планировщик, фронтир, due (F4, часть 1) | DFS, фильтр кандидатов, knocker, relearn, shuffler, фильтры и сессии, holder опций, `getFrontier` («нет данных = закрыто») и `getDue` | портированные тесты (13 + 6 + 18 + 4 + 2 + 7); распределительный паритет L4 на ≥ 5 состояниях; `getFrontier` против Rust `get_candidates`; порт 43 интеграционных тестов на симуляциях; bench p95 против NF1 | 2 650 |
| M4 Состояние, фасад, синхронизация (F7) | журнал (memory, SQLite), миграции, проекции, rebuild, `recordAttempt`, `progress_reset`, attempt sessions, сервисы, контракт + схемы запросов, события, импорт `.trane`; множество + карантин конфликтов, HLC-правило, вектор-префикс, реестр сегментов, `FolderSync`, защита `deviceId`; SQLite FULL + `fullfsync` | contract-тесты обоих хранилищ; property-тесты слияния, сброса, HLC и rebuild; матрица отказов `FolderSync` (16 строк) и сходимость 4 устройств; SIGKILL-тест SQLite; сценарии через фасад | 3 300 |
| M5 Проверка ответов (F5) | `Verifier`, `GradePolicy`, `@dolphy-app/engine-sql-runner` (пул процессов, `node:sqlite`, authorizer, kill по таймауту и RSS), `--run-checks` компилятора (`E_REFERENCE_FAILS`); смоук в настоящем Electron 44 (порождение процессов раннера из `utilityProcess`) | батарея угроз: 0 эффектов в профиле `full` на Node 24; тайм-аут и RSS-kill; отсутствие события при `error`; 1 000 проверок ≤ 1 с на прогретом пуле (запас ×8–30 к измеренным 0.03–0.13 с; проект `bench` блокирует релиз, не PR-CI) | 900 |
| M6 Адаптивный слой (F3, F4 часть 2, F6) | `placement.*`, `plan.getDay`, интерливинг, неявный повтор за флагом (`MemoryIndex`, `stepFractional`), `RemediationTracker`, `remediation.getPlan` | инварианты планировщика и `rebuild == incremental` побитово; безшумный placement не противоречит downset и гейт открывает ровно фронтир; детерминизм ремедиации; симуляции F3/F4 воспроизводятся из seed | 1 900 |
| M7 По данным (не блокирует F1–F7) | снапшот проекций, предпрогрев, `aliases`, `ParameterTrainer`, A/B неявного повтора | по отдельным исследованиям | 1 000 |

Итого M0–M6 ≈ 15.7 тыс. строк TS без тестов (M7 ещё ≈ 1 тыс.): перенос Trane ≈ 6.4 тыс., новое ≈ 9 тыс. [ОЦЕНКА]. Основание для F-слоя — production-части спайков без bench/sim/матриц (строки без пустых и комментариев, `wc`): компилятор ≈ 2 000 (около половины пересекается с загрузчиком M1), диагностика ≈ 460, раннер SQL ≈ 730, план + память ≈ 850, журнал + синхронизация ≈ 860 [ИЗМЕРЕНО по спайкам]; множитель к боевому коду ×1.3 и ремедиация ≈ 400 без спайка — [ОЦЕНКА]. Тестов ≈ 6.8–8.8 тыс. строк (порт 5–7 тыс. и F-слой ≥ 1.8 тыс. по спайкам; в песочнице тесты `PowerLawScorer` заняли 0.21× строк Rust-тестов из-за хелперов). Что вырастет в 10 раз: библиотека → артефакт уже снимает загрузку (33 мс), компиляция 40k файлов ≈ 1.5–2 с [ВЫВОД, экстраполяция; измерены только fingerprint и 12k файлов]; журнал → снапшот проекций (M7); больше устройств → компактация сегментов и, при необходимости, сервер поверх тех же сегментов; серверный запуск → тот же `@dolphy-app/engine` в Node.

Переиспользуемые артефакты песочницы (`engine-ts/spike/`): `powerlaw-port/` (порт PowerLaw, 31 тест ×2 precision, golden-генератор `golden-rs/`, fixture 5 919 кейсов), `fsrs-check/` (рецепт `next_state`, эталон py-fsrs, конфиги vitest 5/TS 7), `loader-bench/` (схемы zod, загрузчик, граф, редукция, Rust-дамп графа), `compiler/` (авторинг, 36 кодов, артефакт, матрица дефектов), `diagnostic/` (V3, симуляция, placement), `fire-plan/` (`stepFractional`, `MemoryIndex`, планировщик, симуляции), `sql-runner/` (`SqlVerifier`, батарея угроз, пул), `journal-sync/` (`Replica`, `FolderSync`, SQLite-хранилище, crash-тест). Эталоны: `engine-ts/reference/` (Rust-Trane v0.34.1, `sql-course`, Rust-адаптер FSRS).

## 12. Открытые вопросы

1. **Лицензия (A1):** владелец отложил вопрос (2026-09-29); вернуться до первого внешнего релиза: принять AGPL для всего приложения или «чистая комната».
2. **Размещение движка:** решено владельцем — `utilityProcess`. Открыт только замер холодного старта и латентности `getBatch` в нём (M3/M4); владелец на вопрос о латентности ответить не может, поэтому число остаётся измерением.
3. **Режим загрузки:** строгий (по умолчанию) или мягкий с карантином юнитов — нужен ли пользователям?
4. **Маппинг оценок и `GradePolicy` по умолчанию** (например `pass@1 → 5`, `pass@2 → 4`, `pass@3+ → 3`, отказ → 1): калибровка данными на M2 и M5 [НЕ ПОДТВЕРЖДЕНО].
5. **Границы «сессии обучения»:** кто вызывает `startSession()` (сбрасывает частоты, relearn pile и success rate) — UI при начале занятия.
6. **Детерминированный дедуп наград** отличается от Rust при перезапусках процесса: принимаем как исправление?
7. **Импорт `.trane`:** нужен ли вообще (ученики Trane), или начинаем с чистого журнала?
8. **ts-fsrs 6.0-beta:** изменения не изучались; миграция после стабилизации.
9. **Упаковка:** electron-builder/Forge с pnpm-workspace не пробовали; Windows и Linux prebuild better-sqlite3 не запускали [НЕ ПОДТВЕРЖДЕНО].
10. **Инструменты:** `fast-check` 4.10.2 и `@fast-check/vitest` 0.5.0 с vitest 5.0.2 проверены (property-тест проходит, ложное свойство даёт контрпример) [ИЗМЕРЕНО]; совместимость Biome 2.5.14 с TS 7 не проверена; typescript-eslint 8.71 требует alias на `@typescript/typescript6`.
11. **`getDay` или `getBatch` в UI:** `getDay` — продуктовый путь ежедневного плана, `getBatch` — паритет Trane для практики с фильтрами и сессиями; решить, что UI зовёт по умолчанию (M6).
12. **Неявный повтор (FIRe):** включать ли и когда; нужен A/B на реальных ответах (κ, λ, `minCredit`); до тех пор `implicitCredit.enabled = false`.
13. **Порождение процессов раннера SQL:** `SqlVerifier` в хосте движка порождает детей через `child_process.fork`; внутри `utilityProcess` настоящего Electron 44.4.5 (Node 24.21.0, macOS arm64, 2026-09-29) это работает при `ELECTRON_RUN_AS_NODE=1` в окружении ребёнка, профиль раннера `full`; из упакованного `app.asar` раннер тоже стартует [ИЗМЕРЕНО]. Запасной вариант (порождение из main и порт сообщений в хост) не понадобился (`engine-ts-electron.md` §9, §16).
14. **Конфликты журнала:** `resolveConflict` локален (§5.1); нужны ли UI разрешения и репликация решений между устройствами (вне v1).
15. **Placement на проверках с угадыванием** (выбор из вариантов): допускать с `minPass = 2` или только на проверках раннера.
16. **DDL/DML-уроки SQL:** режим «скрипт + проба» не спроектирован; в v1 такие уроки без автопроверки [НЕ ПОДТВЕРЖДЕНО].
17. **Реальные файловые синхронизаторы** (iCloud, Syncthing, Dropbox) и Git: поведение только имитировалось; потеря питания и SQLite NORMAL против FULL не проверялись.
18. **Гранулярность и ремедиация:** пороги `W_GRANULARITY` (3 и 12 упражнений) и ремедиации (2 неудачи, 3 элемента) — предположения без данных.

### 12.1 Решения и итоги реализации (2026-09-30)

Решения приняты исполнителем по поручению владельца; пересмотреть при первом ревью. Реализация M0–M6 и проводка `apps/desktop` завершены (`pnpm test`: 2 663 теста на Node 24.16, все проекты; Linux aarch64 под root, Node 22.23 и 24.21 — проекты движка; `pnpm smoke` и `pnpm smoke:packaged` на macOS arm64, Electron 44.4.5).

| Вопрос §12 | Решение |
|---|---|
| №4 `GradePolicy` | `passAtN` по умолчанию, без настройки в курсе и в UI; калибровка — на данных |
| №6 дедуп наград | Принято как исправление. Golden L2: если перезапускать Rust-Trane перед каждой попыткой, у него на 1 624 награды больше и расходятся 68 оценок (максимум 0.19); TS детерминирован |
| №7 импорт `.trane` | Оставить (`sync.importFromTrane`, `readTraneDirectory`) |
| №9 упаковка | Неподписанный `.app` (`electron-builder --dir`) собирается, `pnpm smoke:packaged` проходит три сценария; хост и раннер грузятся из `app.asar`, `better-sqlite3` — из `app.asar.unpacked`. Не проверено: подпись, нотаризация, Windows, Linux-упаковка |
| №11 `getDay`/`getBatch` | `getDay` для «сегодня», `getBatch` — свободная практика с фильтрами |
| №14 конфликты | Локальные, без UI и без репликации решений (v1); сторона `id-content` выбирается по `entryHash` (`SyncConflictDto.entryHashes`) |
| №15 placement | `minPass = 2` скрыт в движке, признака в DTO нет |
| M7 | Не начат. Снапшот проекций не нужен: `rebuild` 500k записей в режиме по умолчанию (`none`) — 0.23 с, `sparse` — 1.3 с; `AttemptIndex` на 500k попыток занимает ≈ 105 МБ кучи [ИЗМЕРЕНО] |
| Windows | Не поддерживается до замены `ps -o rss=` в `engine-sql-runner/src/rss.ts` (без наблюдателя RSS запрос без `db.limits` может съесть гигабайты); блокер релиза под Windows |

**Отступления реализации от дизайна (приняты):**

1. `EventStore.append`: известный `id` попадает в `duplicates`, пачка не откатывается (T-31 описывал спайковый `appendBatch`).
2. Карантин `clock-skew` с двумя правилами: `at > recordedAt + 24 ч` и `at > now получателя + 24 ч` при импорте (без второго устройство с часами 2099 отравляет `maxAt`). Недостаток: при честном перекосе двух устройств ≥ 24 ч записи здорового устройства, поднятые HLC-правилом, тоже попадают в карантин; сходимость проверена при ±10 ч, T-23а на ±1 сутки — по порядку ключей.
3. `importFromTrane`: `id` включает `deviceId`; будущие метки зажимаются до `now + 5 мин`.
4. `AttemptIndex` хранит все попытки (окно из 20 берётся при чтении): поздний `progress_reset` требует старых попыток для точного `count`.
5. `getBatch` с явным фильтром не добавляет элементы ремедиации; `getProgress`: `mastered` — оценка не ниже нижней границы окна `easy`, `locked` — урок не на фронтире и не начат.
6. `W_GRANULARITY` проверяется только для курсов с блоком `engine` (иначе библиотеки Trane с одним упражнением на урок теряют «0 предупреждений»).
7. `placement.finish` эмитит `progress`; `placement.answer` для проверяемых проб принимает результат открытой попытки.
8. `createSqlVerifier` требует `source: CourseSource` (порт `Verifier` не даёт доступа к файлам); ключ эталонного решения — `engine.verification.reference`.
9. `T-07`: допуски теста (S ≤ 1e-6, R ≤ 1e-7) мягче документа (S ≤ 1.4e-7, R ≤ 7e-9); измеренные максимумы — S 1.95e-7 (относительно), R 7.15e-9. `T-49`: эталон — golden от Rust `get_exercise_batch`, а не `get_candidates`.

**Числа T-57** (Node 22.22, macOS arm64, без параллельной нагрузки, медианы; `pnpm -F @dolphy-app/engine-sqlite bench`, `pnpm -F @dolphy-app/engine bench`): вставка 500k — 10.7 с; чтение с маппингом — 216 мс; `append` (fullfsync, батч 1) — 3.9 мс; экспорт 500k — 3.0 с; импорт 500k — 10.8 с (в спайке 0.83 с, хуже в 13 раз; причина не выяснена, вероятно durable-запись `FULL` + `fullfsync` [ВЫВОД]; операция разовая); `MemoryIndex.rebuild` 500k — none 227 мс, sparse 1.35 с, trane 31.8 с (`implicitCredit` выключен по умолчанию); `planDay` 40 из 5 000 просроченных — none 0.9 мс, trane 24 мс; `getBatch` 3 000 уроков, тёплый p95 — 34 мс (бюджет NF1 100 мс); выбор пробы placement — 0.06 мс; компиляция 12 000 упражнений — KB 1.77 с, JSON 3.05 с (база спайка 0.75 и 1.2 с: компилятор медленнее в 2.4 раза, причина не выяснена).

**Найдено на Linux:** три теста зависели от среды (не продукт): `chmod 000` не закрывает файл для root; счётчик `spawned` пула раннера растёт по `ready`; SIGKILL после коммита большой пачки ложно засчитывался как «остаток». Исправлено пробами возможностей и точной классификацией.

## 13. Самооценка и проверочный список

| Измерение | Оценка (0–5) | Что даёт основание / что добавить |
|---|---|---|
| Фундамент (согласованность, репликация) | 4 | Слияние журнала проверено property-тестами (3 000 прогонов на свойство), четыре дыры v0 найдены и исправлены (HLC, карантин, вектор-префикс, защита `deviceId`); реальные файловые синхронизаторы не проверялись |
| Блоки под нагрузкой и отказом | 4 | SQLite WAL: 600 SIGKILL без нарушений (потеря питания не проверялась), N-API prebuild, падение utilityProcess, раннер SQL: kill процесса и RSS-наблюдатель измерены; Electron 44 (`pnpm smoke`, `pnpm smoke:packaged`) на macOS arm64 и тесты движка на Linux aarch64 проверены; Windows не поддерживается (нет замены `ps` для RSS) |
| Требования | 5 | Три списка, допущения и границы явные |
| Компромиссы | 4 | Таблица §8 с точкой слома; часть решений (маппинг оценок) ждёт данных |
| Числа | 4 | Открытие, чтение журнала, `next_state`, IPC, `getBatch` (p95 34 мс на 3 000 уроков), `rebuild` и `planDay` измерены (§12.1); импорт 500k и компиляция хуже базы спайка, причина не выяснена |
| Отказы и деградация | 4 | Таблица §9; протоколы супервизора и снапшотов описаны, не проверены |
| Коллаборация | 3 | Дизайн не обсуждён с пользователем; открытые вопросы §12 |
| **Итого** | **28 / 35** | **Слабейшее: коллаборация; числа батча (оценка); валидность моделей F3/F4/F6 на реальных учениках (спайки на синтетических круговых допущениях, у F6 спайка нет).** Спайки F-слоя закрыли риск реализуемости, не риск валидности. Поднять: ревью §12 с владельцем; замер `getBatch` на M3; A/B неявного повтора; реальные ответы для placement |

Проверка по шаблону: в §8 у каждой строки заполнено «Ухудшает» и точка слома; в §2 у оценок единицы и допущения; §9 даёт путь деградации для каждой зависимости, а не «повтор»; каждый компонент §4 привязан к требованию или числу; охват: медиа — только текстовые ассеты через `readAsset` (бинарные файлы отложены), идентификаторы — uuidv7 для событий и авторские id юнитов, поиск — префикс (`matchPrefix`; полнотекстовый отложен), логи — порт `Logger` и `getDiagnostics`, SLO — внутренние бюджеты NF1 без внешней телеметрии.

## 14. Источники и артефакты

Спеки поведения Trane и отчёты спайков (`engine-ts/research/`), `docs/research/fsrs-in-trane-*.md` и `docs/design/fsrs-in-trane.md` удалены из рабочего дерева; текст — в истории git (`git show 75d8d08:<путь>`). Эталоны: `engine-ts/reference/`. Ранее: `docs/research/fsrs-vs-trane.md`.

