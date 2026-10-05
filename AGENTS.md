# AGENTS.md

Правила для агентов и разработчиков. Язык внутренних документов — русский, идентификаторы и код — английские; публичные материалы — на английском (см. «Язык документов»).

## Язык документов

**Всё, что доступно публично для чтения, пишется на английском:** `README.md` корня, приложений и пакетов, документация библиотек (в том числе JSDoc/TSDoc публичного API и примеры использования), поля `description`, `keywords` и прочие текстовые поля `package.json`, описание репозитория и релизов на GitHub, заголовки и описания PR, сообщения коммитов, `CHANGELOG.md`.

Русским остаются внутренние документы: `AGENTS.md`, `docs/`, `specs/`. Строки интерфейса приложения — через `vue-i18n` (см. «Интерфейс»), этим правилом не затрагиваются.

Новый или изменённый публичный документ на русском языке не принимается; при правке существующего русскоязычного публичного документа его переводят на английский в том же изменении.

## Структура репозитория

pnpm-workspace (`pnpm-workspace.yaml`): `apps/*`, `packages/*`.

| Путь                                    | Что                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop`                          | Electron 44 + Vue 3 + Vite; движок в `utilityProcess`, устройство — `apps/desktop/README.md`                                                                            |
| `packages/`                             | пакеты `@dolphy-app/*` слоя бизнес-логики `engine-ts` и сложные UI-компоненты (`@dolphy-app/ui`: редактор, quiz; Vue 3, Vuetify 4 — peer), карта — `packages/README.md` |
| `docs/`, `engine-ts/`                   | документы системного дизайна; кода там нет, линтер и форматтер их не трогают                                                                                            |
| `specs/`                                | спеки фич: активные в `specs/<feature-name>/`, завершённые в `specs/archive/`; каталог появляется с первой спекой, линтер и форматтер его не трогают                    |
| `vendor/metaskills`, `.agents/skills/*` | скиллы для агентов (git submodule и симлинки, см. `docs/repository.md`)                                                                                                 |

## Команды

Node ≥ 22.12 (`.nvmrc`), pnpm 9.15.9 (поле `packageManager`). Устанавливать зависимости только через `pnpm`, `pnpm-lock.yaml` коммитить.

| Команда                       | Что делает                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                | зависимости всего workspace                                                                                                                     |
| `pnpm dev`                    | `apps/desktop` в режиме разработки                                                                                                              |
| `pnpm build`                  | сборка `apps/desktop` (vue-tsc, vite, electron-builder)                                                                                         |
| `pnpm smoke`                  | сквозной смоук `apps/desktop` в настоящем Electron                                                                                              |
| `pnpm smoke:packaged`         | то же в упакованном неподписанном `.app` (смоук-сборка)                                                                                         |
| `pnpm -F @dolphy/desktop e2e` | e2e через клиент в настоящем Electron: прохождение курсов, журнал в `engine.db` (в `pnpm test` не входит)                                       |
| `pnpm typecheck`              | `tsc -b` (TS 7) по пакетам `packages/*`                                                                                                         |
| `pnpm test`                   | `vitest run` по проектам `packages/*` и `apps/*`; локально не больше 6 воркеров (`VITEST_MAX_WORKERS=<n>` меняет, в CI — значение по умолчанию) |
| `pnpm lint`                   | `eslint .` и `prettier --check .`                                                                                                               |
| `pnpm fix`                    | `eslint . --fix` и `prettier --write .`                                                                                                         |
| `pnpm <cmd> -r`               | команда во всех пакетах workspace                                                                                                               |
| `pnpm -F <name>`              | команда в одном пакете, например `-F @dolphy/desktop`                                                                                           |

Новый пакет: `apps/<name>` или `packages/<name>`, имя в `package.json` — `@dolphy-app/<name>`.

### e2e без перехвата фокуса

e2e не должен отбирать фокус и переключать space: агенты запускают его в фоне, пользователь работает параллельно. Окна по умолчанию скрыты (`DOLPHY_HIDDEN_WINDOW`), на macOS запускается копия `Electron.app` с `LSUIElement` (`dist-e2e/Electron.app`, готовит `e2e/global-setup.ts`).

- Обычный прогон — `pnpm -F @dolphy/desktop e2e [файл]`; `DOLPHY_E2E_SKIP_BUILD=1` переиспользует сборку `dist-e2e`.
- Посмотреть глазами — `DOLPHY_E2E_SHOW=1`. Окна показываются через `showInactive()` без фокуса; при `yabai` в `PATH` харнесс сам делает их плавающими и переносит на space `DOLPHY_E2E_SPACE` (по умолчанию `3`). Конфиг yabai менять не нужно.
- Новый код запуска Electron в тестах: не вызывать `focus()`/`show()`, окна показывать только через `revealWindows` в `e2e/support/app.ts`. Окно копии с `LSUIElement` yabai перенести не может, поэтому в режиме показа нужен обычный Electron.
- Подробности — `apps/desktop/README.md` (раздел E2E).

## Стиль кода

Скилл `js-conventions` (Metarhia): ESLint (`eslint-config-metarhia` + `typescript-eslint` + `eslint-plugin-vue`) и Prettier (`.prettierrc.json`: одинарные кавычки, точки с запятой, запятые в конце, 80 колонок). Конфиг — корневой `eslint.config.js`. Перед коммитом `pnpm fix`, затем `pnpm lint`; CI запускает то же самое.

## Интерфейс

Слои — Feature-Sliced Design (скилл `feature-sliced-design`), компоненты — Vuetify 4 (скилл `vuetify-skilld`).

**Все строки интерфейса — только через `vue-i18n`** (скилл `vue-i18n-skilld`): ни одной русской или английской строки в шаблонах, `aria-label`, `label`, `placeholder`, моделях и `lib/*.ts`. Сообщения лежат в слайсе (`pages/<слайс>/i18n/{ru,en,index}.ts`; `en: typeof ru`), общие — в `shared/i18n`, оболочка — в `app/i18n`; код возвращает ключи или данные, текст собирает компонент через `t`. Числительные — формами (`ru`: четыре варианта, `en`: три), даты и числа — `d`/`n`, а не `Intl` с зашитым языком. Не переводятся данные движка (названия курсов, уроков, упражнений, `feedback` раннера, ошибки движка). Подробности — `apps/desktop/README.md`.

**Настройки хранятся в `engine.db`** (порт `SettingsStore`, адаптер `@dolphy-app/engine-sqlite`), не в файлах и не в `localStorage`. Новая настройка — поле контракта `@dolphy-app/engine-contract`, проверка в сервисе `settings`, схема RPC, тест адаптеров (общий набор `describeSettingsStoreContract`).

## Спеки фич

Порядок, шаблоны и правила закрытия — скилл `spec-workflow`; обоснование выбора — `docs/research/spec-workflows.md` (§9).

**Фича, которая меняет контракт `@dolphy-app/engine-contract`, схему RPC или БД либо добавляет пакет, экран или настройку, начинается со спеки `specs/<feature-name>/SPEC.md`** (имя каталога совпадает с веткой `feature/<feature-name>`). Багфиксы, рефакторинг и правки внутри пакета — без спеки.

- Источники требований: спека фичи и её `depends-on`, `docs/adr/`, `docs/design`, README пакетов. **`specs/archive/` без явной ссылки не читать и не считать источником требований.**
- Закрытие фичи — в той же ветке до слияния: долговечное переносится в `docs/design` или README, решения, ограничивающие будущее, — в ADR (`docs/adr/NNNN-название.md`), затем `git mv specs/<name> specs/archive/ГГГГ-ММ-ДД-<name>`, `status: done`, заполнить `Outcomes`.
- Архивная спека неизменна; изменение поведения — новая спека со `supersedes`. Старые фичи задним числом в спеки не переносятся.

## Git-процесс

Подробный порядок с командами `gh` — скилл `git-workflow`. Ветки: `main` (только релизы), `develop` (интеграционная), `feature/<feature-name>` (любая работа), `release-<version>` (релиз).

**Любое изменение делается в отдельной ветке `feature/<feature-name>`.** Прямые коммиты в `develop` и `main` запрещены. GitHub-операции (PR, слияние, релиз) — только через `gh`.

1. Создать ветку от актуальной `develop`: `git fetch origin && git switch -c feature/<feature-name> origin/develop`.
2. Работать и коммитить в ней по Conventional Commits (`feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`, `revert`; заголовок на английском, `scope` — каталог из `apps/` или `packages/`); хук `commit-msg` (commitlint) отклонит неверное сообщение. Перед push `pnpm lint` должен проходить.
3. Запушить и открыть PR в `develop` (`gh pr create --base develop`) с кратким описанием: что за фича и что сделано.
4. Влить PR только при зелёном pipeline и отсутствии конфликтов (`gh pr checks --watch --fail-fast`, затем `gh pr merge --merge` и `git push origin --delete feature/<feature-name>`): только merge-коммитом, без squash и rebase. Упавший pipeline чинится коммитом в той же ветке; конфликты — сначала подтянуть `develop` в ветку и решить их. То же для PR в `main`.
5. Релиз — по просьбе: версию даёт `pnpm release:version` (semantic-release по коммитам `develop`); от `develop` создаётся ветка `release-<version>`, PR `release-<version>` → `main` (`gh pr create --base main --head release-<version>`), при зелёном pipeline слияние merge-коммитом. В `main` вливаются только `release-*`. Затем PR `main` → `develop`, возвращающий релизный коммит (иначе следующая версия посчитается от устаревшего тега).

`<feature-name>` — kebab-case, латиница: `feature/course-loader`, `feature/monorepo-setup`.

## Релизы

Релиз запускает push в `main` (`.github/workflows/release.yml`), версию считает semantic-release (`release.config.js`) по Conventional Commits: `feat` — minor, `fix` и `perf` — patch, `!` или `BREAKING CHANGE` — major, остальные типы релиз не создают. Он дописывает `CHANGELOG.md`, поднимает `version` в корневом `package.json`, коммитит `chore(release): X.Y.Z [skip ci]`, ставит тег `vX.Y.Z` и создаёт GitHub Release. Затем собираются неподписанные установщики `apps/desktop` (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`) с версией из тега; они прикладываются к Release. Версию, `CHANGELOG.md` и теги `v*` руками не менять; `apps/desktop/package.json` версией релиза не управляется (версия сборки передаётся `-c.extraMetadata.version`). Имя ветки `release-<version>` должно совпадать с версией, которую считает `scripts/next-version.sh` (`pnpm release:version`); это проверяет job `release-branch`.

Отсчёт версий идёт от базового тега `v0.0.0` на первом коммите (без него semantic-release начал бы с `1.0.0`): первый релиз — `0.1.0`, пока проект в `0.x`, `feat` даёт minor, а major — только `!` или `BREAKING CHANGE`. Если в релизе не собрался установщик, пересборка без нового релиза: `gh workflow run release.yml --ref develop -f version=X.Y.Z` (файлы заменяются в существующем Release).

## CI/CD

GitHub Actions. `.github/workflows/ci.yml` запускается на push и pull request в `develop` и `main`. Jobs (каждый начинается с `pnpm install --frozen-lockfile`): `lint` — `pnpm lint:eslint`, `pnpm lint:format`; `typecheck` — `pnpm typecheck` и `test` — `pnpm test`, оба на Node 22 и 24; `build` — `pnpm build --publish never` на Linux (типы, `vite build`, `electron-builder`; без подписи); `commitlint` — сообщения коммитов PR в `develop` (`commitlint --from <base> --to <head>`); `release-branch` — PR в `main`: ветка называется `release-<version>` и версия совпадает с расчётом semantic-release. `.github/workflows/release.yml` — релиз из `main` (см. «Релизы»). `.github/workflows/desktop-checks.yml` — упакованный смоук (`pnpm smoke:packaged`: `macos-14` и `ubuntu-latest` под `xvfb-run`) и e2e десктопа (`pnpm -F @dolphy/desktop e2e`, Linux под `xvfb-run`) на PR в `main`, по `workflow_dispatch`, e2e ещё и ночью (cron); без `paths`, чтобы релиз-PR всегда получал обе проверки. Релиз-PR в `main` вливается только при зелёных `Packaged smoke (…)` и `Desktop e2e (Linux)` (защиты веток нет: правило держит скилл `git-workflow`). Деплоя нет.
