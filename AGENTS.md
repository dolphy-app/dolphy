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

Подробный порядок с командами `gh` — скилл `git-workflow`. Ветки: `main` (только релизы), `develop` (интеграционная), `feature/<feature-name>` (любая работа).

**Любое изменение делается в отдельной ветке `feature/<feature-name>`.** Прямые коммиты в `develop` и `main` запрещены. GitHub-операции (PR, слияние, релиз) — только через `gh`.

1. Создать ветку от актуальной `develop`: `git fetch origin && git switch -c feature/<feature-name> origin/develop`.
2. Работать и коммитить в ней по Conventional Commits (`feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `revert`; заголовок на английском, `scope` — каталог из `apps/` или `packages/`); хук `commit-msg` (commitlint) отклонит неверное сообщение. Перед push `pnpm lint` должен проходить.
3. Запушить и открыть PR в `develop` (`gh pr create --base develop`) с кратким описанием: что за фича и что сделано.
4. Сразу влить PR, если нет конфликтов (`gh pr merge --merge --delete-branch`): только merge-коммитом, без squash и rebase. Конфликты — сначала подтянуть `develop` в ветку и решить их.
5. Релиз — по просьбе: PR `develop` → `main` (`gh pr create --base main --head develop`) и слияние merge-коммитом. Минуя `develop` в `main` не вливать. Затем PR `main` → `develop`, возвращающий релизный коммит.

`<feature-name>` — kebab-case, латиница: `feature/course-loader`, `feature/monorepo-setup`.

## Релизы

Релиз запускает push в `main` (`.github/workflows/release.yml`), версию считает semantic-release (`release.config.js`) по Conventional Commits: `feat` — minor, `fix` и `perf` — patch, `!` или `BREAKING CHANGE` — major, остальные типы релиз не создают. Он дописывает `CHANGELOG.md`, поднимает `version` в корневом `package.json`, коммитит `chore(release): X.Y.Z [skip ci]`, ставит тег `vX.Y.Z` и создаёт GitHub Release. Затем собираются неподписанные установщики `apps/desktop` (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`) с версией из тега; они прикладываются к Release. Версию, `CHANGELOG.md` и теги `v*` руками не менять; `apps/desktop/package.json` версией релиза не управляется (версия сборки передаётся `-c.extraMetadata.version`).

## CI/CD

GitHub Actions. `.github/workflows/ci.yml` запускается на push и pull request в `develop` и `main`. Jobs (каждый начинается с `pnpm install --frozen-lockfile`): `lint` — `pnpm lint:eslint`, `pnpm lint:format`; `typecheck` — `pnpm typecheck` и `test` — `pnpm test`, оба на Node 22 и 24; `build` — `pnpm build --publish never` на Linux (типы, `vite build`, `electron-builder`; без подписи); `commitlint` — сообщения коммитов PR в `develop` (`commitlint --from <base> --to <head>`). `.github/workflows/release.yml` — релиз из `main` (см. «Релизы»). Деплоя нет.
