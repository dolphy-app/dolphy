# @lms/desktop

Настольное приложение: Electron + Vue 3 + Vite. Слой бизнес-логики (`@lms/engine`) живёт в `utilityProcess`, UI видит его как `LearningEngine` из `@lms/engine-contract`. Проект: `engine-ts/design/engine-ts-electron.md` (§9–§14).

## Архитектура

```
renderer (Vue, sandbox)      preload (CJS, sandbox)     main                         utilityProcess «lms-engine»
src/**  ─ LearningEngine ─►  window.lms.{engine,platform} shells + supervisor          electron/host
        ◄─ MessagePort (RpcRequest / RpcResponse / RpcPush) ─ порт выдаёт main ─►     dispatcher + engine
                                                                                        SQLite (engine.db)
                                                                                        раннер SQL: fork → ELECTRON_RUN_AS_NODE
```

| Каталог             | Что                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/main`     | `index.ts` — только проводка; `shells/{window,engine,platform,lifecycle}.ts`; `supervisor.ts` — запуск, backoff, выдача портов                                                                                       |
| `electron/preload`  | узкий мост `window.lms`; порт до страницы: main → preload → `window.postMessage`                                                                                                                                     |
| `electron/host`     | `index.ts` (вход `utilityProcess`), `boot.ts` (сборка зависимостей и `createEngine`), `sql-worker.ts` (процесс раннера SQL)                                                                                          |
| `shared/bridge.ts`  | тип `LmsBridge` и имена каналов (включён в оба tsconfig)                                                                                                                                                             |
| `src/app`           | вход `main.ts`, `App.vue`, плагины Vuetify (тема) и vue-i18n (`providers`), каталог сообщений и типы ключей (`i18n`), маршруты (`router`), боковое меню (`layouts`), экран ошибки запуска, сценарии смоука (`smoke`) |
| `src/pages`         | экраны, слайсы FSD: `daily-plan` (план дня), `session` (учебная сессия), `settings` (настройки); у каждого свой `i18n/` с сообщениями `ru` и `en`                                                                    |
| `src/shared`        | клиент движка (`api/engine`), конфигурация (маршруты, размер плана, причины упражнений), `i18n` (выбор языка, русские формы множественного числа, общие сообщения)                                                   |
| `shared/smoke.ts`   | имена смоука (каналы, аргумент, тип моста) — достижимы только за флагом сборки                                                                                                                                       |
| `scripts/smoke.mjs` | смоук в настоящем Electron: неупакованный и упакованный                                                                                                                                                              |
| `test`              | vitest (node): супервизор и шеллы на фейках Electron; «релизный бандл без смоука»                                                                                                                                    |

Сборка (`vite build`) даёт `dist/` (renderer) и `dist-electron/{main,preload,host}`. Preload собирается в CJS (`index.cjs`): при `sandbox: true` Electron не грузит ESM-preload. Хост — ESM-бандл со всеми workspace-пакетами; снаружи остаётся только нативный `better-sqlite3` (N-API prebuild, в упаковке — `asarUnpack`). Вход `sql-worker.js` собирается тем же вызовом.

## UI

Интерфейс — Feature-Sliced Design (`app` → `pages` → `shared`; `features` и `entities` появятся, когда код реально понадобится нескольким экранам). Алиас `@` → `src`. Компоненты — Vuetify 4, тема «индиго + бирюзовый» (светлая и тёмная). Renderer грузится через `file://`, поэтому роутер — на hash-истории. CSP разрешает шрифты (`font-src 'self' data:`) — без этого не грузятся иконки MDI.

**Локализация** — `vue-i18n` (Composition API), языки `ru` и `en`. Сообщения лежат в слайсе (`pages/<слайс>/i18n/{ru,en,index}.ts`), общие — в `shared/i18n`, оболочка — в `app/i18n`; `app/i18n/messages.ts` собирает каталог, `app/i18n/vue-i18n.d.ts` типизирует ключи по каталогу `ru` (опечатка в `t('…')` — ошибка `vue-tsc`, `en: typeof ru` не даёт разойтись наборам ключей). Русские формы — четыре варианта `ноль | один | несколько | много` (`russianPluralRule`), английские — три. Языки и тема выбираются в «Настройках → Внешний вид»; `system` берёт язык системы (неподдерживаемый — английский). Встроенные строки Vuetify берутся из того же каталога (адаптер `createVueI18nAdapter`). Не переводятся данные движка: названия курсов, уроков и упражнений, `feedback` раннера, тексты ошибок движка.

