# Spike: F1 (Markdown-репозиторий курса) + F2 (компилятор курса)

Каталог: `engine-ts/spike/compiler` (`src/`, `test/`, `results/`). macOS arm64, node 22.22.3, tsc 7.0.2, vitest 5.0.2, zod 4.6.5, yaml 2.9.1 (единственная новая зависимость: только для frontmatter; см. §2).
Итог по проверкам: `npx tsc --noEmit` чисто; `npx vitest run` — 2 файла, 44 теста, все зелёные (последний прогон после всех правок). `node_modules/` удалён; `package-lock.json` оставлен.

## 0. Что сделано и что нет

| Пункт задания | Статус |
|---|---|
| 1 frontmatter: `yaml` vs мини-парсер, tricky input, правило `readAsset` | сделано, §2 |
| 1 оба layout (JSON и KB), `engine` в манифестах, `lesson.engine.json` | сделано (`src/scan.ts`) |
| 2 проверки со стабильными кодами (36 кодов, каждая — маленькая чистая функция в `src/checks.ts`; парс/asset-проверки — в `src/scan.ts`) | сделано, §3 |
| 3 артефакт `compile(dir)`, JSON / gzip / `v8.serialize`, размеры, время | сделано, §5 |
| 3 revision sha256 vs stat-fingerprint на ~12k и ~40k файлов | сделано, §6 |
| 3 «холодный» compile (пустой page cache) | **[НЕ ПОДТВЕРЖДЕНО]**: `purge` → `Operation not permitted`; все «cold»-цифры ниже — первый запуск в процессе при горячем page cache |
| 4 `loadCompiled(artifact)` == загрузка каталога | сделано; тесты на 7 библиотеках × 3 кодировки + сверка с loader-bench, §4 |
| 5 CLI `validate|compile` | сделано, §7 |
| 6 корпус + defect matrix | сделано, §3.2 (48 дефектов, 35 кодов) |
| 7 рекомендации | §8 |
| `isFresh(artifact, dir)` для рантайма (сравнение stat/ctime/revision) | **не реализовано** (в артефакте есть `revision` и `stat`, функции проверки нет) |
| Измерение git checkout / sync-инструментов на реальных репозиториях | только микро-эксперименты, §6.3; Syncthing/Dropbox **[НЕ ПОДТВЕРЖДЕНО]** |

## 1. Формат авторинга (реализовано)

* **Layout**: `course_manifest.json` (любая глубина, не в корне), `lesson_manifest.json` (прямой потомок курса), `exercise_manifest.json` (прямой потомок урока) — как в Trane; KB-курс (`generator_config.KnowledgeBase`) — каталоги `<short>.lesson/` с файлами из spec-data-graph-library §D.3 (`lesson.dependencies|superseded|encompassed|name|description|metadata|default_exercise_type.json`, `lesson.material|instructions.md`, `<id>.front|back.md`, `<id>.name|description|type.json`); ID и `short → course::short` конвертация как в D.4 п.4. Добавлено расширение: `lesson.engine.json`.
* **`engine`-расширение**: `{verification:{runner,timeoutMs,...params}, keyPrerequisites[], tags[], bloom, dok}` + курс: `requiresChecks`, урок: `nonAncestor: bool|string[]`. Источники: YAML frontmatter в **front-файле упражнения** (KB `<id>.front.md`; JSON — файл, на который указывает `FlashcardAsset.front_path` / `BasicAsset.MarkdownAsset.path`) либо необязательный ключ `engine` в манифесте (JSON layout) либо `lesson.engine.json` (KB). Оба источника одновременно → `E_ENGINE_DUPLICATE`.
* **Правило strip (`stripFrontmatter`, `src/frontmatter.ts`)**: (после необязательного BOM) первая строка ровно `---` (хвостовые пробелы/CRLF допустимы); закрывающая строка `---` или `...`; блок пуст или его первая значимая строка выглядит как `key:`. Иначе файл — обычный Markdown (`---`+проза+`---` — это thematic break, а не frontmatter). Открыть блок может только первая строка, поэтому `---` в теле никогда не разбираются. Открыт, но не закрыт и первая строка — `key:` → `E_FRONTMATTER_UNTERMINATED`, ничего не вырезается. Тесты: `test/frontmatter.test.ts` (CRLF, BOM, `...`, пустой блок, только первый блок, prose-between-rules, блок «не в начале»).
* **Trane-совместимость**: `engine` — лишний JSON-ключ (serde игнорирует, `deny_unknown_fields` в Trane нет — вывод loader-bench); frontmatter Trane видит как текст карточки. Реальная загрузка Trane (Rust) **не запускалась** — [НЕ ПОДТВЕРЖДЕНО].

