# @lms/extension-tools

Инструменты автора расширений: `lms-ext build` собирает проект в каталог
расширения, `lms-ext validate` проверяет каталог тем же кодом, каким его
загрузит приложение (`inspectExtensionDir` из `@lms/extension-host`).

## Раскладка проекта

```
<project>/
  extension.json        # исходный манифест (обязателен), тот же формат, что у установленного
  src/main.ts           # node-вход -> <out>/<id>/main.mjs
  src/view.ts           # браузерный вход -> <out>/<id>/view.mjs
  lms-ext.config.json   # необязателен
  schema/, assets/      # необязательные каталоги, копируются как есть
```

- Исходник кода расширения — `src/<имя файла main без .mjs>.ts` (по умолчанию
  `main` из `./main.mjs` → `src/main.ts`).
- На каждый различный файл `renderer` — `src/<имя файла без расширения>.ts`
  (по умолчанию `./view.mjs` → `src/view.ts`); собирается для браузера
  (`es2022`, без внешних зависимостей, один файл).
- Расширение без кода (только `themes` и/или `markdownRenderers`, `main: null`):
  node-входов нет, `src/main.ts` не нужен; для темы каталог `src` не нужен
  вовсе. Рендерер содержимого — `src/<имя файла без расширения>.ts`
  (по умолчанию `./markdown.mjs` → `src/markdown.ts`), браузерный бандл, как
  у `renderer` вида задания.
- Node-бандлы: ES-модуль, цель `node22`, без минификации; внешними остаются
  только встроенные модули Node и пакеты из `external`.
- `lms-ext.config.json`:
  `{ "nodeEntries": { "worker.mjs": "src/worker.ts" }, "external": ["better-sqlite3"] }` —
  дополнительные node-входы (выходной файл → исходник) и внешние пакеты.
- Схемы-файлы, на которые ссылается манифест, копируются с сохранением
  относительного пути (кроме уже лежащих в `schema/`/`assets/`). `extension.json`
  копируется байт в байт, нормализованная форма не пишется.

## Вывод

`<project>/dist-ext/<id>/` (`--out <dir>` меняет корень; каталог расширения
внутри всегда называется по `id`). Корень вывода — валидный корень обнаружения
расширений и значение `LMS_DEV_EXTENSIONS`. После сборки результат проверяется
`validate`; проблемы завершают сборку ошибкой.

## CLI

```
lms-ext build [dir] [--out <dir>] [--watch]
lms-ext validate <dir>
lms-ext --help
```

Коды выхода: 0 — успех, 1 — проблемы сборки/проверки, 2 — неверные аргументы.
Проблемы печатаются в stderr как `error <id-или-каталог>: <сообщение>`, итог —
в stdout (`built <id> -> <dir> (N files)` / `<dir>: ok`).

`--watch` пересобирает бандлы при изменении исходников. Манифест, схемы и
`assets/` копируются один раз — после их правки перезапустите команду.
Запуск из репозитория: `pnpm -F @lms/extension-tools lms-ext build <dir>`.

## API

```ts
import {
  buildExtension,
  watchExtension,
  validateExtension,
} from '@lms/extension-tools';

const { id, dir, files } = await buildExtension({ root, outDir });
const handle = await watchExtension({ root, logger }); // handle.close()
const { ok, problems } = await validateExtension(dir);
```

Ошибки сборки — `BuildError` (`message` совпадает с текстом, который печатает
приложение для того же манифеста).

Примеры из раздела «Точки вклада» `docs/design/extensions.md` собираются и
проверяются тестом `test/docs-contributions.test.ts` (тема — проект из одного
`extension.json`, рендерер содержимого и правило оценки — с `src/*.ts`).
