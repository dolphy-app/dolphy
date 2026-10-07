# Система плагинов Paseo: устройство, оценка, что взять Dolphy

> Исследование на 2026-10-07 по клону `getpaseo/paseo` (0.11.0-beta.5, 2026-10-06) и реестру `getpaseo/plugins`. Решений не принимает: решения — в `specs/extension-runtime/SPEC.md`.

Paseo (≈19,9k звёзд, Apache-2.0) — десктопное, мобильное, веб- и CLI-приложение для управления кодовыми агентами (Claude Code, Codex и др.). Плагины — его главная точка роста.

## Как устроено

- **Две среды.** Клиентский код (`index.client.tsx`, каталог `client/`) исполняется в приложении на React Native с хостовыми экземплярами `react`, `react-native`, `@tanstack/react-query`, `zod` и SDK; любой другой модуль падает с `Module "<name>" is not available in plugin client code`. Серверный код (`index.server.ts`, `server/`) — обычный Node в подпроцессе демона: любые npm-пакеты, файлы, процессы. Общий код — `shared/`. Границы каталогов проверяет компилятор (импорт через границу, `node:*` в клиенте, React на сервере — ошибки сборки с именем правила).
- **Манифест минимален** (`paseo-plugin.json`: `id`, `requirements.paseo` как semver-диапазон; необязательно `name`, `icon`, `media`, `build`). Вклады не объявляются, а регистрируются кодом: `client.addScreen/addWorkspacePanel/addCommandCenterItem/addSlashCommand/addComposerPill/addTimelineTransformer/addTheme/…`, `server.handle(rpc, fn)`, `server.on(...)`, `server.before(...)`.
- **Слоты размечены в самом приложении.** Регистрация кладёт запись в массив установленного плагина (`workspacePanels`, `commandCenterItems`, `timelineTransformers`), а приложение в ≈15 местах (`composer/index.tsx`, `sidebar-nav/…`, `agent-stream/view.tsx`, `workspace-tabs/launcher`, `settings/…`) читает эти массивы. Нового места плагин создать не может.
- **Хуки — закрытый список.** Три «до»: `agent.create`, `agent.session_open`, `workspace.create`; девять событий (`agent.created`, `agent.turn_ended`, `agent.permission_requested`, …). Демон вызывает плагины по очереди в алфавитном порядке id (`runtime.ts`, `before`), каждому шлёт по IPC `{type: 'hook', kind: 'before', name, input}`, проверяет результат схемой и отдаёт следующему. Срок 30 секунд; ошибка, таймаут или невалидный ответ отменяют операцию. События — «выстрелил и забыл», ошибка обработчика не влияет на операцию.
- **Плагин — клиент того же протокола.** Подпроцесс получает сессию `plugin:<id>`, а транспорт `PluginSessionSocket` подменяет WebSocket: кадры идут внутри IPC-сообщений `paseo_frame`. Поэтому `paseo.agents.create(...)` в плагине работает так же, как у внешнего SDK `@getpaseo/client`.
- **Собственный RPC плагина.** `defineRpc({name, input, output})` на zod в `shared/`, `useRpc(contract)` в UI, `server.handle(contract, fn)` на сервере; вход и выход проверяются с обеих сторон; вызов идёт как `plugin.rpc.invoke.request` по WS-протоколу, затем `invoke` по IPC.
- **Компиляцию делает демон** при установке и перезагрузке; автор публикует исходники, а не бандл. Установочные скрипты npm не запускаются; зависимости, нужные хосту, объявляются в `build` манифеста.
- **Клиентский бандл доставляет демон**: готовая строка уходит приложению в каталоге плагинов, приложение исполняет её (`packages/app/src/plugins/evaluate.ts`) с хостовыми модулями.

## Транспорт (если смотрели на JSON-RPC)

Клиент ↔ демон — WebSocket со своим протоколом: JSON-сообщения `{type, requestId, …}`, схемы на zod в `@getpaseo/protocol`, имена `домен.сегмент.глагол.request|response` (`docs/rpc-namespacing.md`), потоковые `.update`. Версии согласуются диапазоном (берётся меньшая из максимальных), поля только добавляются, новые функции объявляются флагами `server_info.features` (`docs/protocol-compatibility.md`). Клиент проверяет входящее сгенерированным zod-aot валидатором: на Hermes 10,9 мс против 2,5 мс на сообщение в 353 КБ (`docs/protocol-validation.md`). Настоящий JSON-RPC 2.0 в Paseo только на стороне агентов: ACP по stdio и Codex app-server.

## Установка и каталог