## 2. YAML-парсер: решение с цифрами

Корпус: синтетическая KB-библиотека 3000 уроков × 4 упр. = 12 000 front-файлов со frontmatter (средний блок 178 байт; `engine:` с `verification`, `keyPrerequisites`, `tags`, `bloom`, `dok`). Парсинг в памяти, медиана лучших из 5 после прогрева (`results/yaml-bench.txt`).

| | всего, 12 000 файлов | на файл |
|---|---|---|
| чтение файлов с диска (для сравнения) | 95.1 мс | 7.9 µs |
| `splitFrontmatter` (поиск границ) | 6.7 мс | 0.6 µs |
| мини-парсер (`parseTinyYaml`, ~200 строк) | **25.0 мс** | 2.08 µs |
| `yaml` 2.9.1 (`schema:"core"`, `uniqueKeys`, `strict`, `maxAliasCount:0`) | **425.2 мс** | 35.4 µs |

Результаты парсеров идентичны на всех 12 000 блоках (`identicalOutputs: 12000`). `import('yaml')`: 10.4 мс; 1.2 МБ в node_modules.

Tricky-вход (полная таблица: `results/yaml-bench.txt`): двоеточие в кавычках, URL, unicode (значения и ключи), CRLF, `no`→строка, `010`→10, комментарии, пустое значение — **оба парсера дают одинаковый результат**. `a: b: c`, табы в отступе, дубликат ключа — **оба отвергают** (у мини-парсера — с номером строки). Конструкции вне подмножества (`&`/`*`, `|` block scalar, `{}` flow map, многострочный `[..]`, список маппингов, `<<`) мини-парсер помечает `unsupported` → в режиме `auto` разбор передаётся `yaml`. Псевдонимы `yaml` тоже отвергает по политике (`maxAliasCount:0`, тест).

**Решение** [ВЫВОД, по измерениям]:
1. Рантайму YAML-парсер не нужен: `readAsset` использует только `splitFrontmatter` (6.7 мс/12k), а `engine` читается из артефакта. YAML парсится лишь в компиляторе.
2. Разница ≈0.4 с на 12k файлов — это ≈+55% к полному compile (0.75 с), но на старт рантайма не влияет вообще. Поэтому по умолчанию брать **только `yaml`** (полная спецификация, готовые сообщения об ошибках с позицией) и **удалить мини-парсер** как лишний код с риском расхождения семантики.
3. Оставить мини-парсер (в спайке это режим `auto`) имеет смысл только если понадобится валидация «по нажатию клавиши» в редакторе автора: 25 мс против 425 мс на всю библиотеку. Мы этого не измеряли на реальном сценарии редактора.
В спайке по умолчанию включён `auto` (мини → fallback на `yaml`), потому что оба варианта нужно было измерить.

## 3. Проверки

### 3.1 Каталог кодов (`src/diagnostics.ts`, 36 кодов; severity — дефолт)

parse/schema: `E_IO`, `E_JSON_PARSE`, `E_SCHEMA`, `W_UNKNOWN_KEY` (ключ манифеста и ключ frontmatter кроме `engine`), `E_FRONTMATTER_UNTERMINATED`, `E_FRONTMATTER_PARSE`, `E_ENGINE_SCHEMA`, `W_ENGINE_UNKNOWN_KEY`, `E_ENGINE_DUPLICATE`, `W_UNKNOWN_RUNNER` · ids: `E_ID_EMPTY`, `E_ID_DUPLICATE`, `E_ID_MISMATCH` · граф: `E_DEP_MISSING`, `E_DEP_SELF`, `E_DEP_KIND` (зависимость от упражнения; курс от урока), `E_CYCLE_DEPENDENCY|SUPERSEDED|ENCOMPASSED` (полный путь в `related` и в сообщении), `W_REDUNDANT_EDGE` (перечисляет `[unit, dep, via]`), `E_ENC_WEIGHT`, `E_ENC_MISSING`, `E_ENC_NOT_ANCESTOR` (снимается `engine.nonAncestor`), `E_SUP_MISSING`, `W_ORPHAN_LESSON`, `W_FAN_IN` (>7) · расширение: `E_KEYPREREQ_MISSING`, `E_KEYPREREQ_NOT_ANCESTOR`, `E_NO_VERIFICATION` / `I_NO_VERIFICATION` (info агрегируется по уроку) · прочее: `W_UNSUPPORTED_GENERATOR`, `E_ASSET_MISSING`, `E_ASSET_ESCAPES_ROOT` (`..` выше корня и symlink наружу, в т.ч. каталоги), `E_ASSET_TYPE` (не `.md`), `W_ASSET_KIND_UNSUPPORTED`, `W_KB_STRAY_FILE`.

