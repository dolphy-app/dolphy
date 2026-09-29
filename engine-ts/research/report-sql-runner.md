# F5 — детерминированная проверка SQL-ответов: спайк `sql-runner`

Код: `engine-ts/spike/sql-runner` (`src/`, `test/`, `fixtures/`, `results/`). Среда: macOS arm64, Node 22.22.3 (SQLite 3.51.3 в `node:sqlite`), Node 24.21.0 (SQLite 3.53.4), better-sqlite3 13.0.3 (SQLite 3.53.4 на обеих Node). Все числа — из команд ниже; сырые выводы лежат в `results/`.

## 0. Главные выводы (коротко)

1. **`worker.terminate()` не останавливает запрос, застрявший в `sqlite3_step`.** На обоих драйверах и обеих Node: `terminate()` не завершается (pending >2 с), поток продолжает крутить ядро на 1.00 core, а **`process.exit(0)` зависает** (kill по `timeout 15` = код 124). Главный поток остаётся отзывчивым (45 тиков по 10 мс за 500 мс), но процесс не выходит. `worker_threads` как граница изоляции для недоверенного SQL **непригоден**. Дочерний процесс + `SIGKILL`: kill 1–8 мс, RSS исчезает сразу, следующая проверка на новом процессе идёт через 41–48 мс.
2. **Ни один из драйверов не даёт прерывания (`sqlite3_interrupt`/progress handler) из JS**: в better-sqlite3 `OMIT_PROGRESS_CALLBACK`; в `node:sqlite` API нет. Значит, жёсткий таймаут = только смерть процесса.
3. **Единственный полный механизм запрета — `setAuthorizer` в `node:sqlite` на Node ≥ 24.10** (в Electron 44 есть). На Node 22 и в better-sqlite3 его нет; там остаётся `PRAGMA query_only` + readonly-хэндл (bs3) + **префильтр**, который сам защитой не является, но без authorizer он реально закрывает `ATTACH`, `VACUUM INTO`, `PRAGMA`, `SAVEPOINT`, чтение чужих файлов (см. §3).
4. **Память**: `db.limits.length` (Node ≥ 24.15) гасит аллокации `randomblob(1e9)`/`zeroblob`/удвоение строки за 1 мс без роста RSS. Без него (Node 22 `node:sqlite`, bs3) запрос успевает съесть 1–4 ГБ. `PRAGMA hard_heap_limit` в этой сборке эффекта не дал. Работает только RSS-watchdog над дочерним процессом (порог 400 МБ, опрос 20 мс → пик 378–488 МБ, kill 4–7 мс).
5. **Определённость и переносимость**: 38 из 41 проб (float-форматирование, порядок без `ORDER BY`, оконные рамки по умолчанию, деление, округление, COLLATE, JSON, даты) дали побайтно одинаковый результат на всех четырёх комбинациях (Node 22/24 × `node:sqlite`/bs3). Отличаются только `sqlite_version()` и `median/percentile` (`ENABLE_PERCENTILE` отсутствует в `node:sqlite` 3.51.3).
6. **Производительность**: прогретый пул — 0.06–0.15 мс на проверку (10–41 тыс. проверок/с); свежий worker на проверку 23–26 мс; свежий процесс 44–47 мс. 1000 проверок: 0.03–0.13 с (in-process/пул) против 23–26 с (fresh worker) и 44–47 с (fresh process; экстраполяция из 300/200 проверок).
7. **Рекомендация**: пул из дочерних процессов (`child_process.fork`, `utilityProcess` в Electron), драйвер — `node:sqlite` при запуске на Node ≥ 24.15 (authorizer + limits + defensive), **better-sqlite3 как единый драйвер ядра** остаётся допустимым при условии, что защита строится на процессе (kill + RSS watchdog), префильтре, `query_only` и readonly-хэндле, а в фикстуру не кладутся секреты. Подробно — §6.

## 1. Прототип `SqlVerifier`

Файлы: `src/types.ts` (контракты), `src/prefilter.ts`, `src/compare.ts` (CSV + сравнение), `src/engine.ts` (`runCheck`: fixture → sandbox → learner SQL → сравнение), `src/pool.ts` (пул `worker` | `process`), `src/worker.ts` (протокол), `src/verifier.ts` (`SqlVerifier`).

Вход: `{driver, fixtureSql, learnerSql, expected: {csv}|{columns?, rows}, compare: {orderSensitive, numericTolerance, ignoreColumnNames, columnOrder}, limits: {timeoutMs, maxRows, maxBytes}, hardening, revealExpected}`. Выход: `Verdict {status: passed|failed|error, code, reason, durationMs, rowCount, detail?}`.

