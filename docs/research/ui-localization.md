# Как приложения дают добавлять и переопределять переводы без пересборки

Вопрос: можно ли в `@dolphy/desktop` добавлять языки интерфейса и править строки, не трогая исходники и не пересобирая приложение, и как это устроено в Obsidian, VS Code и других открытых Electron-приложениях.

Метки: факты взяты из первичных источников (исходники, README, доки) по ссылкам в §9; прочитаны 2026-10-05, ссылки на ветки (`main`, `master`, `dev`) не привязаны к коммиту. `[ВЫВОД]` — наше умозаключение; `[НЕ ПРОВЕРЕНО]` — в источниках не подтвердили. Эксперименты ставились только над `vue-i18n` 11.4.12 (§7); поведение самих приложений не измерялось, это обзор кода и документации. Ядро Obsidian закрыто: факты о нём из репозитория переводов, changelog и форума.

## 1. Итог

1. **Из 15 просмотренных систем конечный пользователь может добавить язык без пересборки только в трёх: VS Code (язык — расширение), Zettlr (`<userData>/lang/<tag>.po`), SiYuan (`<установка>/resources/appearance/langs/<tag>.json`).** Остальные вшивают язык в бандл или дают переопределять строки только оператору (Element, Mattermost server, Jitsi).
2. **Obsidian пользовательского механизма не имеет.** Язык ядра вшит; новый язык — PR в `obsidianmd/obsidian-translations` и релиз приложения. Единственный рантайм-путь — отладочный `selectLanguageFileLocation()` в dev-консоли, подменяющий язык целиком. Сообщество строит обходы (правка `main.js` плагинов, подмена DOM) — команда Obsidian их отвергает.
3. **У VS Code самая зрелая схема, но ради неё приходится нести цену:** язык — расширение с `contributes.localizations`, версия жёстко привязана к версии редактора (`engines.vscode`), смена языка только с перезапуском, Microsoft новых языков не принимает и PR с правками не берёт.
4. **Базовый язык всегда вшит и английский; остальные могут быть неполными, недостающий ключ берётся из базы.** Исключение по уровню — Zettlr: пользовательский файл заменяет встроенный целиком, слияния нет.
5. **Список языков почти везде явный** (реестр в коде, whitelist, `languages.json`). Автообнаружение каталога — только у Zettlr и SiYuan, и именно они дают добавление языка пользователем.
6. **Валидации сторонних файлов не делает никто.** Zettlr и SiYuan вставляют строки в `innerHTML`/HTML-шаблоны без экранирования (инъекция при подмене файла); SiYuan при отсутствии служебного блока падает на type-assert. Лучшая защитная практика — Bitwarden: whitelist локалей плюс регулярка имени против обхода пути.
7. **Расширения/плагины ни в одном приложении не получают общей i18n-инфраструктуры для чужих строк.** Либо плагин везёт свои файлы (SiYuan `i18n/<lang>.json`, VS Code `package.nls.*.json`, `l10n/bundle.l10n.*.json`, наши `locales/*.json`), либо ему отдают только текущий язык (Obsidian `getLanguage()`, Joplin, Logseq).
8. **Смена языка:** живая — Logseq, AFFiNE, MarkText, Joplin (частично), наше приложение; с перезапуском — VS Code, Zettlr, Element (через reload), Signal (выбор на старте).
9. **`vue-i18n` 11.4.12 допускает рантайм-загрузку** (`setLocaleMessage`, `mergeLocaleMessage`) без `eval`. Риск не в выполнении кода, а в трёх вещах: `v-html` с сообщением (XSS), `SyntaxError`/`RangeError` из `t()` на битом синтаксисе и циклах `@:`, AST-формы сообщений. Подробно в §7.

## 2. Сводка