Семантика, о которой стоит знать:
* «Ancestor» для `keyPrerequisites` и `encompassed` — по расширенному графу: зависимости урока + зависимости его курса (наследуются уроками) + зависимость от курса = все уроки этого курса. Это решение спайка; в спеках Trane «ancestor» для инкапсуляции не определён [ВЫВОД].
* Компилятор не прерывается на первой ошибке: при цикле рёбра-замыкания отбрасываются, остальные проверки (redundant/encompassed/keyPrereq) выполняются на приближённом замыкании.
* Каскад подавляется: если front-файл/`engine` сломан (parse, schema, missing/escaping asset, IO) — `E_NO_VERIFICATION` для этого упражнения не выдаётся (`ExerciseUnit.engineBroken`).
* Самозависимость — только `E_DEP_SELF`, а не ещё и цикл длины 1.

### 3.2 Defect matrix (`node src/matrix.ts`, `results/matrix.txt|json`)

Две синтетические библиотеки 3000 уроков × 4 упражнения (KB и JSON layout; ~31k и ~40k файлов). Сначала чистая копия: **0 диагностик уровня warning/error** в обеих (тест `synthetic libraries produce no warnings at all`; 1753 info `I_NO_VERIFICATION`). Затем инъекция: KB — 32 дефекта, JSON — 16 дефектов, **48 дефектов, 35 из 36 кодов** (не покрыт матрицей только `I_NO_VERIFICATION`; он виден в чистых прогонах). Критерии теста (`test/compile.test.ts`, `evaluate()` в `src/defects.ts`):
1. каждый дефект найден с ожидаемым кодом **и файлом** (строка проверяется там, где она детерминирована);
2. **любая** другая диагностика уровня warning/error должна быть объяснена: либо это заявленный дефект, либо явный `collateral` (10 записей, каждая — следствие правки графа в инъекции: 7×`W_REDUNDANT_EDGE` у иждивенцев переписанных уроков, `E_ASSET_MISSING`+`E_ASSET_TYPE` для дефекта `../../etc/hosts`, `E_NO_VERIFICATION` для SoundSlice-ассета);
3. негативные проверки (не должно быть диагностик): frontmatter-подобный текст (`---`/проза/`---`, блок в середине файла, CRLF+unicode+кавычки, BOM+`...`) и `engine.nonAncestor:true` снимает `E_ENC_NOT_ANCESTOR`.
Результат последнего прогона: **48/48 найдено, 48/48 строк совпало где проверялись, unexplained 0, нарушенных негативов 0**; время компиляции дефектной KB-библиотеки 426 мс / JSON 560 мс.

