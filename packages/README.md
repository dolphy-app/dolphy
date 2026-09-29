# packages

Пакеты слоя бизнес-логики `engine-ts` (проект — `engine-ts/design/`). Все пакеты — ESM, `private`, исходники в `src/`, тесты в `test/`. Импорты между пакетами идут прямо в исходники (`exports` → `./src/*.ts`), сборки нет: `dist/` содержит только `.d.ts` для `tsc -b`.

## Карта

| Пакет                    | Что                                                                  | Зависит от                                        |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------- |
| `@lms/engine-contract`   | типы DTO, `CONTRACT_VERSION`, `MAX_SQL_CHARS`, `RPC_METHODS`, `Rpc*` | —                                                 |
| `@lms/engine`            | домен, порты, приложение, fs/memory-адаптеры (`./ports`, `./node`)   | contract, ts-fsrs, yaml, zod                      |
| `@lms/engine-sqlite`     | `EventStore` на better-sqlite3                                       | engine, better-sqlite3                            |
| `@lms/engine-sql-runner` | `Verifier` для SQL в дочерних процессах                              | engine, better-sqlite3 (запасной профиль Node 22) |
| `@lms/engine-rpc`        | RPC: `./client` (renderer, без zod), `./host` (диспетчер, zod)       | contract, engine, zod                             |
| `@lms/testkit`           | часы, RNG, id, билдеры журнала и библиотек (dev-пакет)               | contract, engine, fast-check                      |

`@lms/engine` экспортирует подпути `./ports`, `./app`, `./node` (fs-адаптеры: `createNodeFsCourseSource`) и `./authoring` (сканер, компилятор курса, артефакт, `LibraryHolder`; `yaml` подгружается только компилятором). CLI компилятора — `pnpm -F @lms/engine engine-cli validate|compile <каталог библиотеки>` (`src/cli`, код выхода 1 при ошибках, 2 при неверных аргументах). `@lms/testkit` подключён в корневой `package.json` (`workspace:*`), поэтому тесты любого пакета импортируют его без цикла зависимостей `engine ↔ testkit`.

Проверка ответов (M5, F5): `@lms/engine/verify` — `GradePolicy` (`passAtN`: pass@1 → 5, pass@2 → 4, pass@3+ → 3, `gave-up` → 1, `null` — нужна самооценка; вердикты `error` не считаются) и хелперы вердиктов; `@lms/engine-sql-runner` — `createSqlVerifier({ source, logger, spawnWorker? })`: порт `Verifier` с `runner: 'sql'` поверх пула дочерних процессов `min(4, cores − 1)` (`recycleAfter`, респавн в фоне, kill по `timeoutMs + 100 мс` и по RSS, наблюдатель RSS обязателен). Драйвер выбирается пробой возможностей: `node:sqlite` с `setAuthorizer` и `db.limits` (профиль `full`) или better-sqlite3 (запасной профиль: `query_only`, read-only хэндл, префильтр). `fixture` и `expected` читаются из библиотеки через `source` (пути от корня), `verification.reference` — эталонное решение. Компилятор с `compile(source, { runChecks: { verifiers } })` прогоняет эталоны через порт и выдаёт `E_REFERENCE_FAILS` (`@lms/engine/authoring`: `checkReferences`); CLI — `engine-cli validate|compile <каталог> --run-checks` (пакет раннера подгружается динамически: ядро от него не зависит). Бюджет T-44 (1 000 проверок ≤ 1 с на прогретом пуле): `pnpm -F @lms/engine-sql-runner bench`, в `pnpm test` не входит. Смоук в настоящем Electron 44 (порождение процессов раннера из `utilityProcess`) — за проводкой `apps/desktop`, здесь не проверялся.

## Команды (из корня)

| Команда                    | Что делает                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `pnpm typecheck`           | `tsc -b` (TS 7) в каждом пакете: проект `src` и проект `test`              |
| `pnpm test`                | `vitest run` по проектам всех пакетов (`vitest.config.mts` → `packages/*`) |
| `pnpm -F @lms/engine test` | тесты одного пакета; `pnpm -F <имя> typecheck` — типы одного пакета        |
| `pnpm lint` / `pnpm fix`   | ESLint + Prettier для всего репозитория                                    |

## TypeScript 7 и корневой typescript

`typescript-eslint` и `vue-tsc` (`apps/desktop`) не работают с TS 7, поэтому корневой `typescript` остаётся `^6.0.3` (для ESLint и desktop). TS 7.0.2 подключён как `devDependency` каждого пакета `packages/*`; `tsc` запускается из пакета (`pnpm exec tsc`, ближайший `node_modules/.bin`) и берёт версию 7. Вызов `node_modules/.bin/tsc` в корне даст TS 6.

Конфиги: `tsconfig.base.json` (`strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `module esnext`, `moduleResolution bundler`); в пакете `tsconfig.json` — проект `src` (`composite`, `emitDeclarationOnly`, вывод в `dist/`), `tsconfig.test.json` — проект `test` (`noEmit`, ссылки на `src` и `testkit`). Корневой `tsconfig.json` — «решение» со ссылками на всё. `tsconfig.vitest.json` (contract, engine) — конфиг для typecheck-режима vitest без ссылок: он читает исходники, а не устаревший `dist/`.

## Тесты

Тип-тесты — `test/**/*.test-d.ts` (в `engine-contract`, `engine`): падают и в `pnpm typecheck`, и в `pnpm test`. `RPC_METHODS` сверяется с методами `LearningEngine` (`test/rpc-keys.test-d.ts`): лишний и пропущенный ключ — ошибка типов. Эталон py-fsrs для `MemoryModel` — `engine/test/fixtures/reference.json` (600 историй, 18 564 обзора; `gen_reference.py` — генератор), проверка — `engine/test/contract/memory-model.test.ts`.

CI: job `typecheck` и `test` на Node 22 и 24, `lint` — на версии из `.nvmrc`.
