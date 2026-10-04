---
status: active
branch: feature/extension-authoring
created: 2026-10-04
closed: null
touches: [create-extension, extension-tools, extension-sdk, desktop]
depends-on: [specs/extension-foundation, specs/archive/2026-10-04-extension-housekeeping]
supersedes: null
superseded-by: null
---

# Авторинг расширений: руководство, шаблоны, цикл разработки, проверки и публикация

Живой документ, пока `status` — `draft` или `active`: `Progress`, `Surprises & Discoveries`, `Decision Log` обновляются вместе с кодом. По завершении фичи переносится в `specs/archive/` и не меняется. Правила — скилл `spec-workflow`.

## Цель

Новый автор (человек или агент) за один вечер проходит путь «проект → разработка с отладкой → проверка → PR в каталог» без чтения внутренних документов: проект приходит с `AGENTS.md`, шаблоном под задачу и CI; руководство на английском с проверяемыми примерами лежит в npm-пакете SDK; `dolphy-ext dev` собирает и запускает установленное приложение; `dolphy-ext lint` и новые правила `catalog check` ловят типичные ошибки до ревью; `dolphy-ext publish` открывает PR. Контракт движка не меняется. Публичные тексты (руководство, `AGENTS.md` проекта, сообщения CLI) — на английском.

## Не цели

- Сайт документации, typedoc-сайт, витрина каталога, `dolphy-ext analyze`, мастер «новое расширение» в приложении (отложено, список — `specs/archive/2026-10-04-extension-housekeeping`, Decision Log).
- Новые ключи манифеста, точки вклада, разрешения и методы `ctx`; изменения контракта и RPC.
- Подписанные публикации, проверка издателей, песочница ОС, запрет сети: правило «первый издатель владеет id» — проверка CI по логину автора, а не криптографическое владение.
- Отладка Node-кода расширения в отладчике: хост расширений запускается без инспектора (ADR 0011); остаются журнал и `ctx.logger`.
- Автообновление и сборка шаблонов под разные менеджеры пакетов (шаблон — pnpm, как весь репозиторий).

## Требования

Наблюдаемое поведение. Проверки — юнит-тесты `packages/create-extension/test`, `packages/extension-tools/test`, `apps/desktop/test`, `pnpm verify:packages` и PR в репозиторий каталога.

