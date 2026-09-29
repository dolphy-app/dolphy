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

| Каталог             | Что                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `electron/main`     | `index.ts` — только проводка; `shells/{window,engine,platform,lifecycle}.ts`; `supervisor.ts` — запуск, backoff, выдача портов |
| `electron/preload`  | узкий мост `window.lms`; порт до страницы: main → preload → `window.postMessage`                                               |
| `electron/host`     | `index.ts` (вход `utilityProcess`), `boot.ts` (сборка зависимостей и `createEngine`), `sql-worker.ts` (процесс раннера SQL)    |
| `shared/bridge.ts`  | тип `LmsBridge` и имена каналов (включён в оба tsconfig)                                                                       |
| `src/engine`        | `connect.ts` (порт + рукопожатие), `use-due.ts` (состояние из событий), `smoke.ts` (только для смоука)                         |
| `shared/smoke.ts`   | имена смоука (каналы, аргумент, тип моста) — достижимы только за флагом сборки                                                 |
| `scripts/smoke.mjs` | смоук в настоящем Electron: неупакованный и упакованный                                                                        |
| `test`              | vitest (node): супервизор и шеллы на фейках Electron; «релизный бандл без смоука»                                              |

Сборка (`vite build`) даёт `dist/` (renderer) и `dist-electron/{main,preload,host}`. Preload собирается в CJS (`index.cjs`): при `sandbox: true` Electron не грузит ESM-preload. Хост — ESM-бандл со всеми workspace-пакетами; снаружи остаётся только нативный `better-sqlite3` (N-API prebuild, в упаковке — `asarUnpack`). Вход `sql-worker.js` собирается тем же вызовом.

## Команды

| Команда                                     | Что делает                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                                  | Vite + Electron (из корня репозитория)                                     |
| `pnpm -F @lms/desktop typecheck`            | `vue-tsc` для renderer/preload и для main/host/тестов                      |
| `pnpm -F @lms/desktop test`                 | тесты супервизора и шеллов (входят в корневой `pnpm test`)                 |
| `pnpm -F @lms/desktop build:app`            | только `vite build`                                                        |
| `pnpm -F @lms/desktop build` (`pnpm build`) | типы, `vite build`, `electron-builder` (пакет приложения)                  |
| `pnpm -F @lms/desktop smoke`                | смоук-сборка и сквозной смоук в настоящем Electron                         |
| `pnpm -F @lms/desktop smoke:packaged`       | то же в упакованном неподписанном `.app` (из корня: `pnpm smoke:packaged`) |

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