| Система | Формат | Свой язык без пересборки | Кто регистрирует язык | Fallback | Смена языка |
|---|---|---|---|---|---|
| VS Code | JSON в расширении `Language Packs` | **Да** (vsix/Marketplace) | автоматически по `contributes.localizations` | ключ → английский из кода | рестарт |
| Obsidian | plaintext `[ключ] original=/translation=` | **Нет** (dev-консоль: полная подмена) | PR + релиз | пустой `translation=`, видимо, английский `[НЕ ПРОВЕРЕНО]` | не подтверждено |
| Zettlr | gettext `.po` | **Да** (`<userData>/lang`) | скан каталога | пустой `msgstr` → msgid; файл заменяется целиком | рестарт |
| SiYuan | JSON | **Да, с оговорками** (в каталог установки) | скан каталога | ключ → `en` на лету | `[НЕ ПРОВЕРЕНО]` |
| Element | JSON, `\|` в ключах | Нет; оператор переопределяет строки (`custom_translations_url`) | сборка (`languages.json`) | язык → `en` → ключ | reload |
| Joplin | `.po` → JSON | Нет | скан `.po` при сборке | пустая строка → msgid | живая |
| Logseq | `.edn` | Нет | три места в коде | `tongue/fallback :en` | живая |
| AFFiNE | JSON, ленивый `import()` | Нет | реестр в коде | `en` | живая |
| Notesnook | `.po` → Lingui | Нет | конфиг Lingui | `en` | `[НЕ ПРОВЕРЕНО]` |
| MarkText | JSON с диска `resources` | Нет (список захардкожен) | `SUPPORTED_LANGUAGES` | `en` | живая |
| Signal Desktop | `messages.json`, ICU | Нет | сборка | выбранный язык поверх `en` | старт |
| Mattermost | JSON; webapp грузит с сервера | Нет; админ правит файлы сервера | реестр + `AvailableLocales` | `en` | `[НЕ ПРОВЕРЕНО]` |
| Bitwarden | Chrome-style JSON с диска ресурсов | Нет | whitelist | `en` | — |
| Jitsi | JSON по HTTP | Нет; админ правит `lang/` | `languages.json` | `en` | — |
| Chrome-расширения | `_locales/<loc>/messages.json` | Нет | пакет | локаль → язык без региона → `default_locale` | — |

## 3. VS Code

