# @dolphy-app/extension-tools

Инструменты автора расширений: `dolphy-ext build` собирает проект в каталог
расширения, `dolphy-ext validate` проверяет каталог тем же кодом, каким его
загрузит приложение (`inspectExtensionDir` из `@dolphy-app/extension-host`),
`dolphy-ext catalog check|build` проверяет и собирает расширения для каталога
(`dolphy-app/dolphy-extensions`, см. «Каталог»).

## Раскладка проекта

```
<project>/
  extension.json        # исходный манифест (обязателен), тот же формат, что у установленного
  src/main.ts           # node-вход -> <out>/<id>/main.mjs
  src/view.ts           # браузерный вход -> <out>/<id>/view.mjs
  src/panel.ts          # модуль панели (`contributes.panels`) -> <out>/<id>/panel.mjs
  dolphy-ext.config.json   # необязателен
  schema/, assets/      # необязательные каталоги, копируются как есть
```

- Исходник кода расширения — `src/<имя файла main без .mjs>.ts` (по умолчанию
  `main` из `./main.mjs` → `src/main.ts`).
- На каждый различный файл `renderer` — `src/<имя файла без расширения>.ts`
  (по умолчанию `./view.mjs` → `src/view.ts`); собирается для браузера
  (`es2022`, без внешних зависимостей, один файл).
- Расширение без кода (только `themes`, `markdownRenderers` и/или `settings`,
  `main: null`):
  node-входов нет, `src/main.ts` не нужен; для темы каталог `src` не нужен
  вовсе. Рендерер содержимого — `src/<имя файла без расширения>.ts`
  (по умолчанию `./markdown.mjs` → `src/markdown.ts`), браузерный бандл, как
  у `renderer` вида задания.
- Панель (`contributes.panels`): на каждый различный `module` —
  `src/<имя файла без расширения>.ts` (по умолчанию `./panel.mjs` →
  `src/panel.ts`; `./ui/screen.js` → `src/screen.ts`, выход `ui/screen.js`);
  браузерный бандл, как у рендерера; нет исходника — ошибка называет файл.
  Модуль экспортирует `defineExtensionPanel({ mount(container, ctx) })` из
  `@dolphy-app/extension-sdk`.
- Команды (`contributes.commands`) исполняет код расширения, поэтому им нужен
  `main` (`src/main.ts` с `defineExtension({ commands })`); без собранного
  `main.mjs` `validate` падает. Образец — фикстура `commands-panel`: две команды
  (одна с `palette: false`, `notify`/`openPanel` в `main.ts`) и панель
  `panel.mjs`; в запись каталога попадают id команд и панелей.
- Node-бандлы: ES-модуль, цель `node22`, без минификации; внешними остаются
  только встроенные модули Node и пакеты из `external`.
- `dolphy-ext.config.json`:
  `{ "nodeEntries": { "worker.mjs": "src/worker.ts" }, "external": ["better-sqlite3"] }` —
  дополнительные node-входы (выходной файл → исходник) и внешние пакеты.
- Схемы-файлы, на которые ссылается манифест, копируются с сохранением
  относительного пути (кроме уже лежащих в `schema/`/`assets/`). `extension.json`
  копируется байт в байт, нормализованная форма не пишется.

## Вывод

`<project>/dist-ext/<id>/` (`--out <dir>` меняет корень; каталог расширения
внутри всегда называется по `id`). Корень вывода — валидный корень обнаружения
расширений и значение `DOLPHY_DEV_EXTENSIONS`. После сборки результат проверяется
`validate`; проблемы завершают сборку ошибкой.

## CLI

```
dolphy-ext build [dir] [--out <dir>] [--watch]
dolphy-ext validate <dir>
dolphy-ext catalog check <extensionsDir> [--ids a,b]
            [--published-index <path>] [--max-app-version <x.y.z>]
            [--skip-github-check] [--list-rules]
dolphy-ext catalog build --src <extensionsDir> --ids a,b --out <siteDir>
            [--previous-index <path>] [--revoked <path>]
            [--source-base <url>] [--published-at <iso>]
dolphy-ext catalog build --reindex --out <siteDir>
            [--previous-index <path>] [--revoked <path>] [--published-at <iso>]
dolphy-ext --help
```

Коды выхода: 0 — успех, 1 — проблемы сборки/проверки (у `catalog check` — хотя бы
одно замечание `error`; `warning` код не меняет), 2 — неверные аргументы (у
`catalog` ещё `nothing to reindex`: нет исходного индекса).
Проблемы `build`/`validate`/`catalog build` печатаются в stderr как
`error <id-или-каталог>: <сообщение>`, итог — в stdout (`built <id> -> <dir> (N files)` /
`<dir>: ok` / `published <id>@<версия> (N files, M bytes)`). Замечания
`catalog check` — в stdout, по строке `error|warning <id> <RULE-ID> <поле>: <сообщение>`;
чистая проверка ничего не печатает.

`--watch` пересобирает бандлы при изменении исходников. Манифест, схемы и
`assets/` копируются один раз — после их правки перезапустите команду.
Запуск из репозитория: `pnpm -F @dolphy-app/extension-tools dolphy-ext build <dir>`.

## Каталог

Подкоманды `catalog` обслуживают репозиторий каталога расширений
(`dolphy-app/dolphy-extensions`, устройство и цепочка доверия — раздел
«Установка и каталог» в `docs/design/extensions.md`). Формат индекса, выбор
версии и отзыв разбирает `@dolphy-app/extension-catalog` — тот же код, что в
приложении.

### `catalog check <extensionsDir>`