**Хранение настроек** — в `engine.db` (SQLite), не в файлах и не в `localStorage`: опции планировщика (только отличия от умолчаний), предпочтения, сохранённые фильтры и сессии, тема и язык интерфейса. Устройства не синхронизируют настройки друг с другом.

Прежние настройки в JSON (`dataDir/settings`: `user_preferences.json`, `filters/`, `study_sessions/`) при первом запуске переносятся в БД одной транзакцией (`importLegacySettings`, вызывается из `electron/host/boot.ts`). Отметка `legacy_settings_imported` в таблице `setting` делает перенос одноразовым; записи, уже лежащие в БД, не перезаписываются; битый файл — предупреждение в лог без частичного переноса, перенос повторится после исправления. Файлы остаются на месте и больше не читаются.

Layout берётся из `assets/wireframes-screens.pdf`, палитра — своя. Экраны реализуются по важности; данные — только из контракта `LearningEngine`, поэтому элементы wireframes без данных в движке (серия дней, время, «Reschedule», ИИ-действия) не рисуются.

| Этап | Экраны                                                                                                                                                       | Состояние               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 1    | боковая оболочка, план дня (`plan.getDay`, `practice.getDue`), учебная сессия (SQL-раннер и самооценка, `beginAttempt` → `submitAnswer` → `completeAttempt`) | сделано                 |
| 2    | граф знаний (`library.getGraph`, `practice.getProgress`)                                                                                                     | —                       |
| 3    | настройки: обучение (планировщик), библиотека (состояние, пропускаемые папки), внешний вид (тема, язык), о движке; профиль — нужно локальное хранилище       | сделано                 |
| 4    | аналитика (`getProgress`, `getAttempts`; нужны агрегаты)                                                                                                     | —                       |
| 5    | Vault и «Добавить контент» (в движке нет приёма материалов)                                                                                                  | ждёт решения по бэкенду |
| 6    | командная палитра поиска (`library.matchPrefix`)                                                                                                             | —                       |

## Команды