- **Языковой пакет — обычное расширение** (категория `Language Packs`, точка `contributes.localizations`): `languageId` и `translations[{id, path}]`, `id` — `vscode` (ядро) или `publisher.extension`. Установка — `Configure Display Language`, Marketplace или vsix: `code --install-extension x.vsix; code --locale tr`. Ядро собрано только с английским. Источники: `localization.contribution.ts`, vscode-loc wiki «How to create language pack extension».
- **Реестр собирается из установленного.** `NativeLanguagePackService` пересобирает `<userData>/languagepacks.json` из `contributes.localizations` всех расширений; кэш склеенного массива лежит в `<userData>/clp/<hash>.<lang>/nls.messages.json`. Английский массив `nls.keys.json` + `nls.messages.json` склеивается с `main.i18n.json` пакета. Процессы получают конфиг через `VSCODE_NLS_CONFIG`.
- **Формат ядра:** `contents[moduleId][key] = value`, ключ индекс-привязан к модулю; файл русского пакета около 3,2 МБ. Плейсхолдеры `{0}`, `{1}`, плюралов нет (решаются разными ключами).
- **Fallback:** отсутствующий ключ → английская строка по индексу; язык `pt-br` → `pt` → английский. Пакет привязан `engines.vscode: ^X.Y.Z`.
- **Выбор языка:** `--locale` > `locale` в `argv.json` > `app.getLocale()`. Команда пишет `argv.json` и вызывает `hostService.restart()`; живого переключения нет (метки нужны в main-процессе, настройка читается слишком рано). Автоустановка из галереи — только для издателя `ms-ceintl`.
- **Расширения:** `package.nls.json` / `package.nls.<locale>.json` рядом с `package.json`, строка манифеста вида `%key%` (заменяется только значение целиком `%…%`, как и у нас), цепочка `fr-ca → fr → package.nls.json`; строки кода — `vscode.l10n.t(...)`, ключ — английский текст, бандлы `l10n/bundle.l10n.<locale>.json`. Языковой пакет может перекрыть `package.nls` любого `publisher.name` (ветка `translationPath`), но реальных примеров нет; строки `l10n.t` чужих расширений пакет не переводит (только builtin).
- **Пайплайн:** 2017 — Transifex, затем MLCP (закрыт 2020), сейчас переводы ведёт Microsoft во внутреннем инструменте; vscode-loc: «Pull requests fixing translations won't be accepted», новых языков не добавляют (14 пакетов), правки только через issue. С 2026 пайплайн ломался при weekly-релизах (issue #300601).
- **Форки:** VSCodium берёт пакеты `MS-CEINTL.*` из Open VSX (зеркало автоматическое); ядро от галереи не зависит, оффлайн-установка vsix работает.
- **Слабые места:** перезапуск; привязка к версии (`not compatible with the current version`); качество русского перевода без возможности исправить PR-ом; RTL как язык интерфейса не поддерживается (issue #11770 открыт с 2016).

## 4. Obsidian

- **Ядро:** `obsidianmd/obsidian-translations`, `translations/<code>.txt` (73 файла). Формат собственный: блоки `[ключ]` с `original=` (английский) и `translation=`; `en.txt` — шаблон из 2602 пустых `translation=`. Ключи иерархические (`setting.file.label-excluded-files-count`) и синхронизируются из приложения («Sync translations with app.»). Раньше формат был JSON; в 1.12 (2026-02-27) сменили («translation files … bundled with the app»).
- **Вшито в приложение.** Слияние PR ≠ попадание в релиз (joethei, 2025-02: переводы не вливают мгновенно, чтобы другие успели прокомментировать; пользователи форума жалуются, что влитые за два месяца переводы в релиз не попали).
- **Единственный рантайм-путь:** `selectLanguageFileLocation()` в dev-консоли просит `.txt`, перезагружает приложение с этим языком; откат — `localStorage.removeItem('language')`. Это отладочный механизм для проверки перевода: подмена целиком, частичного оверрайда нет `[ВЫВОД]`; значение `language` становится путём к файлу, и плагины, сравнивающие его с `'zh'`, перестают узнавать язык.
- **Fallback и плюрали:** `{{count}}` (i18next-стиль); плюраль — суффикс `_plural` (40 ключей) и один `_zero`. Русский файл содержит две формы «правило / правил» и не выражает формы 2–4 `[ВЫВОД]` (CLDR не используется).
- **Вклад:** только GitHub PR; полнота — таблица в README вручную; эндоним языка (как он показывается в приложении) указывают в описании PR. Валидации в CI нет (остался `eslint --ext .json`). Проверка — ручное ревью, которое команда сама называет слабым местом (переводчик может спрятать оскорбление при отсутствии ревьюера со знанием языка).
- **RTL:** с 1.6 интерфейс зеркалится для арабского, иврита, фарси, урду и др.
- **Плагины:** `getLanguage()` (`@since 1.8.7`) возвращает ISO-код языка приложения. Своей инфраструктуры строк плагинов нет: запрос «API to change language» закрыт ответом «use i18next». Популярные плагины делают сами: Tasks (i18next, словари в `main.js`: рост 524 → 713 КБ при покрытии 10–20 % строк), Leaflet (`locale[str] ?? en[str] ?? str`), Excalidraw (LZString-словари), Note Toolbar (инстанс `i18next` на плагин; 3 перевода за дни после выноса строк).
- **Перевод чужих плагинов пользователем — сообщество и отказ команды:**
  - `obsidian-i18n` правит файлы плагина на диске (AST `main.js`, бэкап, disable/enable) — команда Obsidian отказала в каталоге («not comfortable with a plugin modifying the source files of another plugin», пересказ автора); авторы плагинов отказываются поддерживать изменённую сборку (Tasks: «I am not willing to spend my time doing user support for scenarios where my plugin's code has been edited»).
  - Translay Translator подменяет отрисованный текст через DOM; по цитате автора отклонён: «too hacky… contribute translations to the individual plugins».
  - `i18n+` — договор с плагином: плагин встраивает адаптер (~150 строк) и регистрируется `window.i18nPlus.register(pluginId, translator)`, словари `<vault>/.obsidian/plugins/i18n-plus/dictionaries`, формат с `$meta` (`pluginId`, `pluginVersion`, `dictVersion`, `locale`), цепочка: внешний словарь → встроенный → последний успешный → `en` → ключ; облачная загрузка ограничена префиксом `raw.githubusercontent.com/open-obsidian-i18n/dictionaries/main/`. Работает только с плагинами, которые подключили адаптер.
  - Trans-Hub Localizer — пакеты с сервера через `MutationObserver`, `textContent`, `expectedBytes`, таймаут 30 с, проверка версии плагина и плейсхолдеров.
- **Официальная позиция (joethei, форум 2024–2025):** «What is translated … is something for plugin devs to manage themselves»; автоперевод во время работы «hacky»; допускает хелперы, но не реализовал.
- **Вывод для нас:** пользовательских подкладываемых словарей нет ни для ядра, ни для плагинов; всё, что делают пользователи, — обходные пути, которые команда не принимает.

## 5. Другие приложения

- **Zettlr** (ближайший пример «положил файл — появился язык»). Формат — gettext `.po`, имя файла `[a-zA-Z0-9-]+\.po` (BCP 47). `enumLangFiles` сканирует сначала `<userData>/lang` (каталог создаётся при старте), затем встроенный `lang/`; файл пользователя заменяет встроенный с тем же тегом **целиком**, слияния нет. Выбор — `appLang` (5–7 знаков), список в настройках строится из найденных файлов; смена требует перезапуска. Нет плюралов (только `msgstr[0]`), `%s` заменяется по одному; полноты в UI нет. Валидация — парсинг и имя файла; строки уходят в `innerHTML` (`file-preview.ts`), поэтому вредоносный `.po` = HTML-инъекция `[ВЫВОД]`. Пункт «Import translation…» ждёт `.json`, а загрузчик читает `.po` — остаток миграции, импорт `.po` через меню, вероятно, не работает `[ВЫВОД, в рантайме не проверено]`.
- **SiYuan.** `app/appearance/langs/<tag>.json`, плоские ~2500 ключей плюс служебные блоки `_label`, `_time`, `_taskAction`, `_trayMenu`, `_attrView`, `_kernel`. Ядро (Go) читает **все** файлы из `<WorkingDir>/appearance/langs`, реестра языков в коде нет. `serve.go` достраивает недостающие ключи верхнего уровня из `en.json`. Прецедент: `ru_RU.json` в `resources/appearance/langs/` появился в списке языков (issue #10209), но дерево документов сломалось (причина не выяснена). Слабые места: нужен доступ к каталогу установки (внутри `.app` на macOS), файл теряется при обновлении `[ВЫВОД]`, отсутствие блока `_label`/`_kernel` вызывает panic при type-assert `[ВЫВОД]`, значения вставляются в HTML-шаблоны без экранирования. Плагины SiYuan: `i18n/<lang>.json`, выбор `Conf.Lang → en → zh-CN`, весь выбранный объект отдаётся плагину без слияния с `en`.
- **Element.** `custom_translations_url` в `config.json` (desktop: `%APPDATA%/…`, `~/Library/Application Support/…`, `~/.config/…`) — URL JSON формата `{"affected|translation|key": {"languageCode": "new string"}}`; загружается в `setLanguage()` после основных строк, кэш 5 минут, все ошибки глушатся (`logger.warn`), никакой схемы. Это оверрайд строк для оператора, **нового языка он не добавляет**, и часть строк (даты, «Last week») не переопределяется (issue #30164); документации нет (#28533). Основные языки грузятся `fetch` из файлов с хэшами рядом с webapp; смена языка = reload; desktop-меню имеют отдельный набор из 41 файла (issue #32123: язык есть в рендерере, но нет в desktop-наборе → меню английское). Переводчики — Localazy.
- **Joplin.** `.po` в `packages/tools/locales/`, при сборке — `packages/lib/locales/<locale>.json` и `index.js` со статическими `require`. Загрузчика с диска нет; автор Joplin: для сборки JSON нужен `yarn buildTranslations`. Плюрали из заголовка `.po`, `sprintf-js`; `closestSupportedLocale`: точное → язык без региона → `en_GB`. Список языков показывает проценты (`Русский (81%)`). Переводы — Poedit и PR (Weblate/Crowdin для приложения не используются).
- **Logseq.** `src/resources/dicts/<locale>.edn`, словарь подтягивается макросом на этапе компиляции; значения могут быть hiccup и `(fn …)` (не JSON). Fallback — `tongue/fallback :en`, пропуски разрешены («do not copy English into your locale file»). Хороший инструмент: `bb lang:validate-translations` (лишние/неиспользуемые ключи, несовпадение `{1}`), `bb lang:list` (непереведённые). Смена языка живая.
- **AFFiNE.** Реестр `SUPPORTED_LANGUAGES` с флагом `rtl`, ленивый `import('./ru.json')`, полнота считается скриптом (`i18n-completenesses.json`) и показывается в меню; `document.dir`/`lang` ставятся при смене. Ключи типобезопасны через `@magic-works/i18n-codegen`.
- **Notesnook.** Lingui (`.po`, `sourceLocale: "en"`, `fallbackLocales` на `en`, `pseudo-LOCALE`); загрузка собственного профиля в приложении — открытый запрос (#6653).
- **MarkText.** Список языков `SUPPORTED_LANGUAGES` захардкожен; **кастомный `messageCompiler` оборачивает `compile()` в `try/catch` и возвращает сырой текст при `SyntaxError`** — причина issue #4046: один кривой перевод (`{{x}}`, linked-синтаксис) ронял renderer при экспорте. Тот же стек `vue-i18n`, что у нас.
- **Signal Desktop.** `_locales/<lang>/messages.json` с ICU (`messageformat`), всё в бандле; `--lang` и `localeOverride`; `LocaleMatcher.match(..., 'en', {algorithm: 'best fit'})`, поверх английского `matched[i] ?? english[i]`. Владелец проекта отказывается подставлять чужие локали: «we can't really guarantee stability». Переводы — Smartling, PR с правками перевода не принимают.
- **Mattermost.** Desktop — whitelist 22 языков в `i18n/i18n.ts`, переводы через Weblate, не PR. Webapp грузит не-английские файлы с сервера по `url` из сгенерированного `imports.ts`; админ ограничивает `AvailableLocales`, правит `server/i18n/*.json`. Плагины: `registry.registerTranslations(getTranslationsForLocale)`; серверные строки перекрывают плагинские при совпадении ключей.
- **Bitwarden Desktop.** `apps/desktop/src/locales/<lang>/messages.json`, Crowdin, чтение с диска из ресурсов приложения в main-процессе с отдачей рендереру по IPC; **регулярка `/^[a-zA-Z_-]+$/` на имя локали «to avoid possible path traversal» плюс жёсткий `supportedTranslationLocales`**.
- **Jitsi Meet.** `lang/main-<lang>.json` по HTTP через `i18next-http-backend`, английский вшит, `whitelist` из `languages.json`; параметр URL `lang` проверяется по allowlist («defence-in-depth»).
- **Chrome-расширения (эталон формата и fallback).** `_locales/<loc>/messages.json`, `default_locale` обязателен при наличии `_locales`; цепочка: локаль (`en_GB`) → язык без региона (`en`) → `default_locale`; в `messages.json` языка по умолчанию должны быть **все** строки, остальные языки могут быть неполными. Плюралов нет.

## 6. Платформа Electron

- `app.getPreferredSystemLanguages()` — упорядоченный список языков UI (документация называет его подходящим для выбора языка приложения); `app.getLocale()` зависит от файлов в папке `locales` Chromium и вызывается после `ready`; `app.getSystemLocale()` — локаль форматов дат/чисел; `--lang` — переключатель Chromium.
- Папка `locales/*.pak` (`*.lproj` на macOS) содержит строки **Chromium** (контекстные меню, диалоги), не приложения. `electronLanguages` в electron-builder обрезает её для размера; его список нужно держать в согласии со списком языков приложения, иначе меню Chromium останется на английском. Если ни один код не совпал, очистка пропускается (иначе приложение падает на старте: electron#52307). `[ВЫВОД]` Для добавленного во время работы языка без `.pak` меню Chromium останется на ближайшем встроенном.
- Spellcheck — отдельный API `ses.setSpellCheckerLanguages`; от языка интерфейса не зависит.

## 7. `vue-i18n` для рантайм-загрузки

Проверено на `vue-i18n` 11.4.12 (версия из `apps/desktop/package.json`) и `@intlify/*` 11.4.13; исходные скрипты не сохранялись.

**API.** `i18n.global.setLocaleMessage(locale, obj)` заменяет локаль целиком, `mergeLocaleMessage(locale, patch)` — глубокое слияние поверх существующего, `availableLocales`, `fallbackLocale` (строка, массив, карта). Официальный ленивый паттерн — `await import('./locales/xx.json')` + `setLocaleMessage`. `[ВЫВОД]` `mergeLocaleMessage` годится для оверрайда строк встроенного языка, `setLocaleMessage` — для нового языка; вместо `import()` — IPC или `fetch`.

**Выполнение кода.** Рантайм-компиляция JSON-строк в v11 не требует `unsafe-eval`: в `dist/*.mjs` `vue-i18n` и `@intlify/{core,core-base,message-compiler,shared}` нет `eval(` и `new Function`. Динамическую CSP в браузере не гоняли `[НЕ ПРОВЕРЕНО]`. Выражения в `{…}` не вычисляются: `{ _ctx.constructor }` → `SyntaxError: Invalid token in placeholder`.

**Что ломает `t()` (прогнано):**

| Вход | Результат |
|---|---|
| `{unclosed` | `SyntaxError: Message compilation error` из `t()` |
| `@:self` или цикл `a: '@:b'`, `b: '@:a'` | `RangeError: Maximum call stack size exceeded` |
| `x @:secret` | подставляет значение другого ключа той же локали |
| `{name}` со значением `<i>x</i>` | подставляется без экранирования (по умолчанию) |
| объект `{type:0, body:{type:2, static:'<b>AST</b>'}}` | принимается как готовое сообщение (обход компиляции) |
| `JSON.parse('{"__proto__":…}')` в `setLocaleMessage`/`mergeLocaleMessage` | загрязнения нет (`deepCopy` пропускает `__proto__`) |

**HTML.** `warnHtmlMessage` предупреждает только при `NODE_ENV !== 'production'`; в production защиты нет. `escapeParameter` экранирует параметры, но не саму строку перевода: на `<img src=x onerror=alert(1)> {name}` тег остаётся, нейтрализуется лишь `onerror` (санитайзер — набор регулярных выражений, не HTML-парсер). Закрытые advisories ветки: CVE-2024-52809 и CVE-2024-52810 (9.14.2/10.0.5), GHSA-p2ph-7g93-hw3m (`flatJson`), CVE-2025-53892 (11.1.10); версия 11.4.12 новее исправлений.

**Вывод.**
1. Вывод только через `{{ t() }}`, `$t`, `<i18n-t>` — HTML из перевода становится текстом (Vue экранирует).
2. Риск появляется при `v-html="t(...)"`/`innerHTML`. `[ВЫВОД]` В `apps/desktop/src` и `packages/ui` `v-html` сейчас только в `ReadmeView.vue` и `MarkdownView.vue` (оба — выход `markdown-it` с `html: false`, не `t()`): за счёт этого внешний перевод не встретит `v-html` с сообщениями; правило надо закрепить линтом, не доверять памяти.
3. Политика для загружаемого пакета `[ВЫВОД]`: принимать только строки и вложенные словари (отвергать AST-формы `type`/`body`/`b`); ключи `__proto__`, `constructor`, `prototype` отбрасывать до `vue-i18n`; лимит размера и глубины; пробная компиляция каждого сообщения в `try/catch` до `setLocaleMessage`; запрет `@:` или проверка, что ссылки ведут на существующие ключи без циклов; сверка плейсхолдеров с `ru`/`en` (как `bb lang:validate-translations` у Logseq); `messageCompiler` с откатом на сырой текст (как у MarkText).

## 8. Что взять и чего избегать `[ВЫВОД]`

**Берём:**
- **Две отдельные вещи — полноценный новый язык и точечный оверрайд строк.** Element и Obsidian показывают, что смешивать их нельзя: оверрайд не умеет добавлять язык, а подмена языка целиком (Obsidian `selectLanguageFileLocation`) не умеет частичного патча.
- **Fallback на уровне ключа** (VS Code, SiYuan, Logseq, Chrome, Signal): язык пользователя → `en` → ключ. Не повторять Zettlr, где файл заменяется целиком. В `vue-i18n` это `fallbackLocale: 'en'` (уже стоит `FALLBACK_LOCALE`).
- **Явная регистрация и проверка имени:** Bitwarden (regexp + whitelist) или Zettlr (`[a-zA-Z0-9-]+`, BCP 47).
- **Валидацию при загрузке** по §7 и **диагностику вместо падения**: плохой файл пропускается с предупреждением, приложение остаётся на `en` (у нас уже так для `locales/*.json` расширений: `locale.invalid-file`, `locale.missing-key`, лимиты 64 КиБ / 500 ключей / 500 знаков).
- **Показатель полноты** (AFFiNE `i18n-completenesses.json`, Joplin `percentDone`): для внешнего языка считается на лету по ключам `ru`/`en`.
- **Стабильные ключи, а не английский текст** (наш `t('…')` с типами от `ru`): правка английской формулировки в VS Code `l10n.t` ломает существующие переводы.

**Избегаем:**
- Правку чужих файлов и подмену DOM (Obsidian-плагины): команда Obsidian их не принимает, авторы плагинов отказывают в поддержке.
- Хранение в каталоге установки (SiYuan): внутри `.app` не записать, теряется при обновлении. Каталог пакетов — в `userData`.
- Привязку пакета к точной версии приложения (VS Code `engines`) без нужды: у нас достаточно версии схемы каталога сообщений (см. ниже).
- Перезапуск при смене языка: у нас живое переключение через `applyLocale` уже есть.
- Двухформенные плюрали (`_plural`, Obsidian) и один `msgstr[0]` (Zettlr): у `ru` четыре формы, а `vue-i18n` берёт правило из `pluralRules` по языку. Для добавленного языка нужен способ задать правило: `Intl.PluralRules` по тегу `[ВЫВОД]` или поле в манифесте пакета.

**Открытые вопросы для спеки:**
1. Форма пакета: каталог `<userData>/locales/<tag>.json` (Zettlr-подобно) или язык как вклад расширения (VS Code-подобно) со всей уже существующей механикой установки, импорта-экспорта, каталога и диагностик. Во втором варианте «язык — одно расширение» совпадает с уже принятым правилом для языка рендерера содержимого (`docs/design/extensions.md`, §«язык»). Что даёт расширение «из коробки» и чего не даёт для данных такого типа — не проверяли `[НЕ ПРОВЕРЕНО]`.
2. Что переводит пакет: только каталог приложения (`appMessages`) или ещё и встроенные расширения/Vuetify (`$vuetify`).
3. Меняется `LocaleMode`/схема RPC/валидация настроек: `ru|en|system` → код найденного языка.
4. Названия языков для списка (`languageName` / `localizedLanguageName` у VS Code, эндоним у Obsidian) и направление письма (`rtl`, AFFiNE) — нужны ли.
5. Оверрайд строк встроенных `ru`/`en` — нужен ли вообще, или достаточно нового языка.

## 9. Источники

Все ссылки открывались при написании. Файлы по веткам, не по коммитам, если не указано иное.

- VS Code: `https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/localization/common/localization.contribution.ts`; `…/src/vs/platform/languagePacks/node/languagePacks.ts`; `…/src/vs/base/node/nls.ts`; `…/src/bootstrap-esm.ts`; `…/src/mainImpl.ts`; `…/src/vs/workbench/services/localization/electron-browser/localeService.ts`; `…/src/vs/platform/extensionManagement/common/extensionsScannerService.ts`; https://github.com/microsoft/vscode/issues/39178; https://github.com/microsoft/vscode/issues/300601; https://github.com/microsoft/vscode/issues/11770; https://github.com/microsoft/vscode-loc (README, wiki «How to create language pack extension»); https://github.com/microsoft/vscode-loc/issues/1424; https://github.com/microsoft/vscode-l10n; https://github.com/microsoft/vscode-discussions/discussions/159; https://code.visualstudio.com/docs/configure/locales; https://raw.githubusercontent.com/VSCodium/vscodium/master/docs/extensions.md; https://open-vsx.org/api/MS-CEINTL/vscode-language-pack-ru.
- Obsidian: https://github.com/obsidianmd/obsidian-translations (README, `scripts/txt-parser.ts`, `translations/en.txt`); https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/; https://obsidian.md/help/language; `https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts`; форум: https://forum.obsidian.md/t/translations-should-be-part-of-the-build-process/96011, https://forum.obsidian.md/t/allow-users-to-translate-plugins/84437, https://forum.obsidian.md/t/translation-of-plugins-to-other-languages/15715, https://forum.obsidian.md/t/a-way-to-get-obsidian-s-currently-set-language/17829, https://forum-zh.obsidian.md/t/topic/54786; обсуждение плагина obsidian-i18n: https://github.com/eondrcode/obsidian-i18n/discussions/19 (цитаты Discord — в пересказе автора, вторичный источник); `i18n-plus`: https://github.com/open-obsidian-i18n/i18n-plus; Translay: https://github.com/dangehub/obsidian-translay-translator; Trans-Hub: https://github.com/SakenW/trans-hub-obsidian-localizer; Tasks: https://github.com/obsidian-tasks-group/obsidian-tasks/discussions/3321, `src/i18n/i18n.ts`; Leaflet: `https://raw.githubusercontent.com/javalent/obsidian-leaflet/main/src/l10n/locale.ts`.
- Zettlr: `https://raw.githubusercontent.com/Zettlr/Zettlr/develop/source/common/util/enum-lang-files.ts`, `…/get-language-file.ts`, `…/find-lang-candidates.ts`, `source/common/i18n-main.ts`, `source/app/service-providers/commands/import-lang-file.ts`, `source/app/util/environment-check.ts`, `scripts/i18n.sh`.
- SiYuan: `https://raw.githubusercontent.com/siyuan-note/siyuan/master/kernel/model/conf.go`, `kernel/server/serve.go`, `kernel/util/lang.go`, `kernel/model/plugin.go`, `app/src/boot/loadLanguages.ts`, `scripts/check-lang-keys.py`, `AGENTS.md`; https://github.com/siyuan-note/siyuan/issues/10209.
- Element: https://github.com/element-hq/element-web (`docs/config.md`, `docs/translating.md`, `apps/web/src/i18n/custom.ts`, `apps/web/I18nWebpackPlugin.ts`, `apps/desktop/src/language-helper.ts`); PR https://github.com/matrix-org/matrix-react-sdk/pull/7886; issues #28533, #30164, #32123, #32660 (element-hq/element-web). Прочитано по коммиту `cd558745a74b3fca9f01a12fefd9f4de3ca2629a`.
- Joplin: `https://raw.githubusercontent.com/laurent22/joplin/dev/readme/dev/localisation.md`, `packages/lib/locale.ts`, `packages/tools/build-translation.ts`; форум: https://discourse.joplinapp.org/t/testing-translation-file-localisation/44854, https://discourse.joplinapp.org/t/how-are-language-files-built/42960/1.
- Logseq: `https://raw.githubusercontent.com/logseq/logseq/master/docs/contributing-to-translations.md`, `docs/dev-practices.md`, `src/main/frontend/dicts.cljc`, `scripts/src/logseq/tasks/lang.clj`.
- AFFiNE: `https://raw.githubusercontent.com/toeverything/AFFiNE/canary/packages/frontend/i18n/src/resources/index.ts`, `…/i18next.ts`. Notesnook: `https://raw.githubusercontent.com/streetwriters/notesnook/master/packages/intl/lingui.config.js`; issue https://github.com/streetwriters/notesnook/issues/6653. MarkText: `https://raw.githubusercontent.com/marktext/marktext/develop/packages/desktop/src/common/i18n.ts`, `…/renderer/src/i18n/index.ts`.
- Signal Desktop (коммит `832279c26138f2ea47c6bb7d6b9f7e0f80eb9e96`): `app/locale.node.ts`, `_locales/en/messages.json`, `CONTRIBUTING.md`; issues https://github.com/signalapp/Signal-Desktop/issues/5194, #4957. Mattermost: https://github.com/mattermost/desktop (`i18n/i18n.ts`), https://github.com/mattermost/mattermost (`webapp/channels/src/i18n/i18n.ts`, `plugins/registry.ts`); https://developers.mattermost.com/integrate/customization/customization/server-files/; https://handbook.mattermost.com/contributors/ways-to-contribute/localization. Bitwarden: https://github.com/bitwarden/clients (`I18nMainService.readLanguageFile` в `apps/desktop`, `apps/desktop/crowdin.yml`). Jitsi: https://github.com/jitsi/jitsi-meet (`react/features/base/i18n/i18next.ts`).
- Chrome: https://developer.chrome.com/docs/extensions/reference/api/i18n; https://developer.chrome.com/docs/extensions/how-to/ui/localization-message-formats.
- Electron: https://github.com/electron/electron/blob/main/docs/api/app.md; `docs/api/command-line-switches.md`; `docs/tutorial/spellchecker.md`; electron-builder `PlatformSpecificBuildOptions.ts` (`electronLanguages`); https://github.com/electron/electron/issues/52307.
- vue-i18n: https://vue-i18n.intlify.dev/api/composition; https://vue-i18n.intlify.dev/guide/advanced/lazy; https://vue-i18n.intlify.dev/guide/advanced/optimization; https://vue-i18n.intlify.dev/guide/essentials/syntax; advisories https://github.com/intlify/vue-i18n/security/advisories/GHSA-9r9m-ffp6-9x4v, https://github.com/intlify/vue-i18n/security/advisories/GHSA-hjwq-mjwj-4x6c, https://github.com/intlify/vue-i18n/security/advisories/GHSA-p2ph-7g93-hw3m, https://github.com/advisories/GHSA-x8qp-wqqm-57ph.

## 10. Не проверено

- Obsidian: формат файла внутри `obsidian.asar` после перехода на `.txt`; поведение приложения при пустом `translation=` и пропущенном ключе; нужен ли перезапуск при смене языка; присутствие `i18n+` и Trans-Hub в официальном каталоге; первичные тексты Discord-переписки и PR `obsidian-releases#3175`.
- VS Code: наличие `hu`-пакета (в таблице docs есть, в `vscode-loc/i18n` каталога нет); поведение «Available» в `Configure Display Language` для Open VSX; реальные случаи перекрытия `package.nls` чужих расширений языковым пакетом.
- Zettlr: что импорт `.po` через меню не работает — по коду, не в рантайме. SiYuan: живая или перезапускаемая смена языка; причина поломки в issue #10209.
- Форматы дат и чисел, RTL: у большинства приложений в просмотренных файлах не найдено.
- Динамическая CSP с `vue-i18n` в браузере не прогонялась; проверен только `grep` по `dist` на `eval(`/`new Function`.
- Rocket.Chat Desktop, процесс переводчиков Jitsi (`doc/translation.md` → 404).