- Каждая проверка открывает **новую `:memory:` БД** из `fixtureSql` (`exec`), потом включает защиту (порядок: fixture → readonly-reopen → `PRAGMA` → `query_only` → limits → defensive → authorizer), затем `prepare` + итерация с капами по строкам/байтам.
- Целочисленные значения читаются как `bigint` (`readBigInts`/`safeIntegers`), `REAL` — `number`; значения > 2^53 не теряются.
- Ответ ученика обязан быть одним оператором `SELECT|WITH|VALUES` (префильтр) **и** возвращать столбцы (`columns().length>0`); `WITH … DELETE` без `RETURNING` отсекается как «не возвращает данные» + `query_only`.
- Реальные фикстуры/вопросы: эталонный курс `reference/sql-course` содержит только **заглушки**: в 21 `q*.front.md` (`lib_kb`) есть блок `check: {runner: sql, fixture: fixtures/<lesson>.sql, expected: sql/<lesson>_q<N>.expected.csv, timeout_ms: 2000, order_sensitive: false}`, но самих `fixtures/*.sql` и `sql/*.csv` **в курсе нет**, текст вопроса — «Write a query for lesson **JOIN**, task q1». Поэтому: (а) `parseFrontMatter` в `src/checks.ts` парсит этот блок (тест `sample course front matter`, ключи совпали: `runner, fixture, expected, timeout_ms, order_sensitive`); (б) фикстура `fixtures/emp.sql` (dept/emp, 3+6 строк, NULL в ключе и в зарплате, ничьи по зарплате, самосвязь `mgr_id`) и **30 собственных проверок** `src/checks.ts`, привязанных к урокам `select/where/aggregate/join/subquery/window` (+`misc`).
- **Ожидаемые CSV написаны руками на бумаге, а не сгенерированы прогоном эталонного SQL** (иначе тавтология). Это сразу поймало мою арифметическую ошибку (`window-default-frame-peers`: я посчитал 190/290 вместо 270/370; проверка упала, расхождение — в моей арифметике).
- Покрытие: join (inner/left/self), агрегаты (`GROUP BY` с NULL-ключом, `count(*)/count(col)/count(DISTINCT)`, `HAVING`), окна (`rank/dense_rank` при ничьих, рамка по умолчанию с peers, `row_number` по партициям с NULL в `DESC`, `lag` с NULL-арифметикой), NULL-ловушки (`= NULL`, `<>` c NULL, `NOT IN` с NULL в подзапросе), коррелированный подзапрос, `NOT EXISTS`, рекурсивный конечный CTE, дубликаты строк, алиасы/регистр столбцов, перестановка столбцов, целочисленное деление, `'1'` vs `1`, float `0.1+0.2`, blob/hex, порядок при `orderSensitive`. Для каждой проверки есть «неверные» ответы (обязаны дать `failed/mismatch`) и «альтернативные» (обязаны пройти): 54 утверждения на драйвер (30 эталонов + 6 альтернатив + 18 неверных ответов; подсчёт `grep` по `src/checks.ts`).
- Диалект ожидаемого CSV (документирован в `compare.ts`): пусто без кавычек = NULL, `""` = пустая строка, значение в кавычках = TEXT, целое без кавычек = INTEGER, десятичное/экспонента = REAL, прочее = TEXT.
- **Не сделано**: DDL-уроки (`ddl.lesson`, q1–q3 просят `CREATE TABLE …`) нельзя проверить моделью «один read-only SELECT». Нужен второй режим `script`: ученический скрипт исполняется во **временной** БД (без `query_only`, но с authorizer, разрешающим только `CREATE/ALTER/DROP` в `main`+`temp`, и без `ATTACH`/`PRAGMA`), затем автор курса даёт `probeSql` (`SELECT … FROM pragma_table_info(...)`/`sqlite_master`), результат которого и сравнивается с CSV. Не реализовано и не измерялось `[НЕ ПОДТВЕРЖДЕНО]`; для Node 22 без authorizer этот режим небезопасен `[ВЫВОД]`.

## 2. Механизмы песочницы (что существует и что реально работает)

| Механизм | node:sqlite Node 22 (3.51.3) | node:sqlite Node 24.21 (3.53.4) | better-sqlite3 13.0.3 (Node 22 и 24) |
|---|---|---|---|
| `setAuthorizer` | нет (`DatabaseSync.prototype` без метода) | **есть** (с 24.10); allow-list `SELECT/RECURSIVE/READ/FUNCTION` работает | нет |
| `PRAGMA query_only=ON` | работает | работает | работает |
| readonly-хэндл | `readOnly` требует файл; для `:memory:` недоступен | то же | `readonly` для `:memory:` запрещён (`TypeError`), **обход**: `db.serialize()` → `new Database(buf, {readonly:true})` — работает |
| defensive | опция `defensive` принимается **молча и игнорируется**; метода `enableDefensive` нет | есть (`defensive` по умолчанию `true` с 24.14) | по умолчанию включён (наблюдение: `writable_schema` заблокирован даже в профиле «bare») |
| отключение расширений | `allowExtension:false` по умолчанию; `load_extension()` из SQL даёт `not authorized` | то же | то же (`load_extension` из SQL: `not authorized`) |
| лимиты SQLite (`sqlite3_limit`) | нет | `db.limits.{length,sqlLength,column,exprDepth,compoundSelect,vdbeOp,functionArg,attach,likePatternLength,variableNumber,triggerDepth}` (24.15) | нет |
| прерывание (`sqlite3_interrupt`, progress handler) | нет | нет | нет (`OMIT_PROGRESS_CALLBACK`) |
| `PRAGMA hard_heap_limit` | пробовал 200 МБ: **эффекта нет** | не пробовал | пробовал 200 МБ: **эффекта нет** |
| капы по строкам/байтам при итерации | работает (`iterate()`) | работает | работает |
| `resourceLimits` worker | лимитируют только V8-кучу: SQLite malloc **не** ограничен (host RSS 4.76 ГБ при `maxOldGenerationSizeMb:64`) | то же | то же |

Причина отсутствия эффекта `hard_heap_limit` `[ВЫВОД, не проверено чтением исходников]`: обе сборки собраны с `SQLITE_DEFAULT_MEMSTATUS=0` (видно в `pragma_compile_options`), а учёт кучи требует memstatus. Факт (наблюдение): child peak 4170 МБ при выставленном лимите 200 МБ.

Сборки различаются (`results/portability-node24.json`, поле `@compile_options`): bs3 — `DQS=0`, `DEFAULT_FOREIGN_KEYS`, `ENABLE_STAT4`, `ENABLE_FTS4`, `SOUNDEX`, `LIKE_DOESNT_MATCH_BLOBS`, `THREADSAFE=2`; `node:sqlite` — `ENABLE_SESSION`, `ENABLE_RBU`, `ENABLE_PREUPDATE_HOOK`, `THREADSAFE=1`, `DEFAULT_CACHE_SIZE=-2000`.

Различие семантики драйверов, замеченное в бою: **`node:sqlite` `prepare('SELECT 1; DROP TABLE t')` молча выполняет только первый оператор**, better-sqlite3 бросает `The supplied SQL string contains more than one statement`. Поэтому проверка «один оператор» должна быть в нашем коде и не зависеть от драйвера.