- Источники: `owner/slug` (реестр), `git:owner/repo[:путь] [--ref]`, `github:`, `npm:name[@range]`, путь на хосте демона. `paseo plugin update` показывает прежнюю и новую ревизию и ждёт подтверждения; применяется ровно проверенный коммит или артефакт.
- Реестр `getpaseo/plugins` (создан 2026-10-07, 58 записей, 4 звезды): каждая запись пинит npm-артефакт с integrity или коммит git; слияние PR утверждает именно этот артефакт; новые версии идут отдельным PR (бот находит новейший тег). `REVIEW.md` — публичный регламент, бот читает его из `main`, а не из PR, и никогда не исполняет артефакт. Для страницы плагина обязателен `OVERVIEW.md` (не README) с жёстким контентным контрактом.
- `PROTOCOL.md` описывает реестр как два статических JSON (`index.json`, `plugins/<owner>/<slug>.json`): свой реестр поднимается на любом хостинге, закрытый — с токеном (`pluginRegistries`).
- Для агентов: `skills/paseo-plugin/SKILL.md`, `llms.txt`, `.md`-версия каждой страницы документации; руководство миграции 0.7 → 0.8 написано как «отдай эту страницу агенту».

## Десктоп под капотом

Electron 44.2.0, `electron-builder` 26.8, `electron-updater` (постепенный rollout, каналы stable/beta). UI окна — тот же Expo-клиент (Expo 54, React Native 0.81, `react-native-web`), собранный в веб-экспорт и положенный в ресурсы. Демон — отдельный долгоживущий процесс: main запускает CLI `paseo daemon start|stop|restart|status`, а CLI запускает Node-часть бинарём Electron с `ELECTRON_RUN_AS_NODE=1`. Окно к демону не подключается: WebSocket (unix-сокет, именованный канал или SSH-туннель) держит main-процесс и пересылает кадры окну по IPC (`paseo:event:local-daemon-transport-event`, бинарные кадры в base64). Окно: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, preload открывает одну поверхность `window.paseoDesktop.invoke`, страницы грузятся по схеме `paseo://`.

## Оценка

DX автора — 7/10: сильная концепция при низкой зрелости. Сильное: установка из любого источника, открытый протокол реестра, регламент ревью как документ, единая кодовая база на все платформы, готовый skill для агентов, ошибка границ контекстов на этапе компиляции. Слабое: нет hot reload (ручной `paseo plugin reload`; открытая задача «App's plugin reload does not rebuild a directory-installed plugin; CLI reload does»), нет песочницы и разрешений (один глобальный переключатель «Enable plugins»), нестабильный API (0.7.0 от 2026-08-31 до 0.11.0-beta от 2026-10-06: сменилась структура плагина в 0.8, плюс экраны, источники использования, `spawnProcess` и др.), скаффолд опубликованного 0.10.3 без тестов, линтера и CI; манифест не показывает вклады без запуска кода; отдельного тест-харнесса нет.

## Что взято в Dolphy

См. `specs/extension-runtime/SPEC.md`. Берётся: регистрация вкладов кодом, общий рантайм UI в окне (на Vue вместо React Native), клиент всех методов движка в расширении, закрытый каталог слотов, `defineRpc`/`useRpc` между клиентской и серверной частью, хуки в закрытом списке. Не берётся (решение владельца): установка из `git`/`npm`/пути, сборка при установке, открытый протокол реестра, `OVERVIEW.md`; остаются общий репозиторий на GitHub с CI и сборка `dolphy-ext build` на этапе компиляции. Вынужденные отличия: Vue вместо React Native, хост расширений в `utilityProcess` вместо подпроцесса демона.

## Что не проверено

- Приложение и плагины в работе не запускались; транспорт и хуки прочитаны из кода (`packages/server/src/server/plugins/*`, `packages/app/src/plugins/*`, `packages/protocol/src/messages.ts`) и документации (`public-docs/plugins/*`).
- Число 58 — записи каталога, не установки; метрик установок в открытом доступе нет.
- «≈15 мест» — число файлов приложения, импортирующих `@/plugins` вне папки плагинов, а не точное число слотов.
- Повторы вызовов после обрыва у клиента Paseo не изучались (в `creation` есть `idempotencyKey`).
- Производительность RPC Paseo и Dolphy не измерялась.

## Источники

- https://github.com/getpaseo/paseo (`public-docs/plugins/*`, `docs/plugins.md`, `docs/architecture.md`, `docs/protocol-compatibility.md`, `docs/protocol-validation.md`, `docs/rpc-namespacing.md`, `packages/desktop`, `packages/server/src/server/plugins`, `packages/app/src/plugins`, `packages/protocol/src/messages.ts`)
- https://github.com/getpaseo/plugins (`README.md`, `REVIEW.md`, `PROTOCOL.md`)
- https://paseo.sh/llms.txt