- R1. Проект с инструкциями для агента. Каталог, созданный `create-dolphy-extension`, содержит `AGENTS.md` (раскладка, команды, правила кода расширения, где руководство) и `CLAUDE.md` — одну строку-указатель `@AGENTS.md`. Каждая команда `pnpm <script>` из `AGENTS.md` есть в `scripts` проекта; путь к руководству, названный в нём, существует в пакете SDK. Проверка: `generate.test.ts` (состав файлов, сверка команд со `scripts`, существование `docs/quick-start.md` в `packages/extension-sdk`).
- R2. Инструкции в репозитории каталога. В `dolphy-app/dolphy-extensions` лежат `AGENTS.md` (к существующему разделу «Language» добавлены: раскладка, команды `catalog check`/`catalog build`, правила «версии неизменяемы — поднимайте `version`», «README объясняет разрешения», «id не менять») и `CLAUDE.md` с `@AGENTS.md`. Проверка: PR в каталог (см. «Решения», задачи C1–C4); команды из файла выполняются на любом расширении репозитория без ошибок usage.
- R3. Руководство в пакете SDK. Опубликованный `@dolphy-app/extension-sdk` содержит `docs/`: `quick-start.md`, пять рецептов (`recipe-exercise-type.md`, `recipe-theme.md`, `recipe-command-panel.md`, `recipe-event-storage.md`, `recipe-settings.md`), `no-build.md`, `debugging.md`; `README.md` пакета ссылается на них. Тексты английские. Проверка: `pnpm verify:packages` — tarball содержит все семь файлов; тест, что в каталоге `docs/` нет файлов, не перечисленных в этом требовании.
- R4. Примеры проверяются. Каждый блок `ts`/`json`/`js` в `docs/*.md` либо помечен строкой `File \`<path>\` (<label>):` и собирается, проходит `validate`, `tsc` с типами идентификаторов и, если пример включает `test/*.test.ts`, свои тесты `vitest`; либо помечен `<!-- fragment -->`. Блок без пометки роняет тест. Проверка: `packages/create-extension/test/sdk-docs.test.ts` (на всех пяти рецептах и `quick-start.md`) и негативный случай — временный документ с непомеченным блоком.
- R5. Рецепты равны шаблонам. Файлы рецептов «вид задания», «тема», «команда и панель», «события и хранилище» побайтно равны выходу `renderProject` для шаблонов `exercise`, `theme`, `command-panel`, `events` (с идентификатором `acme.hello`). Проверка: тот же тест; правка шаблона без правки руководства красна.
- R6. Шаблоны. `create-dolphy-extension <dir> --template exercise|theme|command-panel|events|blank` создаёт проект выбранного вида; без флага — `exercise` (выход не меняется). Неизвестное имя — код 2 и список имён. Каждый проект проходит `build`, `validate`, `lint` без замечаний, обнаруживается приложением и проходит собственные `pnpm test` и `pnpm typecheck`. Проверка: параметризованный `generated-project.test.ts` по всем шаблонам; `cli.test.ts` на ошибку.
- R7. Путь без сборки. `docs/no-build.md` показывает расширение из рукописных `extension.json` и `main.mjs` (`export default { activate(ctx) }`), без `package.json` и TypeScript. Проверка: файлы из документа проходят `validateExtension`, обнаруживаются `discoverExtensions`, а `main.mjs` активируется через `loadCommands` из `@dolphy-app/extension-sdk/testing` и отвечает на объявленную команду.
- R8. Карты исходников только в разработке. `dolphy-ext build --watch` пишет во все бандлы встроенные карты (`//# sourceMappingURL=data:application/json`); `dolphy-ext build` без `--watch` и `catalog build` — никогда. Проверка: `build.test.ts`/`watch.test.ts` — наличие в watch-выходе, отсутствие в обычной сборке; `catalog-build.test.ts` — в версии каталога нет карт.
- R9. DevTools для разработчика. Если задан `DOLPHY_DEV_EXTENSIONS`, в любой сборке (в том числе упакованной) `F12`, `Cmd+Alt+I` (macOS) и `Ctrl+Shift+I` переключают DevTools главного окна; рамки расширений видны в селекторе контекста консоли и в «Elements» под адресом `dolphy-ext://<id>/__dolphy/frame.html`. Без переменной сочетания ничего не делают, DevTools в упакованной сборке недоступны, как сейчас. Проверка: юнит-тест оболочки `electron/main/shells/devtools-shortcut.ts` с подставленными зависимостями (с каталогом разработчика — подписка и `toggleDevTools`, без — подписки нет); ручная проверка в `apps/desktop/README.md` (e2e не берёт: открытие DevTools нарушает правило «e2e без перехвата фокуса»).
- R10. `dolphy-ext dev [dir] [--app <path>]`. Запускает watch-сборку проекта и установленное приложение с `DOLPHY_DEV_EXTENSIONS=<dir>/dist-ext`; печатает путь приложения; Ctrl+C останавливает сборку и приложение, код выхода 0. Приложение ищется: `--app`, затем переменная `DOLPHY_APP`, затем стандартные места платформы (macOS `/Applications/Dolphy.app` и `~/Applications/Dolphy.app`; Windows `%LOCALAPPDATA%\Programs\Dolphy\Dolphy.exe`; Linux `~/Applications/Dolphy-Linux-*.AppImage`, берётся новейшая). Не найдено — код 2 и английское сообщение с путями, которые смотрели, и способами указать приложение. Если процесс приложения завершился за 5 с, печатается подсказка «Dolphy is probably already running: quit it and run again». Проверка: `dev.test.ts` с подставленными `exists`/`launch`/окружением на три платформы, на отсутствие приложения и на быстрый выход.
- R11. `dolphy-ext lint [dir] [--built <dir>]`. Проверяет проект: манифест (`name`, `description` не короче 20 символов, `author`, `tags` — предупреждения), `README.md` существует и не пуст, сборку (в `<dir>`, во временный каталог, либо готовый `--built`): `eval`/`new Function`, признаки обфускации (файл от 20 КиБ со средней длиной строки больше 500 или от 20 идентификаторов вида `_0x1a2b`), URL `http(s)://` в коде без разрешения `network`, встроенная карта исходников. Всё — `warning` (код 0), кроме отсутствующего `README.md` (`error`, код 1). Строки формата `catalog check`: `warning <id> <RULE> <field>: <message>`. Проверка: `lint.test.ts` с фикстурами на каждое правило и «чистый» выход шаблонов.
- R12. Новые правила `catalog check`. `CHECK-019` описание короче 20 символов (warning); `CHECK-020` разрешение из манифеста не упомянуто в `README.md` (warning); `CHECK-021` id уже в опубликованном индексе с другим `author` (без учёта регистра) — error, «первый издатель владеет id»; `CHECK-022` динамическое исполнение кода, `CHECK-023` обфускация, `CHECK-024` URL без `network` (все warning), `CHECK-025` встроенная карта исходников (error) — эти четыре работают на собранной версии, если указан `--built <siteDir>` (читается `<siteDir>/extensions/<id>/<version>/`); без флага молчат. `--list-rules` печатает все 25. Проверка: `catalog-check.test.ts` — по случаю на правило; id с другим автором падает, с тем же — нет, без `--published-index` — нет.
- R13. CI в сгенерированном проекте. Проект содержит `.github/workflows/ci.yml` (push и pull request): установка, `pnpm build`, `pnpm validate`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Проверка: тест разбирает файл и сверяет `pnpm`-команды со `scripts`; тот же набор скриптов выполняется на шаблонах (R6).
- R14. `dolphy-ext publish [dir] [--repo <owner/name>] [--dry-run]`. Требует `gh`: нет `gh` или нет входа — код 2 и английская инструкция (установить GitHub CLI, `gh auth login`, либо ручной путь из руководства). Иначе: форкает каталог, копирует проект в `extensions/<id>/` (без `node_modules`, `dist-ext`, `.dolphy`, `.git`, `.github`), выполняет `catalog check` с опубликованным индексом; при `error` останавливается кодом 1 до коммита и пуша; иначе пушит ветку `publish/<id>-<version>` и открывает PR через `gh pr create` с английским описанием. `--dry-run` делает всё, кроме пуша и PR, и печатает заголовок и описание. Проверка: `publish.test.ts` с фальшивым исполнителем `gh`/`git` и локальным репозиторием вместо форка: порядок вызовов, остановка на `error`, отсутствие `gh`, состав скопированных файлов.
- R15. Отладка через журнал. `docs/debugging.md` описывает просмотр журнала из W1 (Настройки → Расширения, фильтр по id расширения, `ctx.logger`, вывод ограниченного процесса) и инструменты R8–R10; текст сверен с реальными подписями окна (ru/en ключи i18n приложения названы в документе). Проверка: ревью + тест R4 для блоков кода.