### Почему префильтр сам по себе — не защита
Конкретные наблюдения (`src/battery.ts`, секция `tricks`; идентично на 22 и 24):
- `WITH c AS (SELECT 1) DELETE FROM emp` **проходит** префильтр «первое слово SELECT/WITH» и в bare-профиле реально удаляет строки (`[DATA CHANGED]`) на обоих драйверах; останавливают его только `query_only`/readonly/authorizer.
- Лексер префильтра ≠ лексер SQLite: NBSP между `SELECT` и `1` мой префильтр принимает (JS `\s`), SQLite отвергает (`syntax error`); `NUL` внутри текста SQLite/`node:sqlite` обрезает (`SELECT 1\0; DROP TABLE t` выполняет `SELECT 1`), префильтр отвергает; `[a;b]`, `` `a;b` ``, `';'`, комментарии с `;` — приняты корректно; неполные `/*` и `'…` — SQLite сам даёт ошибку/комментарий. Расхождения такого рода — вечный источник обходов, поэтому префильтр — только удобство сообщения и сокращение поверхности.
- Сам префильтр — вектор DoS: первая версия (посимвольная конкатенация) на 50 МБ SQL съела 1.5 ГБ RSS и таймаут (`results/v1/limits-node24-none-prefilter-uncapped.txt`). Исправлено: кап `MAX_SQL_CHARS=100 000` **до** сканирования и **до** IPC (в `SqlVerifier.verify`): 50 МБ через IPC давали 95 мс лага event loop хоста.
- Юникод: полноширинный `ＳＥＬＥＣＴ`, ZWSP перед `SELECT`, U+2028 — SQLite отвергает как токен; BOM `\uFEFF` в начале SQLite принимает как пробел, мой `\s` тоже.

## 3. Батарея угроз

Команда: `node src/battery.ts` и `/tmp/node24/node src/battery.ts` → `results/battery-node22.json`, `results/battery-node24.json` (там же по 7 профилей защиты и `note` с текстом ошибки каждого случая). Легенда: **B** — заблокировано (ошибка/отказ), **A** — выполнено, вреда не наблюдено (утечка информации/безвредно), **X** — наблюдён эффект (запись в БД, файл на диске, чтение чужого файла/скрытой таблицы). Колонки: `bare` — без всяких мер; `drv` — все механизмы драйвера **без префильтра** (`query_only`+readonly-хэндл(bs3)+defensive+limits+authorizer(только Node 24 `node:sqlite`)); последний столбец — те же плюс префильтр (по всем четырём комбинациям; `A/B` — часть комбинаций пропускает безвредный запрос). `nsq` = `node:sqlite`, `bs3` = better-sqlite3.

Ожидаемый безопасный исход для всех строк: запрос не изменяет фикстуру, не создаёт/не читает файлы, не раскрывает пути и скрытые данные.

| угроза | 22 nsq bare | 22 nsq drv | 22 bs3 bare | 22 bs3 drv | 24 nsq bare | 24 nsq drv | 24 bs3 bare | 24 bs3 drv | +префильтр |
|---|---|---|---|---|---|---|---|---|---|
| `ATTACH '/etc/passwd'` | B | B | B | B | B | B | B | B | B |
| `ATTACH ':memory:'` | A | A | A | A | A | B | A | A | B |
| `ATTACH secret.db` + `SELECT secret` | **X** | **X** | **X** | **X** | **X** | B | **X** | **X** | B |
| `ATTACH new.db`+`CREATE TABLE` (файл на диске) | **X** | **X** | **X** | B | **X** | B | **X** | B | B |
| `load_extension('/tmp/x.dylib')` | B | B | B | B | B | B | B | B | B |
| `PRAGMA writable_schema=1`+`UPDATE sqlite_master` | **X** | B | B | B | **X** | B | B | B | B |
| `VACUUM INTO '/tmp/…'` | **X** | **X** | **X** | **X** | **X** | B | **X** | **X** | B |
| `CREATE TABLE` | **X** | B | **X** | B | **X** | B | **X** | B | B |
| `CREATE TEMP TABLE … AS SELECT` | **X** | B | **X** | B | **X** | B | **X** | B | B |
| `DROP TABLE` | **X** | B | **X** | B | **X** | B | **X** | B | B |
| `INSERT` / `UPDATE` / `DELETE` | **X** | B | **X** | B | **X** | B | **X** | B | B |
| `WITH c AS (SELECT 1) DELETE …` | **X** | B | **X** | B | **X** | B | **X** | B | B |
| `SELECT 1; DROP TABLE t` (через `prepare`) | A¹ | A¹ | B | B | A¹ | A¹ | B | B | B |
| `PRAGMA query_only=OFF` + `INSERT` | **X** | **X** | **X** | B | **X** | B | **X** | B | B |
| `SELECT * FROM pragma_query_only(0)` + `INSERT` | B | B | B | B | B | B | B | B | B |
| `PRAGMA database_list` (утечка путей) | A | A | A | A | A | B | A | A | B |
| `SELECT * FROM pragma_database_list` / `pragma_compile_options` | A | A | A | A | A | B | A | A | A/B² |
| `readfile('/etc/passwd')` / `writefile(...)` | B³ | B³ | B³ | B³ | B³ | B³ | B³ | B³ | B |
| `fts3_tokenizer('simple')` | A | A | A | A | A | B | A | A | A/B² |
| `CREATE VIRTUAL TABLE … USING fts5` | **X** | B | **X** | B | **X** | B | **X** | B | B |
| `SELECT count(*) FROM dbstat` | A | A | A | A | A | A | A | A | A |
| `SELECT a FROM _hidden_answers` (скрытая таблица в БД) | **X** | **X** | **X** | **X** | **X** | B | **X** | **X** | **X**/B⁴ |
| `SELECT name FROM sqlite_master` (утечка схемы) | A | A | A | A | A | A | A | A | A |
| `CREATE TEMP VIEW` | A | B | A | B | A | B | A | B | B |
| `SAVEPOINT a` | A | A | A | A | A | B | A | A | B |
| `ANALYZE` | A | B | A | B | A | B | A | B | B |

