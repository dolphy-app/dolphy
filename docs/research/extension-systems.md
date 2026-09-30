# Системы расширений в Electron-приложениях: VS Code, Theia, Hyper, Obsidian (+ Joplin, Figma)

Дата исследования: 2026-09-30. Вопрос: на какой модели строить систему расширений Spirula (Electron 44, движок и хост расширений в `utilityProcess`, Vue-renderer с `sandbox: true`), если дальше нужны команды и панели, темы, рендереры содержимого, импорт и экспорт, политика оценки, автоустановка, а расширения ставят ученики — не разработчики, при этом в приложении лежит личный журнал обучения.

Факты собраны по первоисточникам (ссылки в конце); выводы о применимости — наши. Не подтверждено: `[unverified]`.

## Критерии

Что важно именно нам: (1) безопасность для нетехнических пользователей с личными данными; (2) декларативность — видеть, что расширение трогает, без запуска кода; (3) ленивая загрузка; (4) цена создания и поддержки для малой команды; (5) как расширения добавляют UI; (6) распространение, обновление, совместимость версий; (7) близость к тому, что уже построено (хост в `utilityProcess`, `extension.json`, `contributes`, `spirula-ext://`).

## Сводка

| | VS Code | Theia | Hyper | Obsidian | Joplin | Figma |
|---|---|---|---|---|---|---|
| Где исполняется код | `utilityProcess` хост (Node, без песочницы); web-хост в WebWorker | форк Node-процесса на каждого клиента; расширения Theia — в основном коде | в main и renderer, `nodeIntegration: true`, `contextIsolation: false` | в renderer, с Node/Electron на desktop | скрытое `BrowserWindow` на плагин с `nodeIntegration: true` | QuickJS в WASM (нет DOM, fetch) + iframe UI с `null` origin |
| Изоляция как безопасность | нет; только стабильность | нет | нет | нет; «Restricted mode» вкл/выкл всё разом | нет; только стабильность | да, возможности ограничены |
| Манифест | `package.json`, ~37 точек `contributes` | как VS Code (+ DI-расширения на этапе сборки) | нет; экспорт хуков из npm-модуля | `manifest.json` без `contributes`; всё императивно | метаданные без `contributes`, всё императивно | декларативный (`menu`, `networkAccess`, `documentAccess`) |
| Активация | ленивая (`activationEvents`, неявная для вкладов с 1.74) | как VS Code | жадная, всё при старте | жадная, всё до входа в приложение | при старте | по действию пользователя |
| UI расширений | нативные вклады (команды, меню, деревья) + webview (iframe) | деревья и webview; прямой DOM — только собственные расширения Theia | HOC над React-компонентами хоста | прямой DOM (`ItemView`, `createEl`) | панели — iframe (изоляция опциональна) | iframe, общение по `postMessage` |
| Рендереры содержимого | notebook-рендереры | как VS Code | нет | `registerMarkdownCodeBlockProcessor`, post-processor | `contentScripts` (markdown-it), в основном процессе | — |
| Распространение | `.vsix`, Marketplace, подпись репозитория, чёрный список | `.vsix`, Open VSX | npm, `hyper i`, авто-обновление каждые 5 ч | GitHub Releases + каталог, автосканирование каждого релиза | `.jpl` из репозитория, обзора почти нет | ручное ревью перед публикацией |
| Совместимость версий | `engines.vscode` (semver-диапазон), proposed API | версия VS Code API на релиз, ~694 заглушек из ~8000 | нет | `minAppVersion` + `versions.json` (запасная версия) | `app_min_version` | `api` фиксируется на плагин |
| Цена | огромная (пара интерфейсов Main/ExtHost на область) | огромная (плюс постоянный догон VS Code) | мала на создание, велика на поддержку | мала на платформу, ревью автоматизировано | мала на создание, дорога на защиту | очень велика (собственная песочница) |

## VS Code