| # | дефект (KB, `c04/l00xxx.lesson/…`) | код | место |
|---|---|---|---|
| 1 | битый `lesson.name.json` (61) | E_JSON_PARSE | файл:1 |
| 2 | `lesson.name.json` = 42 (62) | E_SCHEMA | файл:1 |
| 3 | лишний ключ `weird` в `course_manifest.json` | W_UNKNOWN_KEY | `c00/course_manifest.json:14` |
| 4 | лишний ключ `foo` во frontmatter (63) | W_UNKNOWN_KEY | `e0.front.md:6` |
| 5 | блок не закрыт (64) | E_FRONTMATTER_UNTERMINATED | `e0.front.md:1` |
| 6 | `tags: [a, b` без `]` (65) — fallback на yaml | E_FRONTMATTER_PARSE | `e0.front.md:3` |
| 7 | `tags: a: b` (66) — мини-парсер | E_FRONTMATTER_PARSE | `e0.front.md:3` |
| 8 | `bloom: nonsense` (67) | E_ENGINE_SCHEMA | `e0.front.md:3` |
| 9 | `engine.frobnicate` (68) | W_ENGINE_UNKNOWN_KEY | `e0.front.md:3` |
| 10 | `runner: python` (69) | W_UNKNOWN_RUNNER | `e0.front.md:2` |
| 11 | зависимость `ghost` (71) | E_DEP_MISSING | `lesson.dependencies.json` |
| 12 | самозависимость (72) | E_DEP_SELF | то же |
| 13 | зависимость от упражнения (74) | E_DEP_KIND | то же |
| 14 | цикл 120→122→121→120 | E_CYCLE_DEPENDENCY | `l00120…dependencies.json`, related содержит все 3 |
| 15 | цикл superseded 191↔192 | E_CYCLE_SUPERSEDED | `l00191…superseded.json` |
| 16 | цикл encompassed 180↔181 (+`nonAncestor`) | E_CYCLE_ENCOMPASSED | `l00180…encompassed.json` |
| 17 | вес 1.5 (134) | E_ENC_WEIGHT | `…encompassed.json` |
| 18 | encompassed на несуществующий (136) | E_ENC_MISSING | то же |
| 19 | encompassed на не-предка (153) | E_ENC_NOT_ANCESTOR | то же, related содержит цель |
| 20 | superseded `ghost` (190) | E_SUP_MISSING | `…superseded.json` |
| 21 | избыточное ребро 202→200 через 201 | W_REDUNDANT_EDGE | `…dependencies.json`, related [200] |
| 22 | урок-сирота `l09999.lesson` | W_ORPHAN_LESSON | `c01/l09999.lesson:1` |
| 23 | 8 предшественников (420) | W_FAN_IN | `…dependencies.json` |
| 24 | `keyPrerequisites: [ghost]` (450) | E_KEYPREREQ_MISSING | `e0.front.md:2` |
| 25 | `keyPrerequisites` не предок (460) | E_KEYPREREQ_NOT_ANCESTOR | `e0.front.md:2` |
| 26 | нет `verification`, курс `requiresChecks` (300) | E_NO_VERIFICATION | `e1.front.md:2` |
| 27–28 | генераторы Literacy / Transcription | W_UNSUPPORTED_GENERATOR | `x_lit/course_manifest.json:4`, `y_trans/…:4` |
| 29–30 | `notes.txt`; `x.back.md` без `x.front.md` | W_KB_STRAY_FILE | файл |
| 31 | `e2.front.md` — symlink на `/etc/hosts` (480) | E_ASSET_ESCAPES_ROOT | `e2.front.md:1` |
| 32 | нечитаемый (chmod 000) файл (490) | E_IO | файл |

JSON layout (16): `E_ID_EMPTY`, `E_ID_DUPLICATE` (в месте *второго* определения), `E_ID_MISMATCH` (lesson_id упражнения и course_id урока), `E_ASSET_MISSING`, `E_ASSET_ESCAPES_ROOT` (`..` и symlink), `E_ASSET_TYPE`, `W_ASSET_KIND_UNSUPPORTED`, `E_ENGINE_DUPLICATE` (в манифесте и frontmatter), `W_UNKNOWN_KEY` (манифест упражнения), `E_SCHEMA` (enum), `E_JSON_PARSE`, `E_IO` (front.md), `W_ENGINE_UNKNOWN_KEY` (в `engine` урока), `E_NO_VERIFICATION`.

**Матрица нашла реальные баги компилятора, которые исправлены до финальных цифр** (без матрицы я бы их не увидел): (а) при отсутствующем/уходящем за корень ассете компилятор всё равно читал файл (`E_IO` поверх `E_ASSET_*`, чтение `/etc/hosts` через `..`-clamp); (б) `E_ID_DUPLICATE` указывал на первое определение вместо второго (поиск юнита по id неоднозначен) → у `Finding` появился явный `at`; (в) самозависимость давала лишний цикл длины 1; (г) каскад `E_NO_VERIFICATION` от сломанного frontmatter; (д) при циклах не выполнялись остальные проверки; (е) `E_JSON_PARSE` в KB-файлах не нёс `unit`.

### 3.3 Корпус реальных библиотек (`node src/cli.ts validate`)