¹ `node:sqlite` выполняет только первый оператор, хвост игнорируется; безопасно, но семантика отличается от bs3 → нужен свой префильтр.
² `SELECT … FROM pragma_*` префильтр пропускает (это SELECT); блокирует их только authorizer (Node 24 `nsq`), остальным они безвредны, но раскрывают `compile_options`/список БД (`file` пуст для `:memory:`).
³ Функций `readfile/writefile/edit/zipfile` нет в обеих сборках (`no such function`) — проверено списком `pragma_function_list` (`results/battery-node*.json`, `caps`).
⁴ Скрытые таблицы читаются в любом режиме, кроме authorizer. Правило: **секретов (ожидаемых ответов, эталонных решений) в фикстурной БД быть не должно**; expected живёт только на стороне хоста.

Наблюдения по отдельным механизмам (та же батарея, профили по одному): `query_only` один закрывает 16–17 из 30 запросов (все записи в основную/temp БД, `writable_schema`, `fts5`-vtab, `ANALYZE`), но **не** закрывает `ATTACH`, `VACUUM INTO` (пишет файл на диск даже при `query_only`+readonly на Node 22/bs3), `PRAGMA query_only=OFF` (отключается самим учеником), чтение скрытых таблиц. readonly-хэндл bs3 закрывает 17 из 30 и запрет создания файла через `ATTACH` (файла нет). authorizer Node 24: 27 из 30 заблокированы, эффектов 0 (`dbstat`, `sqlite_master`, безвредный `SELECT` остаются). `defensive` сам по себе почти ничего не меняет (закрывает `writable_schema`).

Выполненные тестами в `vitest` (Node 22: 153 passed, 1 skipped; Node 24: 154 passed): все 11 угроз × 2 драйвера дают `failed`; с **выключенным префильтром** 5 запросов (`DROP`, `INSERT`, `WITH … DELETE`, `CREATE TEMP TABLE`, `PRAGMA query_only=OFF`) на обоих драйверах остаются `failed` — драйверные меры держат сами по себе для записи. Против `ATTACH`/`VACUUM INTO`/скрытых таблиц без префильтра защищает только authorizer (тест пропускается на Node 22: `it.skipIf(!HAS_AUTHORIZER)`).

## 4. Ресурсные угрозы, таймауты, изоляция

Команды: `node src/limits.ts --mit=none` (Node 22, оба драйвера, `process` и `worker`), `/tmp/node24/node src/limits.ts --mit=none --drivers=node-sqlite,better-sqlite3 --isolations=process,…` (Node 24), `--mit=heap|rss|reslim` (§ митигации). Оркестратор запускает каждый случай в отдельном процессе; `timeoutMs=1000`, `killGraceMs=100`, `maxRows=10 000`, `maxBytes=1 MB`. Сырьё: `results/limits-*.{txt,json}`, `results/mitigations-node22.txt`, `results/leak.txt`. **Оговорка**: файлы `limits-node22-none-mixed-code.txt` и `limits-node24-none-mixed-code.txt` сняты, пока я по ходу правил префильтр (кап длины SQL появился между случаями `long-sql-*`); строки `long-sql-50mb` из v1-файла — до капа, из Node 22 и `…-process-after-fix.txt` — после капа.

### 4.1 Таймаут: worker vs процесс

| случай (1000 мс лимит) | isolation | verdict | wall | kill | лаг main | RSS до kill | следующая проверка |
|---|---|---|---|---|---|---|---|
| бесконечный рекурсивный CTE `count(*)` | process | error/timeout | 1102 мс | 1–2 мс | 2 мс | 80–88 МБ (рост нет) | 44–48 мс (новый процесс) |
| то же | worker | error/timeout | 2602 мс (1500 — мой потолок ожидания `terminate`) | **не завершился** | 1–2 мс | хост 99→112 МБ | 24–27 мс (новый worker), **утёкший поток крутится**, `process.exit` зависает |
| CTE с `UNION` (растущий dedupe), 4-way cross join 1000⁴ | process | error/timeout | 1102–1109 мс | 1–8 мс | 2 мс | 80–103 МБ | 41–47 мс |
| то же | worker | error/timeout | 2600 мс | не завершился | 1–2 мс | 101→138 МБ | то же |

`src/leak.ts` (`results/leak.txt`) на всех 4 комбинациях: `terminate()` pending после 2000 мс; за следующие 4 с процесс израсходовал 3.97–3.99 с CPU (**0.99–1.00 core**); event loop хоста отзывчив; `process.exit(0)` не возвращает управление 15 с (`timeout` → 124), `exit`-handler отработал через 0 мс, но выход не завершается. В Electron это означало бы неубиваемый ядро-пожиратель и зависание при закрытии приложения. `[ВЫВОД]` если такой запрос всё же нужно выполнять в worker, единственный выход — SIGKILL самого процесса, т.е. это опять процесс.

Не бесконечные, но CPU-тяжёлые: `ORDER BY` по 5 млн сгенерированных строк с `LIMIT 5` — 333–365 мс, `mismatch` (завершился штатно, укладывается в 1 с).

### 4.2 Память и «большие значения»

| случай | Node 22 `nsq` | Node 22 bs3 | Node 24 `nsq` (limits.length=1e6) | Node 24 bs3 |
|---|---|---|---|---|
| `length(randomblob(1e9))` | выполнился (~1 с), child peak **1035 МБ** | 1 мс `string or blob too big`, 82 МБ | 1 мс, 86 МБ | 1 мс, 88 МБ |
| `SELECT zeroblob(1e9)` (в JS) | 95–123 мс, child peak **1989 МБ**, отсечён `maxBytes` уже после аллокации | 1 мс отказ | 1 мс отказ | 1 мс отказ |
| удвоение строки до 6·10⁸ (`x\|\|x`) | child peak **4170 МБ**, kill по таймауту (55–68 мс) | peak **3162 МБ**, отказ `too big` на ~0.9 с | 1 мс, 87 МБ | peak **3168 МБ** |
| `printf('%1000000000s','')` | выполнился (`mismatch`), 80 МБ | отказ 1 мс | (см. limits.length; не гонял отдельно) | — |
| 10 млн строк через CTE | `row_limit` за 4–5 мс | то же | то же | то же |
| SQL 8 МБ `IN (1,1,…)` | `sqlite_limit` 26 мс, child peak 111 МБ | то же | — | — |
| SQL 50 МБ пробелов | после капа: отказ 10 мс (worker)/148 мс (process, лаг main 95 мс из-за сериализации по IPC); до капа: **1.5 ГБ** RSS + таймаут | то же | — | 79 мс |
| 200k вложенных `(`, 5000 вложенных подзапросов, 3000-членный `UNION ALL`, join из 100 таблиц | отказ 1–10 мс (лимиты SQLite `exprDepth 1000`, `compoundSelect 500`, join 64) | то же | то же | то же |

