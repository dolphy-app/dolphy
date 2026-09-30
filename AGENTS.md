# AGENTS.md

Правила для агентов и разработчиков. Язык документов — русский, идентификаторы и код — английские.

## Структура репозитория

pnpm-workspace (`pnpm-workspace.yaml`): `apps/*`, `packages/*`.

| Путь                                    | Что                                                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop`                          | Electron 44 + Vue 3 + Vite; движок в `utilityProcess`, устройство — `apps/desktop/README.md`                                                              |
| `packages/`                             | пакеты `@lms/*` слоя бизнес-логики `engine-ts` и сложные UI-компоненты (`@lms/ui`: редактор, quiz; Vue 3, Vuetify 4 — peer), карта — `packages/README.md` |
| `docs/`, `engine-ts/`, `spike/`         | документы системного дизайна; кода там нет, линтер и форматтер их не трогают                                                                              |
| `vendor/metaskills`, `.agents/skills/*` | скиллы для агентов (git submodule и симлинки, см. `README.md`)                                                                                            |

## Команды

Node ≥ 22.12 (`.nvmrc`), pnpm 9.15.9 (поле `packageManager`). Устанавливать зависимости только через `pnpm`, `pnpm-lock.yaml` коммитить.

| Команда                    | Что делает                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm install`             | зависимости всего workspace                                                                               |
| `pnpm dev`                 | `apps/desktop` в режиме разработки                                                                        |
| `pnpm build`               | сборка `apps/desktop` (vue-tsc, vite, electron-builder)                                                   |
| `pnpm smoke`               | сквозной смоук `apps/desktop` в настоящем Electron                                                        |
| `pnpm smoke:packaged`      | то же в упакованном неподписанном `.app` (смоук-сборка)                                                   |
| `pnpm -F @lms/desktop e2e` | e2e через клиент в настоящем Electron: прохождение курсов, журнал в `engine.db` (в `pnpm test` не входит) |
| `pnpm typecheck`           | `tsc -b` (TS 7) по пакетам `packages/*`                                                                   |
| `pnpm test`                | `vitest run` по проектам `packages/*` и `apps/*`                                                          |
| `pnpm lint`                | `eslint .` и `prettier --check .`                                                                         |
| `pnpm fix`                 | `eslint . --fix` и `prettier --write .`                                                                   |
| `pnpm <cmd> -r`            | команда во всех пакетах workspace                                                                         |
| `pnpm -F <name>`           | команда в одном пакете, например `-F @lms/desktop`                                                        |

Новый пакет: `apps/<name>` или `packages/<name>`, имя в `package.json` — `@lms/<name>`.

## Стиль кода

Скилл `js-conventions` (Metarhia): ESLint (`eslint-config-metarhia` + `typescript-eslint` + `eslint-plugin-vue`) и Prettier (`.prettierrc.json`: одинарные кавычки, точки с запятой, запятые в конце, 80 колонок). Конфиг — корневой `eslint.config.js`. Перед коммитом `pnpm fix`, затем `pnpm lint`; CI запускает то же самое.

## Интерфейс

Слои — Feature-Sliced Design (скилл `feature-sliced-design`), компоненты — Vuetify 4 (скилл `vuetify-skilld`).

**Все строки интерфейса — только через `vue-i18n`** (скилл `vue-i18n-skilld`): ни одной русской или английской строки в шаблонах, `aria-label`, `label`, `placeholder`, моделях и `lib/*.ts`. Сообщения лежат в слайсе (`pages/<слайс>/i18n/{ru,en,index}.ts`; `en: typeof ru`), общие — в `shared/i18n`, оболочка — в `app/i18n`; код возвращает ключи или данные, текст собирает компонент через `t`. Числительные — формами (`ru`: четыре варианта, `en`: три), даты и числа — `d`/`n`, а не `Intl` с зашитым языком. Не переводятся данные движка (названия курсов, уроков, упражнений, `feedback` раннера, ошибки движка). Подробности — `apps/desktop/README.md`.

**Настройки хранятся в `engine.db`** (порт `SettingsStore`, адаптер `@lms/engine-sqlite`), не в файлах и не в `localStorage`. Новая настройка — поле контракта `@lms/engine-contract`, проверка в сервисе `settings`, схема RPC, тест адаптеров (общий набор `describeSettingsStoreContract`).

## Git-процесс

Ветки: `main` (стабильная), `develop` (интеграционная), `feature/<feature-name>` (любая работа).

**Любое изменение делается в отдельной ветке `feature/<feature-name>`.** Прямые коммиты в `develop` и `main` запрещены.

1. Создать ветку от актуальной `develop`: `git switch develop && git switch -c feature/<feature-name>`.
2. Работать и коммитить в ней (Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`); перед слиянием `pnpm lint` должен проходить.
3. Влить `feature/<feature-name>` в `develop` (PR в `develop`, либо локально `git merge --no-ff`).
4. Только после этого влить `develop` в `main`. Минуя `develop` в `main` не вливать.

`<feature-name>` — kebab-case, латиница: `feature/course-loader`, `feature/monorepo-setup`.

## CI/CD

GitHub Actions, `.github/workflows/ci.yml`. Запускается на push и pull request в `develop` и `main`. Jobs (каждый начинается с `pnpm install --frozen-lockfile`): `lint` — `pnpm lint:eslint`, `pnpm lint:format`; `typecheck` — `pnpm typecheck` и `test` — `pnpm test`, оба на Node 22 и 24. Сборки и деплоя в CI пока нет.