Проверяет исходники `<extensionsDir>/<id>/` (проект `dolphy-ext` без
`node_modules`, `dist-ext` и `.git`) по правилам ниже. `--ids a,b` ограничивает
проверку перечисленными расширениями (по умолчанию — все каталоги);
`--published-index <path>` — `index.json` опубликованного каталога для правила
`CHECK-012` (нет файла — ничего не опубликовано); `--max-app-version <x.y.z>` —
версия выпущенного приложения для `CHECK-016`; `--skip-github-check` отключает
запрос `api.github.com` для `CHECK-006` (токен API — переменная `GITHUB_TOKEN`);
`--list-rules` печатает правила и выходит.

| Правило     | Что проверяет                                                                    |
| ----------- | -------------------------------------------------------------------------------- |
| `CHECK-001` | `extension.json` читается и проходит разбор манифеста                            |
| `CHECK-002` | имя каталога равно `id` из манифеста                                             |
| `CHECK-003` | заданы `name`, `description` и `author`                                          |
| `CHECK-004` | `README.md` существует и не пуст                                                 |
| `CHECK-005` | `author` имеет форму GitHub-логина                                               |
| `CHECK-006` | `author` — существующий пользователь GitHub (нет ответа — `warning`)             |
| `CHECK-007` | `package.json` существует и разбирается                                          |
| `CHECK-008` | есть lock-файл (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`)  |
| `CHECK-009` | нет lifecycle-скриптов установки и публикации (`postinstall`, `prepare`…)        |
| `CHECK-010` | зависимости только из реестра (без git, http, file, link, workspace)             |
| `CHECK-011` | `name` в `package.json` не занимает чужой scope (`warning`)                      |
| `CHECK-012` | версия строго больше опубликованной                                              |
| `CHECK-013` | не более 200 файлов и 5 МБ исходников, файл не больше 1 МБ                       |
| `CHECK-014` | нет символических ссылок                                                         |
| `CHECK-015` | нет исполняемых файлов (`.exe`, `.dll`, `.so`, `.dylib`, `.node`, `.sh`, `.bat`) |
| `CHECK-016` | `minAppVersion` не новее `--max-app-version`                                     |

Правила — данные в коде (`src/catalog/rules.ts`, таблица `RULES`); смысловое
ревью по `rules/rules.json` репозитория каталога — отдельный шаг, не CLI.

### `catalog build`

`--src <extensionsDir> --ids a,b --out <siteDir>`: для каждого id собирает
проект тем же кодом, что `dolphy-ext build`, добавляет `README.md` (обязателен),
считает `size` и `sha256` файлов и кладёт версию в
`<siteDir>/extensions/<id>/<version>/`, затем обновляет `<siteDir>/index.json`
(у расширения не более 5 последних версий, от новой к старой). Манифест должен
содержать `name`, `description`, `author`. Версия публикуется один раз: сборка
того же номера с другим содержимым — ошибка. Файлы версии — только `json`, `js`,
`mjs`, `md`, `txt` с безопасными именами, не более 50 файлов и 10 МБ. Любая
ошибка оставляет `<siteDir>` нетронутым.

- `--previous-index <path>` — исходный индекс (по умолчанию `<out>/index.json`);
- `--revoked <path>` — JSON-массив `{ id, versions, reason }` (без флага берётся
  список из исходного индекса);
- `--source-base <url>` — основа поля `source` (по умолчанию дерево
  `extensions` в `dolphy-app/dolphy-extensions`);
- `--published-at <iso>` — `publishedAt` новых версий (по умолчанию сейчас).

`catalog build --reindex --out <siteDir>` заменяет в существующем индексе только
`revoked` и `generatedAt` (записи расширений не меняются; `--src` и `--ids` не
нужны): так публикуется отзыв версии без новой сборки.

Локальный каталог для приложения: `dolphy-ext catalog build --src <src> --ids <id> --out <site>`,
любой статический сервер над `<site>` и `DOLPHY_EXTENSION_CATALOG_URL=http://localhost:<порт>/index.json pnpm dev`.

Опубликованный пакет `@dolphy-app/extension-tools` содержит только CLI
(`bin` `dolphy-ext`), без библиотечного входа; `API` ниже — для репозитория.

## API

```ts
import {
  buildExtension,
  watchExtension,
  validateExtension,
} from '@dolphy-app/extension-tools';

const { id, dir, files } = await buildExtension({ root, outDir });
const handle = await watchExtension({ root, logger }); // handle.close()
const { ok, problems } = await validateExtension(dir);
```

Ошибки сборки — `BuildError` (`message` совпадает с текстом, который печатает
приложение для того же манифеста).

Примеры из разделов «Точки вклада» и «Права и изоляция» `docs/design/extensions.md` собираются и
проверяются тестом `test/docs-contributions.test.ts` (тема — проект из одного
`extension.json`, рендерер содержимого и правило оценки — с `src/*.ts`).

## Разрешения

`permissions` в `extension.json` разбирает тот же `parseManifest`, что и
приложение: `dolphy-ext validate` (и проверка в конце `dolphy-ext build`) отклоняет
неизвестное имя (`permissions.0: …`) и дубль (`duplicate permission '…'`).
Допустимые имена — `EXTENSION_PERMISSIONS` из `@dolphy-app/extension-api`. Пример
манифеста с разрешениями — `docs/design/extensions.md`, «Права и изоляция»; он
проверяется `test/docs-contributions.test.ts` вместе с примерами «Точек вклада».

Точки `settings` (настройки, которые пользователь меняет в приложении) и
`events` (подписка на события обучения) проверяются тем же `parseManifest`.
Правило: расширение с `contributes.events` обязано объявить разрешение
`learning.events`, иначе `validate` и `build` отклоняют манифест. Хранилище
`ctx.storage` разрешения не требует. `dolphy-ext catalog build` пишет
`contributes.settings` и `contributes.events` в запись индекса только когда они
не пусты, а `learning.events` попадает в `permissions` версии.
