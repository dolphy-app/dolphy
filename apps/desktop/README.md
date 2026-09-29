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
| `scripts/smoke.mjs` | запуск смоука в настоящем Electron                                                                                             |
| `test`              | vitest (node): супервизор и шеллы на фейках Electron                                                                           |

Сборка (`vite build`) даёт `dist/` (renderer) и `dist-electron/{main,preload,host}`. Preload собирается в CJS (`index.cjs`): при `sandbox: true` Electron не грузит ESM-preload. Хост — ESM-бандл со всеми workspace-пакетами; снаружи остаётся только нативный `better-sqlite3` (N-API prebuild, в упаковке — `asarUnpack`). Вход `sql-worker.js` собирается тем же вызовом.

## Команды

| Команда                                     | Что делает                                                 |
| ------------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                                  | Vite + Electron (из корня репозитория)                     |
| `pnpm -F @lms/desktop typecheck`            | `vue-tsc` для renderer/preload и для main/host/тестов      |
| `pnpm -F @lms/desktop test`                 | тесты супервизора и шеллов (входят в корневой `pnpm test`) |
| `pnpm -F @lms/desktop build:app`            | только `vite build`                                        |
| `pnpm -F @lms/desktop build` (`pnpm build`) | типы, `vite build`, `electron-builder` (пакет приложения)  |
| `pnpm -F @lms/desktop smoke`                | `vite build` и сквозной смоук в настоящем Electron         |

## Смоук

`LMS_SMOKE=1` (включает `pnpm smoke`; в упакованном приложении игнорируется) запускает Electron со скрытым окном, временным `userData` и копией библиотеки `sql-course` (`packages/engine/test/fixtures/libraries/sql-course/lib_kb`). Renderer выполняет сценарии через настоящий путь renderer → preload → main → хост → движок и сообщает итог main, тот печатает `LMS_SMOKE_RESULT …` и выходит с кодом 0 или 1:

1. `basic` — `library.getInfo`, `recordAttempt`, повторный `recordAttempt` (`duplicate: true`), событие `progress`;
2. `sql` — `beginAttempt` / `submitAnswer` (неверный и верный SQL) / `completeAttempt`; проверку выполняет процесс раннера, порождённый из `utilityProcess`;
3. `crash` — убийство хоста, перезапуск супервизором, переподключение клиента, повтор идемпотентного вызова, `duplicate: true` после рестарта (журнал на диске), `progress` после переподключения.

`pnpm smoke --verbose` печатает stderr хоста и main.

## Безопасность

`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; навигация запрещена, `window.open` отклоняется; CSP — «запретить всё» (в dev добавляется websocket для HMR); `ipcMain` принимает только от верхнего фрейма; мост не отдаёт `ipcRenderer`; аргументы RPC валидируются zod на хосте.