Разница `node:sqlite` vs bs3 на 1e9: bs3 отклоняет `randomblob(1e9)`, `node:sqlite` 22 — нет (объяснение не найдено `[НЕ ПОДТВЕРЖДЕНО]`; обе сборки показывают `MAX_LENGTH=1000000000`). Вывод: полагаться на дефолтные лимиты нельзя, нужен `db.limits.length` либо внешний RSS-лимит.

### 4.3 Чем ограничивается рост памяти (митигации, Node 22)

| мера | результат |
|---|---|
| RSS-watchdog над child (порог 400 МБ, опрос `ps` каждые 20 мс) | `randomblob(1e9)`: kill на пике **400 МБ** через 336 мс; `zeroblob`: 488 МБ за 28 мс; удвоение строки: 378 МБ/443 МБ за 69–90 мс; kill 4–7 мс; новая проверка через 42–52 мс. Перерегулирование ≤ ~90 МБ на 20 мс опроса (наблюдение) |
| `PRAGMA hard_heap_limit=200000000` | **не сработало** (peak 4170 МБ) |
| `resourceLimits.maxOldGenerationSizeMb=64` у worker | **не сработало** для SQLite malloc: host RSS 100 → 4764 МБ; после `terminate` 4714 МБ (в течение теста RSS не вернулся) |
| `db.limits.length=1e6` (Node ≥24.15 `nsq`) | все «большие значения» отсекаются за 1 мс без роста RSS |
| `PRAGMA max_page_count` | не измерял `[НЕ ПОДТВЕРЖДЕНО]` (ограничивает только размер БД, не память запроса) |

Память процесса после kill возвращается ОС немедленно (процесс исчезает); для worker (при успешном `terminate`) RSS хоста в тесте не уменьшился (4714 МБ).

## 5. Определённость и переносимость (SQLite 3.51.3 vs 3.53.4)

Команда: `node src/portability.ts` и `/tmp/node24/node src/portability.ts` → `results/portability-node22.json`, `…-node24.json` (41 проба × 2 драйвера × 2 Node = 4 конфигурации). Сравнение: `python3` скрипт из отчёта (diff по ключам JSON).

- **38/41 проб идентичны** на четырёх комбинациях (3.51.3 и 3.53.4): `0.1+0.2`→`0.30000000000000004`, `1e15+0.3`, `-0.0`, переполнение integer→real (`9223372036854775807+1`), `7/2=3`, `-7/2=-3`, `-7%3=-1`, `round(2.5)=3`, `round(-2.5)=-3`, `round(2.675,2)=2.67`, `typeof(avg)=real`, `typeof(sum(int))=integer`, `CAST('1e3' AS INTEGER)=1`, `printf`, COLLATE/сравнение `'10'<'9'`, `lower('ÉCOLE')` (без ICU — не трогает не-ASCII), `length('日本語')=3`, JSON-функции, `unixepoch/date/strftime`, `concat`, `string_agg`, `iif`, математические функции, оконные `ntile/percent_rank/cume_dist/first_value/last_value`, рамка по умолчанию `RANGE … CURRENT ROW` с peers (`sum` даёт 270/270 для ничьей), `row_number() OVER ()`, `IS DISTINCT FROM`. Тексты ошибок (`no such column: "Eng" - should this be a string literal in single-quotes?`) тоже совпали.
- **Порядок без `ORDER BY`**: `GROUP BY dept_id` → `NULL,1,2` (сортировкой групп), `DISTINCT dept_id` → `1,2,NULL`, `SELECT name FROM emp` → rowid-порядок; на этих маленьких данных **одинаково** на всех 4 конфигурациях. Это не гарантия SQL и может измениться при `ANALYZE`/индексах/другом плане (у bs3 есть `ENABLE_STAT4`, у `node:sqlite` нет); поэтому сравнение без порядка по умолчанию.
- **Различия** (всего 3 пробы + справочники): `sqlite_version()`; `median()`/`percentile()` **отсутствуют в `node:sqlite` Node 22** (3.51.3, нет `ENABLE_PERCENTILE`; функции `median, percentile, percentile_cont, percentile_disc` появились в списке `pragma_function_list` в 3.53.4, а также в bs3 3.53.4) — тест на Node 22 с `node:sqlite` упал бы, в проде прошёл бы; `soundex` только в bs3; `json_array_insert/jsonb_array_insert` только в 3.53.4. Тексты ошибок для неизвестной функции — единственная «версия-зависимая» строка.
- Форматирование float происходит в JS (`String(number)`), а не в SQLite, поэтому идентично; для сравнения используем числа, а не строки.

### Рекомендованные правила сравнения `[ВЫВОД, проверено на 30 проверках + 4 конфигурациях]`
1. **Мультимножество строк по умолчанию** (сортировка ключами `NULL < число < текст < blob` + сравнение), `orderSensitive:true` только когда порядок — предмет вопроса (`ORDER BY … LIMIT`). Дубликаты считаются (`DISTINCT` вместо повторов → `failed`).
2. **Числа**: `INTEGER` vs `REAL` с одинаковым значением равны (`1` == `1.0`); допуск `|a−b| ≤ tol·max(1,|a|,|b|)`, по умолчанию `tol=1e-9`, `0` = точное сравнение (`0.1+0.2` vs `0.3` проходит по умолчанию и падает при `tol=0`; тесты). `bigint` сравнивается точно.
3. **Типы вне числовых не смешиваются**: `TEXT '1'` ≠ `INTEGER 1`; в CSV значение в кавычках = TEXT; blob сравнивается побайтно.
4. **NULL**: `NULL == NULL` для сравнения результатов (в отличие от SQL); пустое поле CSV без кавычек = NULL, `""` = пустая строка.
5. **Имена столбцов**: по умолчанию регистронезависимо и в порядке (`ignoreColumnNames` — сравнивать по позициям; `columnOrder:'any'` — допускать перестановку по именам, а при `ignoreColumnNames` по мультимножеству значений столбца).
6. Тексты ошибок SQLite и `sqlite_version()` в вердикт не включать (различаются между версиями).