| Команда                                     | Что делает                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm dev`                                  | Vite + Electron (из корня репозитория)                                                       |
| `pnpm dev:seed`                             | копирует в `<userData>/library` SQL-курс и курсы из `dev-library/` (Git, HTTP, JavaScript)   |
| `pnpm dev:reset`                            | стирает прогресс (журнал попыток и сессии) в `<userData>/data/engine.db`, настройки остаются |
| `pnpm -F @lms/desktop typecheck`            | `vue-tsc` для renderer/preload и для main/host/тестов                                        |
| `pnpm -F @lms/desktop test`                 | тесты супервизора и шеллов (входят в корневой `pnpm test`)                                   |
| `pnpm -F @lms/desktop build:app`            | только `vite build`                                                                          |
| `pnpm -F @lms/desktop build` (`pnpm build`) | типы, `vite build`, `electron-builder` (пакет приложения)                                    |
| `pnpm -F @lms/desktop smoke`                | смоук-сборка и сквозной смоук в настоящем Electron                                           |
| `pnpm -F @lms/desktop smoke:packaged`       | то же в упакованном неподписанном `.app` (из корня: `pnpm smoke:packaged`)                   |

## Dev-данные

Каталог `userData` dev-запуска — `~/Library/Application Support/@lms/desktop` (macOS), `$XDG_CONFIG_HOME` или `~/.config/@lms/desktop` (Linux), `%APPDATA%\@lms\desktop` (Windows; пути Linux и Windows заданы по документации Electron и не проверялись). Библиотека лежит в `library/`, журнал и настройки — в `data/engine.db`. Другой каталог задаёт `--user-data <каталог>`, например для упакованного приложения (`LMS`).

- `pnpm dev:seed` — курсы: `sql_kb` (образцовый, фикстура движка) и `git_kb`, `http_kb`, `js_kb` из `dev-library/` (по 3 урока × 3 упражнения с самооценкой, на русском). Повторный запуск перезаписывает эти файлы, чужие курсы не трогает. Приложение подхватит курсы при запуске или по «Настройки → Библиотека → Перечитать». Проверка библиотеки: `pnpm -F @lms/engine engine-cli validate <каталог>`.
- `pnpm dev:reset` — удаляет строки `log_entry`, `log_conflict`, `imported_segment`, `study_session`; `setting`, `saved_filter` и `meta` (id устройства) остаются. Правка БД в обход движка: журнал append-only и синхронизируется, поэтому команда только для dev-данных. Приложение должно быть закрыто: на macOS и Linux скрипт отказывается работать, если `SingletonLock` указывает на живой процесс (на Windows этой проверки нет).

## Смоук

Код смоука (шелл в main, мост в preload, сценарии в renderer, лог раннера в хосте) существует **только в смоук-сборке**: `LMS_SMOKE_BUILD=1 vite build` выставляет через `define` константу `__LMS_SMOKE_BUILD__` в `true` и пишет в `dist-smoke/`. В обычной сборке константа `false`, код за ней вырезается, а все имена смоука собраны в `shared/smoke.ts` и недостижимы: релизный `dist/` и `dist-electron/` не содержат ни `smoke` (без учёта регистра), ни id упражнения сценариев. Это проверяет `test/release-bundle.test.ts`: он сам собирает релизный вариант `vite build` во временный каталог (`LMS_BUILD_OUT`) и ищет маркеры, а для смоук-варианта проверяет, что те же маркеры находятся (детектор не слепой). Сборка в упакованный `.app` идёт только из `dist-smoke/`, штатный `pnpm build` его не касается.

Режим включается `LMS_SMOKE=1` в окружении (и только в смоук-сборке). Запуск — со скрытым окном, временным `userData` и копией библиотеки `sql-course` (`packages/engine/test/fixtures/libraries/sql-course/lib_kb`). Renderer выполняет сценарии через настоящий путь renderer → preload → main → хост → движок и сообщает итог main, тот печатает `LMS_SMOKE_RESULT …` (в том числе `packaged`) и выходит с кодом 0 или 1:

1. `basic` — `library.getInfo`, `recordAttempt`, повторный `recordAttempt` (`duplicate: true`), событие `progress`;
2. `sql` — `beginAttempt` / `submitAnswer` (неверный и верный SQL) / `completeAttempt`; проверку выполняет процесс раннера, порождённый из `utilityProcess`;
3. `crash` — убийство хоста, перезапуск супервизором, переподключение клиента, повтор идемпотентного вызова, `duplicate: true` после рестарта (журнал на диске), `progress` после переподключения.

- `pnpm smoke` — смоук-сборка и запуск неупакованного приложения (`electron dist-smoke/dist-electron/main/index.js`).
- `pnpm smoke:packaged` — та же сборка, упакованная `electron-builder --dir` без подписи (`CSC_IDENTITY_AUTO_DISCOVERY=false`) во временный каталог вне репозитория; запускается бинарник `.app`: хост и раннер грузятся из `app.asar`, `better-sqlite3` — из `app.asar.unpacked`, раннер стартует с `ELECTRON_RUN_AS_NODE`. Скрипт сверяет `packaged` в отчёте, наличие `app.asar` и `app.asar.unpacked` и после выхода ждёт до 5 с, затем убивает и считает ошибкой любые оставшиеся процессы из каталога упакованного приложения. Проверено на macOS arm64; пути бинарника для Linux и Windows заданы по раскладке electron-builder и не проверялись.
- `--verbose` печатает stderr хоста и main и вывод сборки.

## Безопасность

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; навигация запрещена, `window.open` отклоняется; CSP — «запретить всё» (в dev добавляется websocket для HMR); `ipcMain` принимает только от верхнего фрейма; мост не отдаёт `ipcRenderer`; аргументы RPC валидируются zod на хосте.