| библиотека | error | warning | info | заметка |
|---|---|---|---|---|
| `sql-course/lib_json` | 0 | 15 | 7 | 14× `W_UNKNOWN_KEY` (`check`) + `W_ORPHAN_LESSON` (ddl) |
| `sql-course/lib_kb` | 0 | 22 | 7 | то же |
| `embedded_test_library` | 0 | 0 | 1 | |
| `small_test_library` (3 KB-курса) | 0 | 0 | 126 | |
| `large_test_library` | 0 | 48 | 126 | 48× `W_UNSUPPORTED_GENERATOR` (Transcription), тест ожидает ровно 48 с file:line |
| синтетика 300 ур. × 4, KB и JSON | 0 | 0 | — | |

Генераторов `Literacy` в корпусе нет: диагностика для `Literacy` проверена только синтетически (дефект 27). Ключ `check:` в `sql-course` — формат из более раннего спайка (`check: {runner, fixture, expected, timeout_ms}`), не `engine.verification`: компилятор его честно называет неизвестным ключом; миграция формата — решение владельца SQL-спайка.

## 4. `loadCompiled` == загрузка каталога

`test/compile.test.ts`: для `sql_json`, `sql_kb`, `embedded`, `small`, `large`, синтетики KB и JSON (300 уроков) артефакт кодируется в json / json.gz / v8, декодируется, `loadCompiled(..., {cycleCheck:true})`; `graphSnapshot` (все 12 отношений `InMemoryUnitGraph` на каждый юнит: тип, уроки, стартовые уроки, deps/dependents, encompasses/encompassedBy с весами, supersedes/supersededBy, sinks, флаг encompassing==dependency) **равен** снимку `loadDirectory`; множества упражнений и `engine` тоже. Для JSON-layout библиотек (`sql_json`, `embedded`, `synthetic_json`) снимок `loadDirectory` равен снимку **скопированного loader-bench** (`src/loader-ref.ts`, `loadLibrarySync`) — то есть новый сканер не расходится с эталонным загрузчиком. Для KB-layout эталона в TS нет (loader-bench генераторы курсов не разворачивает), сверка с Rust на KB-курсах **не выполнялась** — [НЕ ПОДТВЕРЖДЕНО]; корректность KB-развёртки опирается на spec D.3–D.5 и на то, что `sql_kb`/`small`/`large` компилируются без ошибок и совпадают с `loadDirectory` (это тот же сканер, то есть не независимая проверка).

`loadCompiled` по умолчанию пропускает проверку циклов (компилятор уже её сделал); артефакт с ошибками не загружается (`ArtifactFormatError`), как и неверный `formatVersion` (тест).

## 5. Артефакт и тайминги (3000 уроков × 4 = 12 000 упр., 15 030 юнитов)

Формат (`Artifact`, `formatVersion: 1`): `revision`, `stat`, `inputFiles`, `courses|lessons|exercises: [{m: манифест как в Trane, engine?, src:"файл:строка"}]`, `skippedCourses`, `graph:{nodes, offsets, targets, keep}` (CSR зависимостей; `keep[e]=0` — транзитивно избыточное ребро), `diagnostics:{summary, items (без info)}`.

Команды: `node --disable-warning=ExperimentalWarning src/bench.ts all` (полный сырой результат в `results/bench.json`). Измерения загрузки — каждое в отдельном дочернем процессе, медиана из 5; RSS — `process.memoryUsage().rss` до и после (модули уже загружены; «до» ≈ 93–97 МБ — это сам node с зависимостями).

### Полный compile (в процессе; page cache горячий — файлы только что записаны)

| layout | файлов на диске | первый запуск | warm (медиана 5) | из них scan | checks | revision (чтение+sha) | build | остаток* |
|---|---|---|---|---|---|---|---|---|
| KB | 31 170 (читает scanner: 18 570) | 745.9 мс | 747.7 мс | 348.6 | 35.0 | 264.5 | 4.7 | 95 |
| JSON | 39 630 (читает: 27 030) | 1279.7 мс | 1187.7 мс | 554.5 | 23.5 | 369.8 | 4.7 | 235 |