## 6. Производительность

Команда: `NODE_NO_WARNINGS=1 node src/perf.ts 1000` (Node 22) и `/tmp/node24/node src/perf.ts 1000` → `results/perf-node22.txt|json`, `perf-node24.txt|json`. 30 проверок из `checks.ts` по кругу, фикстура 9 строк (то есть цифры — нижняя граница накладных расходов, реальные фикстуры будут дороже), 1 хост, `cpus` — многоядерный Mac. Сценарии `worker fresh` 300 проверок, `process fresh` 200 проверок; остальные 1000. Задержка = от `verify()` до вердикта.

Node 22.22.3:

| режим | драйвер | p50 | p95 | 1000 проверок | проверок/с |
|---|---|---|---|---|---|
| in-process, новая `:memory:` БД на проверку | node:sqlite | 0.04 мс | 0.06 | 40 мс | 24 779 |
| | bs3 | 0.06 | 0.09 | 69 мс | 14 511 |
| worker, тёплый пул ×1 | nsq / bs3 | 0.06 / 0.09 | 0.11 / 0.12 | 67 / 97 мс | 14 956 / 10 308 |
| worker, тёплый пул ×4 (c=4) | nsq / bs3 | 0.12 / 0.15 | 0.21 / 0.29 | 33 / 47 мс | 30 151 / 21 453 |
| process, тёплый пул ×1 | nsq / bs3 | 0.07 / 0.10 | 0.17 / 0.19 | 87 / 115 мс | 11 451 / 8 705 |
| process, тёплый пул ×4 (c=4) | nsq / bs3 | 0.14 / 0.15 | 0.28 / 0.30 | 40 / 49 мс | 25 061 / 20 294 |
| worker, свежий на проверку | nsq / bs3 | 23.2 / 25.8 мс | 25.0 / 27.8 | ≈22.7 / 25.4 **с** (экстраполяция из 300) | 44 / 39 |
| process, свежий на проверку | nsq / bs3 | 44.0 / 45.1 мс | 47.3 / 47.9 | ≈44.4 / 45.3 **с** (из 200) | 23 / 22 |

Старт пула: worker ×1 19–23 мс, ×4 27–28 мс; process ×1 40–42 мс, ×4 44–47 мс. Node 24 — те же порядки (p50 warm process ×1: nsq 0.06 мс, 13 965/с; bs3 0.09 мс, 7 943/с; fresh process 45–47 мс; fresh worker 23–26 мс; см. `perf-node24.txt`).

Восстановление после kill: `process` — следующая проверка 41–52 мс (spawn), `worker` — 24–28 мс (но утёкший поток остаётся, §4.1).

## 7. Рекомендуемый дизайн `SqlVerifier`

**Драйвер.** Порт `Verifier` в ядре остаётся синхронным `(check) → verdict` поверх `SqlRunnerClient`. Раннер — отдельный модуль внутри дочернего процесса; выбор драйвера внутри раннера:
- Основной кандидат `[ВЫВОД]`: **`node:sqlite` при Node ≥ 24.15** (Electron 44 — Node 24.21): authorizer (27/30 угроз закрыто, эффектов 0), `db.limits.length/sqlLength/exprDepth/vdbeOp…`, `defensive`. Это единственная конфигурация, где защита не зависит от префильтра.
- Запасной режим для CI на Node 22 и для bs3: `query_only` + readonly-хэндл (bs3: `serialize()`→readonly) + префильтр + RSS-watchdog; закрывает 100% угроз батареи **только вместе с префильтром**; без него остаются `ATTACH`, `VACUUM INTO`, скрытые таблицы. Это допустимо только пока фикстура не содержит секретов, а у процесса нет доступа к чужим файлам (ОС-песочница ниже).
- Отдельный SQLite-драйвер для проверок (`node:sqlite`) в приложении, где ядро на better-sqlite3, — допустимая цена: оба лежат в одном процессе Electron (`utilityProcess`), нативных зависимостей `node:sqlite` нет.

**Изоляция.** `child_process.fork` / Electron `utilityProcess`, **не** `worker_threads`. Пул из N процессов (N = min(4, cores−1)); один процесс = один запрос за раз.

**Протокол** (реализован, `src/worker.ts`): host→runner `{type:'check', id, req:CheckRequest}`; runner→host `{type:'ready'}` при старте, затем `{type:'verdict', id, verdict, rssKb}`. Вердикт возвращается один раз; ответ с чужим `id` игнорируется. Если runner молчит `timeoutMs + grace(100 мс)` — host убивает процесс (`SIGKILL`) и возвращает `error/timeout`; если процесс умер сам — `error/worker_crash`; убитый/упавший процесс из пула выбрасывается и заменяется новым.

**Политика пула.** Тёплый пул на старте движка (40–50 мс; можно лениво на первом вопросе), `recycleAfter` ≈ 500–1000 проверок (страховка от накопления фрагментации; в тесте утечек не измерял `[НЕ ПОДТВЕРЖДЕНО]`), очередь при исчерпании; kill → немедленный респавн в фоне; при `process`-режиме RSS-watchdog `ps -o rss= -p` каждые 20 мс во время исполнения. Нужен и в Electron: на Windows `ps` нет — замена `process.getProcessMemoryInfo`/`pidusage`-подобный вызов `[НЕ ПОДТВЕРЖДЕНО]`.

