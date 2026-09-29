# AGENTS.md

Правила для агентов и разработчиков. Язык документов — русский, идентификаторы и код — английские.

## Структура репозитория

pnpm-workspace (`pnpm-workspace.yaml`): `apps/*`, `packages/*`.

| Путь                                    | Что                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/desktop`                          | Electron + Vue 3 + Vite, шаблон [electron-vite-vue](https://github.com/electron-vite/electron-vite-vue) |
| `packages/`                             | общие пакеты (пока пусто; `@lms/*`)                                                                     |
| `docs/`, `engine-ts/`, `spike/`         | документы системного дизайна; кода там нет, линтер и форматтер их не трогают                            |
| `vendor/metaskills`, `.agents/skills/*` | скиллы для агентов (git submodule и симлинки, см. `README.md`)                                          |

## Команды

Node ≥ 22.12 (`.nvmrc`), pnpm 9.15.9 (поле `packageManager`). Устанавливать зависимости только через `pnpm`, `pnpm-lock.yaml` коммитить.

| Команда          | Что делает                                              |
| ---------------- | ------------------------------------------------------- |
| `pnpm install`   | зависимости всего workspace                             |
| `pnpm dev`       | `apps/desktop` в режиме разработки                      |
| `pnpm build`     | сборка `apps/desktop` (vue-tsc, vite, electron-builder) |
| `pnpm lint`      | `eslint .` и `prettier --check .`                       |
| `pnpm fix`       | `eslint . --fix` и `prettier --write .`                 |
| `pnpm <cmd> -r`  | команда во всех пакетах workspace                       |
| `pnpm -F <name>` | команда в одном пакете, например `-F @lms/desktop`      |

Новый пакет: `apps/<name>` или `packages/<name>`, имя в `package.json` — `@lms/<name>`.

## Стиль кода

Скилл `js-conventions` (Metarhia): ESLint (`eslint-config-metarhia` + `typescript-eslint` + `eslint-plugin-vue`) и Prettier (`.prettierrc.json`: одинарные кавычки, точки с запятой, запятые в конце, 80 колонок). Конфиг — корневой `eslint.config.js`. Перед коммитом `pnpm fix`, затем `pnpm lint`; CI запускает то же самое.

## Git-процесс

Ветки: `main` (стабильная), `develop` (интеграционная), `feature/<feature-name>` (любая работа).

**Любое изменение делается в отдельной ветке `feature/<feature-name>`.** Прямые коммиты в `develop` и `main` запрещены.

1. Создать ветку от актуальной `develop`: `git switch develop && git switch -c feature/<feature-name>`.
2. Работать и коммитить в ней (Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`); перед слиянием `pnpm lint` должен проходить.
3. Влить `feature/<feature-name>` в `develop` (PR в `develop`, либо локально `git merge --no-ff`).
4. Только после этого влить `develop` в `main`. Минуя `develop` в `main` не вливать.

`<feature-name>` — kebab-case, латиница: `feature/course-loader`, `feature/monorepo-setup`.

## CI/CD

GitHub Actions, `.github/workflows/ci.yml`. Запускается на push и pull request в `develop` и `main`. Единственный job `lint`: `pnpm install --frozen-lockfile`, `pnpm lint:eslint`, `pnpm lint:format`. Тестов, сборки и деплоя в CI пока нет.