- Хост расширений — `utilityProcess` на окно (`ExtensionHostStarter` создаёт `WindowUtilityProcess`); VS Code сам добавил `UtilityProcess` в Electron ради выноса хоста из renderer при включении песочницы renderer (блог 2022-11). Хост не изолирован: «те же права, что у VS Code» (документ `extension-runtime-security`). В `extensionHostProcess.ts` подменены `process.exit`/`process.crash` — это защита стабильности.
- Разрешений нет. Запрос на декларацию возможностей (#314552, 2026-05) открыт; просьба скрыть `.env` от расширений (#235526) закрыта автоматически.
- Workspace Trust защищает от враждебной **папки**, а не от враждебного расширения: «не может помешать вредоносному расширению выполнить код». Расширение без `main` (темы, грамматики) доверия не требует; без декларации `untrustedWorkspaces` расширение в Restricted Mode отключается.
- Веб-хост (WebWorker) — прецедент «ограниченной среды»: нет Node, но полный `vscode` API. Расширения только с `contributes` работают там без изменений.
- Локализация: статические строки манифеста `%key%` из `package.nls.json` и `package.nls.<locale>.json`; строки времени выполнения — `vscode.l10n.t`.
- `when`-выражения (`&&`, `||`, `!`, `==`, `=~`, `<`, `in`) над ключами контекста; расширения добавляют ключи через `setContext`.
- Распространение: подпись Marketplace проверяется при установке (по умолчанию, блог 2025-06), доверие к издателю (диалог с 1.97), чёрный список с принудительным удалением, автообновление по умолчанию, корпоративные политики (`extensions.allowed`). Подпись автора («publisher signing») — только в планах.
- Инциденты: ловушка имён «Prettier» (Aqua, 2023), выход из webview (Trail of Bits, CVE-2022-41042), 21 эксплуатируемое расширение из 25 402 (NDSS 2024), утёкшие токены публикации в 500+ расширениях (Wiz, 2025-10), червь GlassWorm в OpenVSX (2025-10, 2026-03).

## Theia

- Четыре механизма: расширения Theia (на этапе сборки, InversifyJS, полный доступ), плагины Theia, расширения VS Code (через хост-процесс и Open VSX), headless-плагины.
- Хост — Node-процесс, форкаемый бэкендом (`cp.fork`), по одному на клиента; это стабильность, а не песочница (`[INFERENCE]` по коду; модели прав не найдено). `plugin-host.ts` подменяет `process.exit`. Веб-панели живут на отдельном origin (`{{uuid}}.webview.{{hostname}}`).
- RPC скопирован из VS Code (`rpcProtocol.ts`): пары `…Main`/`…Ext`, методы с `$`, msgpackr, функции через границу не ходят — провайдеры кэшируются по handle.
- Совместимость с VS Code — постоянная стоимость: версия API привязана к релизу (1.76.0 ↔ VS Code 1.139.0), ежедневный сравнитель, ~694 заглушки (расширение ставится, а функция молча не работает).
- Open VSX: CVE-2025-6705 (сборочные скрипты без изоляции, 81 расширение отключено), утечка токенов в октябре 2025. Подписи расширений не документированы `[unverified]`.

## Hyper

- Плагины — npm-модули, `require()`-ятся в main и в renderer; `nodeIntegration: true`, `contextIsolation: false`, `@electron/remote`. Мейнтейнер в 2016 (#523): «песочницы нет… плагин может читать файловую систему» — так и осталось.
- Нет манифеста, нет активации, нет проверки версий; 38 хуков (`decorateConfig`, `decorateTerm`, `middleware`, `reduceUI` …) — по сути внутренности React/Redux хоста, то есть API нестабилен по природе.
- Автообновление `latest` по таймеру, нет подписей и обзора кода; экосистема выцвела (49 из 101 пакетов — 2016–2019); Electron закреплён на 22 (вне поддержки).
- Ценное: изоляция сбоев — try/catch вокруг каждого хука, `componentDidCatch` возвращает недекорированный компонент; `localPlugins` для разработки.

## Obsidian

- Плагины в renderer, без ограничений; официально: «Obsidian не может надёжно ограничить плагины». Единственные ворота — Restricted mode (по умолчанию включён, выключение общее). Инцидент REF6598 (Elastic, 2026-04): вредоносной была не программа, а `data.json` общего хранилища, настроивший легитимные плагины на запуск PowerShell; жертве пришлось самой включить синхронизацию плагинов.
- Манифест без `contributes`, всё императивно (`addCommand`, `registerView`, `registerMarkdownPostProcessor`, `registerMarkdownCodeBlockProcessor`, `registerEditorExtension`…); активации нет, всё грузится до входа — отсюда `onLayoutReady` и `DeferredView`.
- Распространение: релиз GitHub с `main.js`, `manifest.json`, `styles.css`; `minAppVersion` + `versions.json` (запасная совместимая версия); автосканирование каждого релиза (нет обфускации, нет известных уязвимых зависимостей, раскрытие сети и доступа к файлам), карточка «scorecard» в каталоге. Подписей нет.
- Темы — отдельный тип: только CSS-переменные, без сетевых ресурсов.

## Joplin и Figma (полюс изоляции)

- Joplin: скрытое окно на плагин даёт защиту от зависаний, не от вредоносного кода (`nodeIntegration: true`); панели — iframe, изоляция по флагу `isolatePluginWebViews` (выкл. по умолчанию, «может сломать плагины»); `contentScripts` (markdown-it) — в основном процессе; CVE-2024-49362 (Mermaid → ссылка в окне с `nodeIntegration`). Манифест без прав («permissions… never implemented»). Настройки читаются любым плагином, включая пароли синхронизации. RFC #9582 предлагает центральную сборку `.jpl` и обзор по хешу коммита.
- Figma: логика в QuickJS/WASM без DOM и сети, UI в iframe с `null` origin; после уязвимостей Realms (2019) за ~9 дней заменили движок; «мембрана» ~500 строк — то, что обеспечило сменяемость движка. Цена: медленнее, отладка в devtools недоступна, зависший плагин не прервать, всё асинхронно. `networkAccess` в манифесте применяется через CSP и показывается при установке.
- Zed (WASM): декларативные вклады + WASM-модули, права `process:exec`/`download_file`/`npm:install` настраиваются, но базовый пример выдаёт всё; UI-поверхности нет.

## Оценка под нашу систему

Шкала 0–3, чем больше, тем лучше подходит нам.

| | Безопасность для учеников | Декларативность | Ленивость | Цена для малой команды | Расширяемость UI | Близость к текущему коду |
|---|---|---|---|---|---|---|
| VS Code | 1 | 3 | 3 | 2 (берём принципы, а не API) | 3 | 3 |
| Theia | 1 | 3 | 3 | 0 (совместимость с VS Code API) | 2 | 2 |
| Hyper | 0 | 0 | 0 | 3 (но дорога поддержка) | 1 (HOC хрупок) | 0 |
| Obsidian | 0 | 1 | 0 | 3 | 3 (прямой DOM) | 1 |
| Joplin | 1 | 1 | 1 | 2 | 2 | 2 |
| Figma | 3 | 3 | 3 | 0 (своя песочница) | 2 | 1 |

## Вывод (при приоритете безопасности; отменён разделом ниже)

**За основу берём архитектуру VS Code** (декларативный `contributes` + императивные провайдеры, ленивая активация, хост-процесс, RPC с handle, `when`, локализация `%key%`) — она уже совпадает с построенным. **Теория доверия VS Code (доверенный код + Marketplace) не берём**: у нас ставят ученики, а Marketplace-инфраструктуры нет. Вместо неё — три заимствования:

1. **Уровни доверия** (из веб-хоста VS Code и Figma): вклад без кода (темы, ключи, меню, схемы) не требует доверия и работает всегда; чистые функции (политика оценки, рендереры, импорт/экспорт) идут через узкий API без Node; полный Node-код — только для расширений из поставки и явно доверенных пользователем (`spirula.sql`). Расширение без `main` доверия не требует — как в VS Code.
2. **Ворота и раскрытие** (из Obsidian и VS Code #314552): сторонние расширения выключены, пока пользователь явно не включит; в манифесте `permissions` с локализованным описанием, показываемым при установке; выданный расширению API ограничен объявленными правами (прокси на область). Это единственное, что реально исполнимо без песочницы Node.
3. **UI сторонних расширений — iframe с отдельным origin** (Joplin/Figma/VS Code webview), а не shadow DOM в общем контексте. Shadow DOM оставляем для расширений из поставки.

Из распространения берём **Obsidian + Joplin**: релиз с фиксированным набором файлов, `minAppVersion` и `versions.json` для запасной версии, закреплённые версии и хеши (sha256), центральная сборка индекса, обновление только с согласия пользователя. Автообновление «latest» (Hyper, VS Code по умолчанию) для нас опасно: утёкший токен издателя превращается в массовую доставку (Wiz, 2025).

**Не берём:** совместимость с VS Code API (Theia: ~8000 записей и постоянный догон); внутренности хоста как API (Hyper); жадную загрузку и императивный манифест (Obsidian/Joplin); собственную VM-«мембрану» (Figma) — если понадобится, то готовый рантайм (QuickJS-WASM, Extism), и только для чистых функций.

### Что это значит для следующей спеки («фундамент + дешёвые вклады»)

- Реестр точек вклада (`registerExtensionPoint`-подобный): схема и обработчик на точку; `contributes` перестаёт быть строгим объектом.
- Поле `permissions` в манифесте + настройка «сторонние расширения» в `engine.db` (по умолчанию выкл.); расширение из поставки включено всегда.
- Классификация расширения по уровню (нет `main` / `main` без Node / `main` с Node), уровень виден в интерфейсе.
- Локализация манифеста (`%key%`, `package.nls`), `when`-выражения и снимок вкладов для renderer.
- Дешёвые вклады: темы и цвета (без кода), политика оценки (чистая функция, узкий API), рендереры содержимого (для сторонних — в iframe, для поставочных — как сейчас).
- Не входит и остаётся отдельной спекой: iframe-изоляция `ExerciseAnswer` для сторонних видов заданий, индекс и установка, панели и команды в UI.

## Пересмотр: приоритет — простота разработки и установки, безопасность вторична

Владелец продукта сменил веса: важнее всего, чтобы плагин было **легко писать и понятно, как он устроен** (в том числе сторонним разработчикам), и чтобы **ставился он как можно проще** (под будущий маркетплейс); безопасность сознательно отодвинута. Копировать модель VS Code не хочется. Ниже те же системы по новым критериям (0–3).

| | Простота написания плагина | Простота установки | Прозрачность (понятно, что происходит) | Готовность к маркетплейсу | Цена поддержки платформы |
|---|---|---|---|---|---|
| VS Code | 2 (мощные инструменты: генератор, F5-отладка, типы; но `package.json`, `vsce`, десятки точек) | 3 | 2 | 3 (но нужен целый сервис) | 0 |
| Theia | 1 | 2 | 2 | 2 | 0 |
| Hyper | 2 (проще всего, но API — внутренности хоста) | 2 (npm) | 1 | 1 | 3 |
| **Obsidian** | **3** (манифест + один `main.js`, класс `Plugin`, `register*`) | **3** (репозиторий GitHub, релиз из трёх файлов, установка из приложения) | **3** | **3** (`community-plugins.json` + релизы, без своего сервера хранения) | **3** |
| Joplin | 2 | 2 | 2 | 2 | 2 |
| Figma | 2 | 2 | 1 | 2 | 0 |
| Наша система сейчас | 1 (два бандла, файлы схем, ручной custom element, нет шаблона и цикла разработки) | 1 (копирование каталога) | 2 | 1 | 2 |

Вывод при новых весах: **по форме и распространению плагина берём Obsidian, по устройству ядра оставляем то, что уже есть** (хост в отдельном процессе даёт защиту от зависаний бесплатно, а не как меру безопасности).

Что берём у Obsidian: минимальный манифест; императивный API `register*` в `onload`/`activate` без обязательного объявления вкладов в манифесте; релиз из фиксированных файлов (`manifest.json`, `main.js`, `styles.css`); `minAppVersion` + `versions.json` с запасной совместимой версией; установка по адресу репозитория из приложения; каталог как один JSON-файл со ссылками на репозитории; шаблон плагина (`obsidian-sample-plugin`). Что берём у VS Code: только цикл разработки (отдельный режим запуска с перезагрузкой) и ленивую активацию по объявленным вкладам как необязательную оптимизацию. У Hyper: локальный каталог плагинов для разработки. У Joplin: единый `.jpl`-архив как формат обмена.

Слабые места Obsidian, которые надо смягчить: без манифеста с вкладами приложение не знает заранее, что плагин делает (поиск в каталоге, ленивая загрузка) — оставляем `contributes` необязательным описанием и подсказкой; жадная загрузка всего при старте — оставляем ленивую активацию по объявленным вкладам, а `activation: startup` включает пользователь плагина явно.

Безопасность: сторонний код исполняется с правами пользователя, интерфейс расширений — в общем JS-контексте приложения (как в Obsidian и Hyper). Это принятый риск; ему нужна запись в ADR. Дёшево оставить возможность позже добавить необязательное поле `permissions` и сканирование релизов в каталоге (как «scorecard» у Obsidian), не ломая манифесты.

## Источники

VS Code: https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security, https://code.visualstudio.com/api/advanced-topics/extension-host, https://code.visualstudio.com/api/extension-guides/web-extensions, https://code.visualstudio.com/api/extension-guides/workspace-trust, https://code.visualstudio.com/api/references/when-clause-contexts, https://code.visualstudio.com/api/references/contribution-points, https://code.visualstudio.com/api/references/activation-events, https://code.visualstudio.com/api/extension-guides/webview, https://code.visualstudio.com/api/working-with-extensions/publishing-extension, https://code.visualstudio.com/docs/enterprise/extensions, https://code.visualstudio.com/blogs/2022/11/28/vscode-sandbox, https://devblogs.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace, https://github.com/microsoft/vscode/issues/314552, https://github.com/microsoft/vscode/issues/235526, https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensions/electron-main/extensionHostStarter.ts, https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/node/extensionHostProcess.ts, https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/extensionsRegistry.ts, https://github.com/microsoft/vscode-l10n

Инциденты: https://www.aquasec.com/blog/can-you-trust-your-vscode-extensions, https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/, https://www.ndss-symposium.org/ndss-paper/untrustide-exploiting-weaknesses-in-vs-code-extensions, https://www.wiz.io/blog/supply-chain-risk-in-vscode-extension-marketplaces, https://checkmarx.com/zero-post/glassworm-targets-developer-ides-again-hiding-staged-malware-behind-runtime-rebuilt-loaders, https://www.koi.ai/blog/glassworm-first-self-propagating-worm-using-invisible-code-hits-openvsx-marketplace

Theia: https://theia-ide.org/docs/extensions/, https://github.com/eclipse-theia/theia/blob/master/doc/Plugin-API.md, https://theia-ide.org/docs/authoring_vscode_extensions/, https://theia-ide.org/docs/workspace_trust/, https://eclipse-theia.github.io/vscode-theia-comparator/status.html, https://nvd.nist.gov/vuln/detail/CVE-2025-6705, https://blogs.eclipse.org/post/mika%C3%ABl-barbero/open-vsx-security-update-october-2025

Hyper: https://raw.githubusercontent.com/vercel/hyper/canary/PLUGINS.md, https://raw.githubusercontent.com/vercel/hyper/canary/app/plugins.ts, https://raw.githubusercontent.com/vercel/hyper/canary/app/ui/window.ts, https://github.com/vercel/hyper/issues/523, https://raw.githubusercontent.com/vercel/hyper-site/master/pages/store/security-notice.mdx

Obsidian: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Extending%20Obsidian/Plugin%20security.md, https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts, https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Releasing/Plugin%20guidelines.md, https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/Manifest.md, https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Reference/Versions.md, https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Community%20directory/Developer%20policies.md, https://www.elastic.co/security-labs/phantom-in-the-vault

Joplin, Figma, Zed: https://joplinapp.org/help/dev/spec/plugins, https://raw.githubusercontent.com/laurent22/joplin/dev/packages/app-desktop/services/plugins/PluginRunner.ts, https://github.com/laurent22/joplin/issues/9582, https://github.com/advisories/GHSA-hff8-hjwv-j9q7, https://developers.figma.com/docs/plugins/how-plugins-run/, https://developers.figma.com/docs/plugins/manifest/, https://www.figma.com/blog/how-we-built-the-figma-plugin-system/, https://www.figma.com/blog/an-update-on-plugin-security/, https://zed.dev/blog/zed-decoded-extensions, https://zed.dev/docs/extensions/capabilities.md