## Решения

**Шаблоны.** `packages/create-extension/src/template.ts` (сейчас один шаблон) делится на модули по видам: `templates/{exercise,theme,command-panel,events,blank}.ts`, общие `package.json`, `tsconfig.json`, README, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml`. `renderProject` получает поле `template` (по умолчанию `exercise`), поэтому `docs.test.ts` (байт-в-байт сравнение блоков `extension.json` и `src/index.ts` из `docs/design/extensions.md`) остаётся как есть. Состав файлов проверяет `generate.test.ts` — список расширяется. `theme` без кода; его тест проверяет контраст `on-surface`/`surface` не ниже 4.5:1, иначе у `vitest run` не было бы файлов. `events` берёт за основу пример «серия дней» из `docs/design/extensions.md`. `blank` — одна команда без панели и вида задания: самый малый проект, который что-то делает. `scripts` получает `lint: dolphy-ext lint`. Зависимости `link:`/`^<версия>` — как сейчас (`dependencySpecs`); команды `dev`/`lint`/`publish` есть только в версии `extension-tools`, совпадающей с версией генератора (версии общие, ADR 0005). README шаблона после housekeeping (R6 там) дополняется `pnpm dolphy-ext dev`.

**Руководство.** `packages/extension-sdk/docs/*.md`, английский. Пометка примеров — `File \`path\` (label):` по образцу `docs-contributions.test.ts`, но на английском; сборщик блоков и проект-во-временном-каталоге вынесены в `packages/create-extension/test/docs-blocks.ts` (тест `sdk-docs.test.ts` живёт там же: у пакета уже есть `linkToolchain`, `tsc` и запуск `vitest` в `generated-project.test.ts`, а SDK не зависит от `extension-tools`). Режимы проверки те же, что в `docs-contributions.test.ts` (`manifest`, `build-no-code`, `build-with-code`), плюс `build-with-code-and-tests`. Публикация: `tools/lib/package-manifest.mjs` ставит `files: ['dist']` всем пакетам (стр. ~244) — для `extension-sdk` добавляется `docs`, `tools/build-packages.mjs` копирует каталог в `dist-publish/extension-sdk/docs`, `tools/verify-packages.mjs` проверяет состав tarball'а. README пакета (`packages/extension-sdk/README.md` и шаблон `tools/templates/package-readme.md`) получает ссылки.

**Карты и отладка.** `bundleConfig` в `packages/extension-tools/src/bundle.ts` не включает карты (`minify: false`, `sourcemap` не задан); `watchJob` в `watch.ts` передаёт `sourcemap: 'inline'` только в watch-режиме. Для браузерных бандлов (`view.mjs`, `panel.mjs`, `markdown.mjs`) DevTools применяют карту; Node-бандл `main.mjs` несёт карту, но приложение не включает `--enable-source-maps` у процесса расширений, поэтому стек в журнале указывает на строки `main.mjs` — это записано в `debugging.md`, а не чинится (флаги процесса — зона ADR 0003/0011). DevTools: новая оболочка `apps/desktop/electron/main/shells/devtools-shortcut.ts` в стиле `dev-extensions.ts` (внедряемые зависимости, регистрация только при заданном `devExtensionsDir`) подписывается на `before-input-event` окна и вызывает `webContents.toggleDevTools()`; меню приложения в `apps/desktop/electron` не задаётся, поэтому штатного пункта нет. Сочетание не расширяет разрешения: DevTools и так открываются в `pnpm dev` (`window.ts`, стр. ~107).

**`dolphy-ext dev`.** `packages/extension-tools/src/dev.ts`: `watchExtension` (как `build --watch`) и `child_process.spawn` приложения с `env.DOLPHY_DEV_EXTENSIONS`. У приложения единственный экземпляр (`requestSingleInstanceLock`, `electron/main/index.ts` стр. ~54): второй запуск молча завершается, а переменная теряется, поэтому `dev` не может отличить это от сбоя иначе, чем по быстрому выходу — отсюда эвристика 5 с. Пути платформ выбраны по `electron-builder.json` (`productName: Dolphy`, NSIS `perMachine: false`, `artifactName` Linux AppImage); для Linux фиксированного места нет, поэтому есть `--app` и `DOLPHY_APP`.

**`lint` и правила каталога.** `packages/extension-tools/src/lint/` — чистые функции `manifestFindings`, `bundleFindings(files)` и команда; те же функции вызывают правила `CHECK-019`…`CHECK-025` в `catalog/rules.ts`. `catalog check` работает по дереву исходников без `dist-ext` и `node_modules` (`SKIPPED_SOURCE_DIRS` в `catalog/check.ts`), собранного бандла там нет, поэтому правила 022–025 читают его из `--built <siteDir>`, а `RuleContext` получает `bundleDir: string | null`. Эвристики — только предупреждения: зависимости автора попадают в бандл целиком и дают ложные срабатывания (`new Function` в валидаторах схем); решение остаётся за ревьюером, правило 025 — исключение (карты в каталоге недопустимы). Правило 021 использует `published.extensions[].author` (`extension-catalog/src/schema.ts`, строка записи) и существующий `--published-index`. Фикстуры `catalog-helpers.ts` (`description` 34 символа, `README` `# Sample`) правил 019 и 020 не нарушают.

**`publish`.** `packages/extension-tools/src/publish.ts`, внешние вызовы (`gh`, `git`) — через внедряемый исполнитель по образцу `CatalogDeps`; значение по умолчанию `--repo` — `dolphy-app/dolphy-extensions`; адрес опубликованного индекса — константа рядом с `catalog check`. Копирование использует `SKIPPED_SOURCE_DIRS` плюс `.github`. Тело PR — английское, с пунктами «what it does», «permissions and why», ссылка на `README.md` расширения.

**Репозиторий каталога (`/Users/tinkerbells/projects/dolphy-extensions`, отдельный PR после выхода релиза `extension-tools` с правилами R12, иначе CI каталога не найдёт правил).** C1: `AGENTS.md` дополняется (R2) и появляется `CLAUDE.md`. C2: `README.md`, раздел «How to publish»: `--template`, `dolphy-ext lint`, `dolphy-ext publish`, `dolphy-ext dev`; убирается опечатка `..` в шаге 1. C3: `pr-check.yml` — после шага `Build` шаг `npx dolphy-ext catalog check extensions --ids <id> --skip-github-check --built site` (с `--published-index`, если индекс скачан). C4: `devDependencies` поднимается до релиза `extension-tools` с новыми правилами. Правила `rules/rules.json` не меняются.

## Progress

- [x] 3a. `lint` и правила каталога (один PR, `extension-tools`)
  - [x] `src/lint/` (манифест, бандл), команда `dolphy-ext lint`, справка CLI, README пакета
  - [x] `CHECK-019`…`CHECK-025`, флаг `--built`, `bundleDir` в `RuleContext`, тесты на каждое правило (R11, R12)
- [ ] 3b. Шаблоны и инструкции проекта (один PR, `create-extension`)
  - [ ] модули шаблонов, `--template`, `AGENTS.md`, `CLAUDE.md`, `ci.yml`, скрипт `lint`; тесты R1, R5-часть, R6, R13
- [ ] 3c. Руководство (один PR, `extension-sdk`, `tools/`)
  - [ ] `docs/quick-start.md`, пять рецептов, `no-build.md`; `docs-blocks.ts` + `sdk-docs.test.ts` (R4, R5, R7); упаковка и `verify:packages` (R3)
- [ ] 3d. Цикл разработки (один PR, `extension-tools`, `desktop`)
  - [ ] встроенные карты в watch (R8); `dolphy-ext dev` (R10); `devtools-shortcut.ts`, README приложения (R9)
  - [ ] `debugging.md` — после слияния журнала W1 (стадия 1b), с реальными подписями окна (R15)
- [ ] 3e. `publish` и каталог (после релиза)
  - [ ] `dolphy-ext publish` (R14); PR C1–C4 в `dolphy-app/dolphy-extensions` (R2)

## Surprises & Discoveries

- `catalog check` не видит собранный бандл: дерево исходников исключает `dist-ext`, `node_modules`, `.dolphy`, `.git` (`SKIPPED_SOURCE_DIRS`), а PR-проверка каталога запускает `check` до установки зависимостей и сборки (`pr-check.yml`). Отсюда `--built` и второй запуск после шага `Build`.
- В репозитории каталога уже есть `AGENTS.md` (только раздел «Language») и нет `CLAUDE.md`; README шаг 1 содержит опечатку `..`.
- Опубликованный пакет несёт только `dist`: `createManifest` задаёт `files: ['dist']` — без правки `tools/` `docs/` в tarball не попадёт.
- DevTools открываются сами только при `devServerUrl` (`window.ts`, стр. ~105–107); кода меню приложения в `apps/desktop/electron` нет [ВЫВОД из поиска `setApplicationMenu`: пусто].
- Единственный экземпляр приложения (`requestSingleInstanceLock`) делает «запуск с другой переменной окружения» молчаливым no-op.
- `generate.test.ts` проверяет точный список файлов проекта, `docs.test.ts` — побайтное совпадение с документом: поэтому шаблон по умолчанию остаётся прежним.
- У `ctx` уже есть `logger` (`ExtensionLogger` в `extension-api`), так что в рецептах журнал не требует нового API.
- Манифест с пустым `name`/`author` не проходит `parseManifest`, и `lint` не смог бы собрать проект; поэтому замечания `lint` о метаданных возможны только при отсутствующих ключах (пустое значение — ошибка сборки, её печатает `lint` как `error <id>: …`, код 1).
- Общий модуль попадает и в `main.mjs`, и в `view.mjs`: эвристики дают строку на каждый файл, где сработали.

## Decision Log

- 2026-10-04. Спека без изменения контракта движка и без новых ключей манифеста. Причина: все возможности — инструменты, документы и проверки вокруг существующего API.
- 2026-10-04. Рецепты руководства побайтно равны шаблонам. Причина: один источник истины, правка шаблона без документа ловится тестом.
- 2026-10-04. Руководство — markdown в npm-пакете SDK, без сайта. Причина: сайт документации в списке отложенного.
- 2026-10-04. Эвристики бандла — предупреждения, кроме встроенной карты. Причина: ложные срабатывания на зависимостях автора; обфускацию решает ревью.
- 2026-10-04. Правило «первый издатель владеет id» — `CHECK-021` по логину автора из опубликованного индекса. Причина: подписанные издатели и проверка издателей вне уровня безопасности (владелец, как у Obsidian: ревью, безопасный режим, диагностика).
- 2026-10-04. DevTools-сочетания только при `DOLPHY_DEV_EXTENSIONS`; e2e не добавляется. Причина: упакованная сборка не получает DevTools у обычного пользователя; открытие DevTools в e2e нарушает правило «без перехвата фокуса».
- 2026-10-04. Шаблон по умолчанию остаётся `exercise`. Причина: `docs.test.ts` и привычный выход генератора.
- 2026-10-04. Обратная совместимость не обеспечивается (владелец): приложение и расширения сырые, ломаем сразу. Причина: экономия усилий, нет внешних пользователей API.
- 2026-10-04. Безопасность — как у Obsidian: ревью, безопасный режим, диагностика; независимый аудит, песочница ОС, подписанный индекс, принудительное ограничение сети вне всех волн. Эвристики `lint` — подсказки ревью, не защита.
- 2026-10-04. Отложенное (сайт документации, typedoc, витрина, `analyze`, постраничный индекс, мастер в приложении, хуки планировщика, сервисы между расширениями, матрица совместимости, автообновление) — единый список в Decision Log `specs/archive/2026-10-04-extension-housekeeping`.
- 2026-10-04. Порядок волн: W0 `extension-housekeeping`, W1 `extension-foundation`, W2 `extension-api-breadth-1`, W3 `extension-authoring` (параллельно W2), W4, W5. Стадии 3a–3c от W1 не зависят; `debugging.md` (3d) ждёт журнал W1 (1b).
- 2026-10-04 (3a). Замечание `lint` о `tags` — отдельный идентификатор `LINT-001` (в каталоге такого правила нет); остальные строки `lint` несут идентификаторы `CHECK-003/004/019/022…025`. Причина: одна строка формата `catalog check` на замечание, без новых правил каталога.
- 2026-10-04 (3a). Отсутствующая сборка при `--built <siteDir>` — одно предупреждение `CHECK-022 --built`, а не молчание. Причина: опечатка в пути не должна выключать проверку незаметно. Без флага правила 022–025 молчат.
- 2026-10-04 (3a). Эвристика URL (`CHECK-024`) пропускает XML-пространства имён `www.w3.org`. Причина: `createElementNS('http://www.w3.org/2000/svg')` — типичный код видов, это идентификатор, не сетевой адрес.
- 2026-10-04 (3a). В `lint` встроенная карта исходников — `warning`, в `catalog check` (`CHECK-025`) — `error`. Причина: R11 «всё — warning, кроме README»; сборка `lint` карт не пишет, строка появляется только с `--built`.

## Outcomes

Заполняется при закрытии.