\* остаток вычислен вычитанием — это `listInputs(stat)` для revision и fingerprint (отдельно не таймировался). В scan: разбор frontmatter 12 000 файлов — 68.4 мс (KB) / 63.5 (JSON), `JSON.parse` манифестов 2.2 / 11.1 мс, zod 1.1 / 17.6 мс. Compile в свежем дочернем процессе (с JIT-прогревом с нуля): 764.9 мс, RSS 93→164 МБ (KB); 1202.4 мс, 97→175 МБ (JSON). Проверки семантики — всего 23–35 мс; 85% стоимости compile — файловый ввод-вывод, revision читает все файлы **второй раз** (можно переиспользовать байты scanner'а — не сделано [ВЫВОД]).

### Артефакт: размер и загрузка

Загрузка = чтение файла + декодирование + `assembleLibrary` (граф без проверки циклов), дочерний процесс, медиана 5.

| layout | кодирование | размер | encode | загрузка | RSS до→после |
|---|---|---|---|---|---|
| KB | JSON | 6 978 802 Б (6.7 МиБ) | 13.2 мс | **33.2 мс** | 97→129 МБ |
| KB | JSON+gzip | 379 853 Б (5.4% от JSON) | 30.1 мс | 34.3 мс | 94→133 МБ |
| KB | `v8.serialize` | 6 862 756 Б | 10.9 мс | 44.9 мс | 95→137 МБ |
| JSON | JSON | 6 583 072 Б | 10.4 мс | **32.0 мс** | 97→128 МБ |
| JSON | JSON+gzip | 303 676 Б | 25.3 мс | 33.4 мс | 97→134 МБ |
| JSON | `v8.serialize` | 6 519 275 Б | 10.1 мс | 44.1 мс | 94→135 МБ |

Загрузка **из каталога** (`loadDirectory`: scan + zod + frontmatter `engine` + граф + проверка циклов, без семантических проверок; остановка на первой ошибке): KB **368.2 мс**, RSS 93→152 МБ; JSON **589.5 мс**, RSS 95→155 МБ. Ускорение артефакта: **11× (KB) и 18× (JSON)** по времени; по RSS разница не значима (+31…42 МБ против +59…60 МБ).
Выводы из таблицы: v8 **не быстрее** JSON (в обеих библиотеках медленнее на ~11–12 мс) и размер тот же — преимущества нет; gzip даёт ×18…22 по размеру и +1.1…1.4 мс к загрузке — имеет смысл только для передачи/резервного копирования, не для локального кэша. Артефакт больше исходников (3.65 МБ данных генерации KB против 6.98 МБ): манифесты развёрнуты (`null`-поля, полные id).
Ограничение: файлы синтетики крошечные (~130 Б на файл), реальные `.md` с картинками/медиа будут дороже при полном хешировании.

## 6. Fingerprint: revision (sha256) против stat

Корпус KB, файлы 4 упражнения на урок; 5 замеров, медиана, page cache горячий (`results/bench.json → fingerprint`).

| файлов (МБ) | листинг без stat | листинг + stat | sha256 от (path,size,mtime), уже собранных | revision: чтение всех файлов + sha256 (без листинга) |
|---|---|---|---|---|
| 11 429 (1.5) | 13.1 мс | 32.8 мс | 1.7 мс | 83.8 мс |
| 40 521 (4.6) | 52.0 мс | 119.5 мс | 6.7 мс | 353.4 мс |

Итого «нужен ли перекомпил»: stat-путь ≈ 34.5 мс / ≈ 126 мс; content-путь ≈ 97 мс / ≈ 405 мс (листинг + чтение + sha256), т.е. в ~3× дороже. Обе величины малы относительно старта; при крупных файлах (медиа) content-путь растёт линейно с объёмом, stat — нет [ВЫВОД, не измерено].

### 6.3 Режимы отказа mtime-only (измерено микро-экспериментами, APFS)

| сценарий | результат |
|---|---|
| правка того же размера + восстановление mtime (`touch -r`, как `cp -p`/`rsync -t`/`unzip`) | (path,size,mtime) **не изменился** → изменение пропущено; **ctime изменился** → обнаружено бы |
| файл с новым содержимым, но старым mtime (sync-инструменты выставляют mtime источника) | проверка «mtime > времени компиляции» **пропускает**; проверка на равенство (path,size,mtime) с сохранённым — обнаруживает |
| `touch` без изменения содержимого | stat-fingerprint изменился → ложный перекомпил (стоимость ≈ 0.75 с на 12k) |
| `git checkout` старой версии файла (тот же размер `aa`↔`bb`) | git пишет новый файл: mtime=now, **новый inode** → stat-равенство обнаруживает. Наблюдалось на одном файле; на реальном репозитории/`git stash`/`git worktree` **не проверялось** |
| Syncthing/Dropbox/`rsync -t`/распаковка архива с сохранением mtime | по механизму — эквивалент строк 1–2; на реальных программах **[НЕ ПОДТВЕРЖДЕНО]** |

**Что использовать рантайму** [ВЫВОД]: двухступенчато. (1) Быстрая проверка при открытии библиотеки: список файлов + `(path, size, mtimeMs, ctimeMs, ino)` == сохранённому в артефакте (≈35 мс на 12k, ≈125 мс на 40k). Сравнивать **на равенство**, не «новее артефакта»; ctime и ino добавлены, потому что user-space инструменты не могут их восстановить. (2) Если stat расходится — не доверять mtime: пересчитать content-`revision` (≈0.1–0.4 с); если он совпал с `artifact.revision` (то был `touch`/chmod) — обновить сохранённый stat и **не** перекомпилировать, иначе перекомпилировать. Итог: content-хеш — источник правды о свежести, stat — только ускоритель «ничего не менялось». Замечание: в спайке `Artifact.stat` хранит (path,size,mtime) без ctime/ino — добавить при реализации.
Правила `revision`: сортировка путей по UTF-16, вход = `path\0length\0bytes`, dot-каталоги и сам артефакт исключены. Порядок и разделители — часть `formatVersion`.

## 7. CLI

`node --disable-warning=ExperimentalWarning src/cli.ts validate|compile <dir> [--out file] [--json] [--verbose] [--parser tiny|yaml|auto] [--format json|json.gz|v8]`. Печатает `severity code unit path:line message`, в конце сводку; `--verbose` добавляет info; `--json` — машиночитаемый вывод; код выхода 1 при любой `error`, 0 иначе, 2 при неверных аргументах; артефакт пишется только при отсутствии ошибок. Проверено: дефектная KB-библиотека → `21 error(s), 19 warning(s), 1753 info`, exit 1 (`results/cli-defective.txt`); `sql-course/lib_kb compile --out … --format json.gz` → exit 0, 1543 Б; `compile` без `--out` → exit 2.

## 8. Рекомендации

1. **Формат артефакта — JSON** (`JSON.stringify`), файл `<library>/.engine/compiled.json` вне входов revision. Причина: измерено — самая быстрая загрузка (32–33 мс), тот же размер, что у v8, читаем/диффится/отлаживается; `formatVersion` проверяется при чтении. gzip — только для экспорта. v8 отклонить (медленнее и привязан к версии V8/Node — совместимость между версиями Electron не проверялась).
2. **Свежесть** — как в §6: stat-равенство (с ctime+ino) как быстрый путь, content-`revision` как источник правды; никаких сравнений «mtime новее».
3. **Где запускать компилятор**: в engine host (utilityProcess) при открытии библиотеки, если свежий артефакт не найден/устарел — в фоне и **не блокируя UI старым артефактом**, если он есть (показать библиотеку из последнего валидного артефакта, диагностику нового компиля — отдельным событием). Полный компил 12k упр. — 0.75–1.2 с (горячий кэш), на 40k файлов ожидать ~×1.3 [ВЫВОД: экстраполяция; 40k-компиляция не измерялась, только fingerprint]. Отдельная команда «Validate course» (UI и CLI `validate`) — по требованию, с полным списком диагностик. CLI использовать в CI репозитория курса (git hook/pipeline): exit 1 на ошибках.
4. **`library.reload()`**: (а) stat-быстрая проверка; (б) артефакт свеж → `loadCompiled` (~35 мс, без проверки циклов), (в) иначе `compile` → при `error` оставить прежнее состояние и вернуть диагностики (не падать, в отличие от Trane fail-fast), при отсутствии ошибок — атомарно записать артефакт (write temp + rename) и заменить граф. Устаревший артефакт с другим `formatVersion` — молча перекомпилировать.
5. **YAML**: см. §2 — только `yaml` в компиляторе; мини-парсер удалить, если нет требования live-валидации.
6. Перед внедрением: убрать двойное чтение файлов (scanner + revision), добавить `ctime/ino` в `stat`, реализовать `isFresh`, сохранить `line` для подполей `engine` (см. трение 3).

## 9. Что вызвало трение

1. **KB: короткие id только внутри курса.** `convert_to_full_ids` (spec D.4) превращает в `курс::x` только id уроков *этого же* курса; ссылка на урок другого курса обязана быть полным id. Моя собственная инъекция (`l00010` как encompassed) сначала дала `E_ENC_MISSING`, а не `E_ENC_NOT_ANCESTOR`, и это правильное поведение Trane, но ловушка для авторов; диагностика не различает «опечатка» и «забыл полный id». Также spec D.4 п.4: коллизия короткого id с id чужого курса всегда резолвится в свой урок.
2. **Расположение ошибок в KB.** У KB-урока нет манифеста, поэтому «строка урока» — это каталог (`c01/l09999.lesson:1`), а поля вроде `dependencies` указывают на `:1` файла `lesson.dependencies.json` (JSON без ключей/строк). Точные строки возможны только для frontmatter и `*_manifest.json`.
3. **Подполя `engine`.** `E_KEYPREREQ_*`, `W_UNKNOWN_RUNNER` указывают на строку блока `engine:` (`:2`), а не на строку `keyPrerequisites:`/`runner:` — источник строк хранит только начало блока и позиции ключей верхнего уровня `engine.*` при ошибках схемы. Не доделано.
4. **Неоднозначность id → место.** Диагностика, привязанная только к `unit id`, теряет место для дубликатов (баг (б) в §3.2); понадобился явный `at`. Любая новая проверка про дубликаты должна нести позицию.
5. **`engine` дублируется в двух местах** (манифест и frontmatter): выбрана политика «ошибка при обоих», а не слияние. Для KB-курса нет манифеста упражнения вообще, так что разные layout дают разные места для одного и того же `engine`.
6. **`lesson.engine.json`, а не `lesson.metadata.json`**: `metadata` в Trane — `{string: string[]}` и участвует в фильтрах; нагружать его структурой `engine` нельзя. Отдельный файл — единственный способ не сломать Trane-совместимость; но KB-парсер Trane «молча отбрасывает» незнакомые имена, так что файл невидим для Trane — по замыслу.
7. **Определение «ancestor»**: в Trane `encompassed` — просто веса без требования предка; условие «цель — зависимость или предок» — наше, и оно зависит от того, считать ли зависимость от курса зависимостью от его уроков и наследуются ли зависимости курса уроками (в спайке: да). Решение нужно подтвердить владельцу F4.
8. **`TS`-инструменты**: `exactOptionalPropertyTypes` + `erasableSyntaxOnly` заставили писать `...(x !== undefined ? {x} : {})` в десятках мест; `findCycle` из loader-bench типизирован по `string`, для индексного графа пришлось конвертировать в строки. `tsc 7.0.2` работал без нареканий.
9. **`check:` в sql-course** (формат прошлого спайка) не совпадает с `engine.verification`: библиотека даёт 14–22 предупреждения `W_UNKNOWN_KEY`. Нужно решение, какой формат канонический.
10. **Холодный кэш измерить не удалось** (`purge` без sudo). Все времена — с горячим page cache; на холодном диске, вероятно, доминирует чтение 30–40k мелких файлов (revision и scan), это надо проверить отдельно.

## 10. Как воспроизвести

```
cd engine-ts/spike/compiler && npm install
npx tsc --noEmit -p .
npx vitest run                               # 44 теста, ~10 с
node src/matrix.ts --json results/matrix.json  # defect matrix (kb + json)
node src/gen.ts --out /tmp/cmpy --layout kb && node src/yaml-bench.ts /tmp/cmpy
node --disable-warning=ExperimentalWarning src/bench.ts all   # ~40 с, results/bench.json
node src/cli.ts validate ../../reference/sql-course/lib_kb --verbose
node src/cli.ts compile ../../reference/sql-course/lib_json --out /tmp/a.json
node src/cli.ts validate ../../reference/trane-pristine/tests/large_test_library
```
Файлы: `src/frontmatter.ts` (split/strip + мини-парсер), `src/scan.ts` (обход JSON/KB, asset-проверки), `src/checks.ts` (чистые проверки), `src/compile.ts` (артефакт, `loadCompiled`, `loadDirectory`), `src/revision.ts`, `src/defects.ts` + `src/matrix.ts`, `src/gen.ts`, `src/loader-ref.ts` (копия loader-bench, только для сверки), `src/graph.ts`/`types.ts`/`schema.ts` (копии loader-bench; транзитивные рёбра ищутся в `checks.ts` по битсетам замыкания, `algo.ts` не копировался).