**Лимиты по умолчанию** `[ВЫВОД по измерениям]`: `timeoutMs 2000` (в курсе так и задано, `timeout_ms: 2000`; обычные проверки занимают < 1 мс), `maxRows 10 000`, `maxBytes 1 000 000`, `MAX_SQL_CHARS 100 000` (в хосте, до IPC), RSS-порог процесса 256–400 МБ (измеренный пик при пороге 400 — до 488 МБ), `db.limits.length=1e6`, `sqlLength=100 000` (Node 24), `grace 100 мс`.

**Семантика вердикта** (реализована и покрыта тестами):
- `passed / ok` — результат совпал с ожиданием по правилам §5.
- `failed` — ошибка ученика, оценка «неверно», событие засчитывается: `mismatch`; `sql_error` (синтаксис, нет таблицы/столбца, `not a select`); `forbidden` (`INSERT/DROP/ATTACH/PRAGMA…`, несколько операторов, `not authorized`, `readonly database`, запрос без столбцов); `row_limit`; `byte_limit`; `sqlite_limit` (слишком длинный SQL/значение/глубина).
- `error` — **не вина ученика, событие оценки не записывается** (`recordAttempt` без результата, повтор разрешён): `fixture_error`/`expected_error` (баг курса; должны ловиться компилятором курса F2 при сборке, прогоном эталонного решения), `timeout` (зависит от машины; **но** бесконечный CTE ученика тоже `timeout` — с точки зрения ученика неотличимо от медленной машины; `[ВЫВОД]` считать `timeout` ошибкой ученика только если эталонное решение проходит на этой же машине быстрее `timeoutMs/10`, иначе не засчитывать), `resource_kill` (RSS-лимит; то же правило), `worker_crash`, `internal`.
- Конфликт с текущим дизайном: в `engine-ts-api.md` ошибки `VERIFIER_UNAVAILABLE/VERIFIER_TIMEOUT` — «второй — да (ретрай)»; по данным спайка, `timeout` = `error/timeout`, не `failed`.
- `detail` (ожидаемые строки) выдаётся только с `revealExpected` (режим автора), иначе ученик получает `reason` без утечки эталона.

**Hardening-стек в раннере (порядок)**: (1) хост: кап длины SQL; (2) префильтр (только удобство и сообщения); (3) свежая `:memory:` БД из фикстуры; (4) для bs3 — `serialize()` → readonly-reopen; (5) `PRAGMA query_only=ON`; (6) `nsq` Node ≥ 24: `limits`, `defensive`, `setAuthorizer` (allow-list `SELECT/RECURSIVE/READ/FUNCTION`, deny-list функций `load_extension/readfile/writefile/edit/fts3_tokenizer`, deny таблиц-скрытых); (7) итерация с капами строк/байт; (8) убийство процесса по таймауту/RSS.

### CI-матрица `[ВЫВОД]`
- Основной прогон — Node 22.22 (dev): `tsc --noEmit`, `vitest run`: 153 passed, 1 skipped (`authorizer` — `it.skipIf(!setAuthorizer)`); драйверы bs3 и `node:sqlite`.
- Обязательный второй job — Node 24.x (совпадает с Electron 44): 154 passed (authorizer включён). Тесты, зависящие от возможностей Node 24 (`setAuthorizer`, `limits`, `enableDefensive`), обязаны пропускаться через feature-detection, **а не через версию Node**.
- Ожидания к SQLite-функциям (`median`, `percentile`, `json_array_insert`) не использовать в эталонных решениях, пока в матрице есть `node:sqlite` 3.51.3 (или проверять на компиляции курса F2 обе версии).
- Battery-регрессия (`src/battery.ts`) как контрактный тест: для каждого профиля фиксировать ожидаемую матрицу B/A/X, падать при появлении новой `X` в профиле `full`.

## 8. Остаточные риски (не закрыты)

1. **ОС-уровень не изолирован**: процесс раннера имеет права пользователя. Без authorizer `ATTACH '<чужая sqlite-БД>'` читает файлы (в `bare`/`query_only`; в полном профиле закрыт только префильтром). Смягчение: authorizer (Node 24), запуск раннера в песочнице ОС (macOS `sandbox-exec`/App Sandbox, Windows AppContainer, Linux seccomp/namespaces) `[НЕ ПОДТВЕРЖДЕНО — не пробовал]`.
2. **Память до срабатывания watchdog**: без `db.limits.length` (Node 22, bs3) процесс может выделить до ~1–4 ГБ за доли секунды; watchdog с опросом 20 мс ловит с перелётом до ~90 МБ (измерено), но при более быстрой аллокации и/или медленном `ps` (нагруженная система) перелёт растёт. Для bs3 нет ни `limits`, ни рабочего `hard_heap_limit`.
3. **Отсутствие прерывания**: любой драйвер — только kill. На Windows/Linux поведение `kill` и `ps` не проверял `[НЕ ПОДТВЕРЖДЕНО]`. Цена — 40–52 мс на респавн после каждого зависшего запроса; злонамеренный ученик может тратить по 1.1 с CPU на попытку (нужен rate limit на попытки, вне спайка).
4. **Утёкший поток worker** — риск только если кто-то выберет `worker_threads`; в рекомендуемом дизайне не используется.
5. **Раскрытие схемы**: `sqlite_master`, `dbstat`, `pragma_*` доступны даже с authorizer (мой allow-list разрешает `READ`), фикстура должна считаться публичной.
6. **Недетерминизм плана без `ORDER BY`**: одинаково на 4 конфигурациях на 9-строчной фикстуре, но не гарантия; на больших фикстурах с индексами/`ANALYZE`/`STAT4` возможны расхождения → мультимножественное сравнение по умолчанию, а `orderSensitive:true` — только с полным `ORDER BY` в эталоне и проверкой, что порядок эталона детерминирован (включая NULL и ничьи).
7. **DDL/DML-уроки** (в реальном курсе `ddl.lesson`) не покрыты моделью «один SELECT» (§1).
8. **Классификация ошибок по тексту сообщений** (`/not authorized|readonly|.../`) хрупка: тексты различаются по драйверам/версиям (`deep-subquery`: `sqlite_limit` у `node:sqlite`, `sql_error` у bs3). Безопасность от этого не зависит (оба — `failed`), но `reason` для UI нестабилен; лучше классифицировать по `errcode` (`node:sqlite` его отдаёт, bs3 — `code`).
9. Один ученик — один проверочный процесс; параллельная нагрузка ×N процессов и пиковая память пула не измерялись `[НЕ ПОДТВЕРЖДЕНО]`.
10. Не проверены: win32/linux, `utilityProcess` внутри настоящего Electron 44 (спайк — просто Node 24.21 без Electron).

## 9. Что вызвало трение

1. **Референсный курс неполный**: все 21 вопроса `lib_kb` ссылаются на несуществующие `fixtures/*.sql` и `sql/*.expected.csv`; текст вопросов — заглушки; `lib_json` — те же заглушки (`exercise_manifest.json` без блока `check`). Пришлось написать свои фикстуры и 30 проверок.
2. `worker.terminate()` не прерывает нативный вызов; `process.exit` зависает; ни в `node:sqlite`, ни в bs3 нет `interrupt` — из этого следует переход на процессы (в дизайне `engine-ts.md` сказано «завершение worker по тайм-ауту»: **неверно**, править).
3. `node:sqlite` на Node 22: нет `setAuthorizer`/`limits`/`enableDefensive`; **опция `defensive` в конструкторе молча игнорируется** (нет ошибки) — легко решить, что защита включена.
4. `node:sqlite.prepare` молча отрезает хвост многооператорного текста; bs3 бросает исключение — разная семантика при одном и том же «безопасном» коде.
5. bs3 не открывает `:memory:` как `readonly` (`TypeError`); обход `serialize()`+`new Database(buf,{readonly:true})` работает и даёт readonly-хэндл, но стоит копию БД на проверку.
6. `PRAGMA hard_heap_limit` бесполезен в обеих сборках (`DEFAULT_MEMSTATUS=0`, гипотеза), `resourceLimits` воркера не видит нативную память.
7. `node:sqlite`: строки — объекты с null-прототипом; для целых нужно вызывать `setReadBigInts(true)` и `setReturnArrays(true)` на каждом `StatementSync`; в bs3 — `safeIntegers(true)`/`raw(true)` на statement и `statement.reader` для отсечения `WITH … DELETE`.
8. `erasableSyntaxOnly` в tsconfig + `node --experimental-strip-types`: parameter properties в `class Abort` ломают запуск (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`); использовал явные поля. Прогон `.ts` напрямую Node 22.22 и 24.21 без tsx работает при `import … from './x.ts'`.
9. Префильтр посимвольной конкатенацией — сам DoS-вектор (1.5 ГБ на 50 МБ SQL); ограничение длины должно стоять до всякого сканирования и до IPC.
10. `ExperimentalWarning` `node:sqlite` на Node 22 засоряет вывод (`NODE_NO_WARNINGS=1`).
11. Получение Node 24: `npx -y -p node@24 node -v` → `v24.21.0`; бинарник лежит в кэше `~/.npm/_npx/<hash>/node_modules/node/node_modules/node-bin-darwin-arm64/bin/node` (хэш меняется; найти `find ~/.npm/_npx -path '*node-bin-darwin-arm64/bin/node'`), скопирован в `/tmp/node24/node`. Vitest под Node 24 запускается как `/tmp/node24/node node_modules/vitest/vitest.mjs run`.

## 10. Воспроизведение

```sh
cd engine-ts/spike/sql-runner && npm ci
# Node 24 (Electron 44 = Node 24.21): один раз
npx -y -p node@24 node -v                      # v24.21.0
mkdir -p /tmp/node24 && cp "$(find ~/.npm/_npx -path '*node-bin-darwin-arm64/bin/node' | head -1)" /tmp/node24/node
N24=/tmp/node24/node; export NODE_NO_WARNINGS=1

npx tsc --noEmit                               # чисто
npx vitest run                                 # Node 22: 153 passed | 1 skipped (authorizer)
$N24 node_modules/vitest/vitest.mjs run        # Node 24: 154 passed

node src/battery.ts;  $N24 src/battery.ts      # §3 (results/battery-node{22,24}.json)
node src/portability.ts; $N24 src/portability.ts   # §5
node src/leak.ts better-sqlite3                # §4.1: terminate() pending, 1 core, exit hangs (наблюдать до 15 с; Ctrl-C/kill)
node src/limits.ts --mit=none                  # §4.1-4.2 Node 22 (≈3 мин: worker-случаи висят до 25 с)
$N24 src/limits.ts --mit=none --drivers=node-sqlite,better-sqlite3 --isolations=process --only=inf-cte-count,string-doubling,randomblob-1e9,zeroblob-1e9-out,long-sql-50mb,deep-subquery,cross-join
node src/limits.ts --mit=rss  --isolations=process --only=string-doubling,randomblob-1e9,zeroblob-1e9-out   # §4.3
node src/limits.ts --mit=heap --isolations=process --only=string-doubling
node src/limits.ts --mit=reslim --isolations=worker --only=string-doubling
node src/perf.ts 1000; $N24 src/perf.ts 1000  # §6
```

`node_modules/`, `/tmp/node24`, `/tmp/sqlr-battery` удалены/не хранятся; в каталоге спайка остаются исходники, `package-lock.json`, фикстура, `results/` (≈0.4 МБ). Файлы `results/limits-*-mixed-code.txt` — см. оговорку в §4.

## 11. Не сделано / не подтверждено

- Режим `script` для DDL/DML-уроков (§1) — не реализован `[НЕ ПОДТВЕРЖДЕНО]`.
- Windows/Linux, реальный Electron `utilityProcess`, ОС-песочница, рост памяти пула при ротации, `PRAGMA max_page_count`, причина различия `randomblob(1e9)` между драйверами — не проверялись.
- Симуляции нет; модель ученика не использовалась (проверки детерминированы и не зависят от неё).
- Замеры производительности сняты на 9-строчной фикстуре одиночным прогоном (не статистика по многим запускам): p50/p95 из одного запуска 1000/300/200 проверок.
