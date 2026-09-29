# Mochi (mochi.cards) — отчёт

Легенда: **[ДОК]** — явно в документации; **[ВЫВОД]** — наш вывод/инференс (продукт закрытый); `[НЕ ПОДТВЕРЖДЕНО]` — проверить не удалось.
Не читались отдельно: страницы docs по Views, Conditional Rendering, Glossary, Cramming, Archiving, Importing/Exporting (только Export format reference), Terms, блог. Утверждения «в документации нет X» относятся только к прочитанным страницам.

## 1. Что это

Mochi — «spaced repetition flashcards made easy»: приложение для заметок и флеш-карточек на базе Markdown, с повторением по интервальному расписанию ([главная](https://mochi.cards/), [What is Mochi?](https://mochi.cards/docs/getting-started/what-is-mochi/)). Клиенты: Mac, Windows, Linux, iOS, Android, веб (app.mochi.cards) ([главная](https://mochi.cards/)). Компания: «© 2026 Mochi Cards, LLC» (там же). Лицензия: **закрытый исходный код [ВЫВОД]** — в прочитанных источниках лицензия ядра не указана; открыты только сторонние интеграции и переводы в организации `mochi-cards` на GitHub ([mochi-cards/open-source](https://github.com/mochi-cards/open-source): README-список ссылок, 120 звёзд, 5 форков; [mochi-translations](https://github.com/mochi-cards/mochi-translations) упомянут в [changelog](https://mochi.cards/changelog/)). Имена мейнтейнеров на прочитанных страницах не указаны `[НЕ ПОДТВЕРЖДЕНО]` (страницу /about не читал). Активность: changelog показывает версию 26.9.2 от 21 сентября 2026; заголовок страницы: «Check back for weekly updates» ([changelog](https://mochi.cards/changelog/)). Историческая запись в changelog: «Migrated to a different data storage strategy that will facilitate managed synchronization across several devices including browsers» (в самом конце changelog, дата не считывалась).

## 2. Архитектура и стек

- **Модель: offline-first + облачная синхронизация.** [ДОК] «Mochi is an *offline first* application... every piece of content that gets added or changed is saved locally to your device first, before it is synced to the cloud» ([Backups](https://mochi.cards/docs/getting-started/backing-up/)). Главная: «Local first — Your data is stored safely on your device and syncs seamlessly when you're online».
- **Локальное хранилище — «user directory»** [ДОК]: Windows `%APPDATA%\Mochi`, macOS `~/Library/Application Support/Mochi`, Linux `$XDG_CONFIG_HOME/mochi` или `~/.config/mochi`. Содержит контент (decks/cards/templates), историю ревью, вложения, настройки, состояние логина (не пароль). Восстановление — замена папки при закрытом Mochi ([Backups](https://mochi.cards/docs/getting-started/backing-up/)). Формат БД внутри папки в документации не описан `[НЕ ПОДТВЕРЖДЕНО]`.
- **Стек:** desktop-релизы `.dmg/.exe/.AppImage` (главная); формат обмена — EDN/Transit, API принимает `transit+json` ([API](https://mochi.cards/docs/api/)) — [ВЫВОД]: бэкенд, вероятно, на Clojure/ClojureScript (Cognitect Transit, EDN, keyword-параметры типа `deck-id`, `archived?`); `bookmark` в пагинации похож на CouchDB-курсор (`"g1AAAA..."`) — это лишь догадка. Desktop-оболочка Electron не подтверждена документацией `[НЕ ПОДТВЕРЖДЕНО]`.
- **Облако:** app.mochi.cards; Pro-тариф даёт 10 GB cloud storage для синхронизируемых карточек/заметок/вложений ([Pricing](https://mochi.cards/pricing/)).
- **Данные в облаке не шифруются** [ДОК]: «If you are using a Mochi account, do not store any sensitive information in Mochi. The data is not encrypted in the database.» Хранятся email, полное имя, hash пароля, заметки/колоды/карточки, платёжный токен Stripe ([Privacy](https://mochi.cards/privacy)). Без аккаунта «Mochi does not store any of your data on its servers». Значит, **end-to-end шифрования нет** (по политике конфиденциальности) — это документированный факт, не вывод.

## 3. Модель знаний и зависимостей

**Иерархия [ДОК]:** Deck ⊃ Card. «Every card must be placed inside a deck.» Deck может содержать subdecks; дерево произвольной глубины (пример Biology → Chapter → Unit) ([Intro to Decks](https://mochi.cards/docs/decks/intro/)). Subdecks наследуют некоторые свойства (review settings) от родителя, если не переопределены. В формате экспорта: `:parent-id` у Deck ([Export format reference](https://mochi.cards/docs/import-and-export/mochi-format-reference/)). Тэги: inline `#biology` или как метаданные `manual-tags`; вложенные через `/` (`philosophy/aristotle` в примере API).

**Карточка = Markdown-документ [ДОК]** ([Overview of Cards](https://mochi.cards/docs/cards/)):
```
What is photosynthesis?
---
The process plants use to convert sunlight into chemical energy.
```
`---` делит карточку на стороны (не только две). Название карточки: primary field шаблона либо первая строка контента.

**Cloze [ДОК]** ([Advanced formatting](https://mochi.cards/docs/markdown/advanced-formatting/)):
`The {{1::Shiba Inu}} is a breed of {{2::hunting dog}} from {{2::Japan}}.` — группы по индексу; у каждой группы **своё расписание и история**. Опция «Type hidden text» — ввод ответа вручную. Diagram cards (image occlusion) — маски на изображении, у каждой маски свой review history ([Hidden Text and Diagrams](https://mochi.cards/docs/reviewing/cloze-deletions/)). Также: `<input value="Paris" inline>` (проверка набранного; `|` — варианты, `&` — все обязательны), `<draw>`, `<furigana>`, `<pinyin>`, KaTeX (`$...$`, `$$...$$`, глобальные макросы), произвольный HTML, ruby `{持}(も)ち`.

**Ссылки/референсы [ДОК]:** MediaWiki-стиль `[[card-id]]`, `[[Title|card-id]]`, `[[Card name]]`; embed `![[card-id]]`, `![[card-id/1]]` (сторона), `![[card-id/field-id]]`, `![[self/path]]` (путь колоды). Автоматические **backlinks** («bidirectional connection»). API-карточка содержит массив `references` ([API](https://mochi.cards/docs/api/)).

**Шаблоны [ДОК]** ([Intro to Templates](https://mochi.cards/docs/templates/intro-to-templates/), [Dynamic Fields](https://mochi.cards/docs/templates/dynamic-fields/)): template = fields + Markdown + placeholders `<<word>>`; Mustache-подобные секции `<<#field>>...<</field>>`, инверсия `<<^field>>`. Типы базовых полей: text, checkbox, number; в формате экспорта также `:speech, :image, :translate, :dictionary`. Обязательное primary-поле с id `:name`. Пример из docs:
```
## <<word>>
**Meaning:** <<meaning>>
<<#example_sentence>>
**Example:** <<example_sentence>>
<</example_sentence>>
```
Dynamic fields (Pro): TTS, image search, translation, dictionary, transcription, AI text generator (create flashcard / question / example sentence / reword / LaTeX / custom prompt), Pinyin, Furigana; поле может брать вход из других полей, цепочки допустимы. Ручное переопределение сгенерированного значения — через условный рендеринг и «override»-поле.

**Зависимости/пререквизиты: концепции нет [ВЫВОД по прочитанным страницам].** Ни в docs по картам/колодам/ревью, ни в формате экспорта, ни в API (поля карточки: `id, content, name, deck-id, template-id, pos, tags, references, reviews, archived?, new?, review-reverse?, created-at, updated-at`) нет поля prerequisite/requires/depends-on. Ближайшие аналоги: (а) `[[ссылки]]` и backlinks — **ненаправленные по семантике обучения** и не влияют на расписание [ВЫВОД]; (б) порядок `pos` (лексикографическая строка, вставка между «6» и «7» → «6V») и сортировка колоды — влияет на порядок показа новых карточек, но не блокирует; (в) иерархия колод — организационная. Автоматической «разблокировки» тем нет; порядок изучения задаёт пользователь (лимит новых карточек в день).

**Пример `.mochi` (EDN) из docs** (в оригинале пример синтаксически повреждён — лишние скобки):
```clj
{:version 2
 :decks [{:name "Sample deck" :cards [{:content "Sample card"}]}]}
```

## 4. Алгоритм обучения/повторения

**Алгоритм по умолчанию [ДОК]:** собственный, закрытый. Описание: «adjusts each card's interval up or down by fixed multipliers every time you remember or forget it. It's simple and predictable» ([FSRS](https://mochi.cards/docs/reviewing/fsrs/)). Численные множители в прочитанных страницах **не опубликованы** `[НЕ ПОДТВЕРЖДЕНО]`. Опубликованные детали ([Intro to SR](https://mochi.cards/docs/reviewing/)):
- Оценка **бинарная**: Remembered / Forgot (нет 4-кнопочной шкалы Anki). Remembered → интервал (дни) растёт, Forgot → уменьшается.
- Двухфазный процесс: **Learn phase** (кнопки «Add to reviews» и «Again» — [New cards](https://mochi.cards/docs/reviewing/new-cards/)) → **Review phase**.
- **Re-review queue**: забыл один раз → карточка в re-review; забыл повторно → интервал сбрасывается (changelog: «drop the interval back down to 1 day»); вспомнил → короткий интервал сохраняется.
- Changelog: вспоминание просроченной карточки учитывает задержку (fix: «remembering a past due card would use the original interval... instead of factoring in the additional delay»).
- Настройки: лимит новых в день (автор советует ≤10/день), max interval и «retire» карточки при достижении max interval, deck-/note-specific SRS-настройки (все — changelog).
- Режимы: Inbox (Due today + New + Re-reviews), Cramming, Review reverse (отдельная история для обратного направления).

**FSRS [ДОК]:** опциональный переключатель (Settings → Review Settings → Scheduling algorithm). Отслеживает Stability и Difficulty на карточку; целевая retention настраивается («Target retention rate»); пользовательские параметры (weights) вводятся в поле Parameters; встроенного оптимизатора **нет** — рекомендуется выгрузить `.mochi` или `GET /api/cards` и оптимизировать внешним инструментом. Переключение мгновенно переносит все Learned карточки: state выводится из истории ревью (нет сброса). Бинарные оценки маппятся на Good/Again. Changelog: FSRS — beta с версии 1.19.0 (дата в прочитанном фрагменте не считана), фиксы: регрессия в 1.20.5, max interval не соблюдался с FSRS (1.21.17). Версия FSRS (v4/v5/v6) и дефолтные веса не указаны `[НЕ ПОДТВЕРЖДЕНО]`.

**Адаптивность на уровне графа знаний (FIRe/encompassing): отсутствует [ВЫВОД]** — расписание считается по карточке (и по группе cloze / стороне reverse / маске diagram) независимо; связей между карточками в расчёте нет.

## 5. Верификация мастерства

- Основа — **самооценка** Remembered/Forgot ([Intro to SR](https://mochi.cards/docs/reviewing/)).
- Автопроверка ввода: `<input value="...">` (сравнение с эталоном, варианты `a|b`, все обязательны `a&b`, `type="text|number"`) и «Type hidden text» для cloze ([Advanced formatting](https://mochi.cards/docs/markdown/advanced-formatting/)). Это string-match; **выполнения кода/CAS/SQL нет** — в прочитанных страницах не упомянуто.
- LLM: только для генерации контента (dynamic AI fields); использование как судьи ответов не документировано.
- `<draw>` — холст для рисования; проверки нет (в docs не описана) [ВЫВОД].

## 6. Синхронизация, офлайн, приватность, экспорт/импорт

- **Sync — только Pro** ([Pricing](https://mochi.cards/pricing/)); Free: «Unlimited offline usage», unlimited cards/decks, import/export. Downgrade: данные остаются локально и работают офлайн, sync прекращается в конце оплаченного периода (FAQ там же).
- **Механика синка — не документирована** `[НЕ ПОДТВЕРЖДЕНО]`. Косвенно из changelog: «Improved cloud syncing conflict resolution», «live syncing multiple clients», ручной restart sync, «full sync after version update», отдельная синхронизация вложений, «All devices will need to be updated to v1.19.0 for FSRS» (то есть версии клиентов связаны с форматом синхронизируемых данных) [ВЫВОД: централизованная сервер-авторитетная синхронизация с разрешением конфликтов на стороне продукта; алгоритм неизвестен (не CRDT/Git — не подтверждено)].
- **Сервер видит данные в открытом виде** (нет E2E) — [Privacy](https://mochi.cards/privacy).
- **Бэкап:** копирование user directory или экспорт `.mochi` ([Backups](https://mochi.cards/docs/getting-started/backing-up/)).
- **Формат `.mochi` [ДОК]** ([Format reference](https://mochi.cards/docs/import-and-export/mochi-format-reference/), [Sharing](https://mochi.cards/docs/decks/sharing/)): ZIP с `data.edn` **или** `data.json` (Transit-семантика; рекомендуется для больших наборов) + медиа-файлы. Top-level: `:version 2`, `:decks`, `:cards` (требуют `:deck-id`), `:templates`. Deck: `:name`, `:id` (0-9A-Za-z, ≥8 символов), `:cards`, `:parent-id`. Card: `:content`, `:deck-id`, `:id`, `:name`, `:pos`, `:reviews`, `:fields`. **Review: `:date`, `:due`, `:interval`, `:remembered?`, `:duration` (опционально; старые записи не бэкфиллены).** Template/Field описаны там же. Sharing-страница говорит «ZIP with a JSON data file» (расхождение с EDN-вариантом; оба формата допустимы по reference). Есть workflow «переименуй в .zip → отредактируй → перепакуй».
- Экспорт Markdown и CSV **не сохраняют историю ревью**; только `.mochi` сохраняет ([FSRS](https://mochi.cards/docs/reviewing/fsrs/)). Импорт: `.mochi`, CSV (с вложениями), Markdown/.txt, Anki (changelog); детальные страницы импорта не читались.
- Публикация колоды (Pro) — публичная read-only ссылка на серверах Mochi; клон создаёт независимую колоду ([Sharing](https://mochi.cards/docs/decks/sharing/)); docs сами называют publish «менее durable», чем export.
- Deep links `mochi://` (changelog 26.9.2).

## 7. Авторинг контента

- Ввод: Markdown-редактор, горячие клавиши (`cmd+enter` сохранить), paste/drag-and-drop медиа (`![alt|800x600](file.jpg)`; аудио/видео тем же синтаксисом; вложения удаляются вместе с карточкой) ([Advanced formatting](https://mochi.cards/docs/markdown/advanced-formatting/)); web clipper (ссылка в футере, детали не читались).
- Шаблоны + dynamic fields сокращают трение для словарных карточек (достаточно ввести `word`).
- AI: dynamic-поле «Create flashcard» и др.; лимит Free 5 000 токенов/мес, Pro 500 000 ([Pricing](https://mochi.cards/pricing/)).
- Заметки и карточки в одном месте: карточку можно архивировать и использовать как заметку ([Overview of Cards](https://mochi.cards/docs/cards/)).
- **Нет файлового авторинга «Markdown в Git»**: основная копия — внутренняя БД; вне приложения править можно лишь через `.mochi`-ZIP или API [ВЫВОД].
- Экосистема ([open-source list](https://github.com/mochi-cards/open-source)): obsidian-mochi-cards-pro, logseq-mochi-sync (односторонний Logseq→Mochi), mochi-api-client (Python), mochi2anki, mkflashcards (AI), mochi-claude-code-gen, два неофициальных MCP-сервера (mcp-mochi, mochi-mcp), mochi-heatmap, mochi-viz, темы/шаблоны. Официальной системы плагинов в прочитанном нет `[НЕ ПОДТВЕРЖДЕНО]`; кастомизация — CSS-темы/шаблоны сообщества.

## 8. API и автоматизация ([API](https://mochi.cards/docs/api/))

- REST, base `https://app.mochi.cards/api/`, JSON или `transit+json`; Basic Auth, API key = username, пароль пуст; ключи в Account Settings. **API keys — Pro-only** ([Pricing](https://mochi.cards/pricing/)).
- Ресурсы: `cards` (list/create/retrieve/update/delete; вложения POST multipart `.../cards/:id/attachments/:file`, DELETE), `decks` (CRUD; `card-count` добавлен в 26.9.2), `templates` (list/create/retrieve — без update/delete в списке endpoint'ов), `due` (`GET /due`, `/due/:deck-id`, параметр `date`; добавлен в 1.20.5).
- Пагинация: `docs` + `bookmark`; карточки по 10 на страницу. Карточка возвращает `reviews[]` — можно вытащить историю для внешнего FSRS-оптимизатора.
- **Лимит: 1 одновременный запрос на аккаунт** (429 иначе); changelog: BREAKING — заменил прежние «20 requests per 10 second» (медленно для массовой загрузки [ВЫВОД]).
- Нет endpoint'а для отправки ревью (записи оценки) в перечне; только чтение `reviews` [ВЫВОД по списку endpoints; строки 1–1415 из 1494 прочитаны].
- Качество docs: в разделе decks base URL `http://localhost:8090`, в Delete deck остался «TODO» — документация местами сырая.

## 9. Монетизация / рынок / аудитория ([Pricing](https://mochi.cards/pricing/))

- Free $0: офлайн без лимитов, unlimited cards/decks, import/export, шаблоны. Регистрация не нужна.
- Pro $5/мес (в таблице «billed annually»; «Yearly billing saves you $12 a year»): sync, 10 GB cloud, publish decks, API keys, dynamic fields, email support; квоты в месяц: AI 500 000 токенов (Free 5 000), dictionary 1 000 (Free 20), translation 100 000 симв. (1 000), transcription 20 000 сек (500), TTS 200 000 симв. (200), image search 1 000 (20). Лимиты сбрасываются 1-го числа, не переносятся.
- Аудитория (главная, отзывы): изучающие языки (словари, TTS, furigana/pinyin, корейский словарь), студенты, PKM-пользователи («Zettelkasten manager»), переходящие с Anki. Число пользователей не опубликовано.

## 10. Сильные и слабые стороны

**Сильные:**
- Простая ментальная модель: карточка = Markdown; `---` = стороны; `{{cloze}}`; wiki-ссылки — низкий порог входа.
- Offline-first: Free-версия полностью автономна; данные не заперты (`.mochi` ZIP + EDN/JSON со спецификацией, полная история ревью).
- Опциональный FSRS с миграцией из истории без сброса; Stability/Difficulty/retention настраиваются.
- Шаблоны с полями и dynamic fields (TTS/AI/dictionary) — генерация контента без программирования.
- Cloze-группы и diagram-маски получают независимые расписания (гранулярность повторения).
- Открытый REST API + экосистема (Obsidian, Logseq, MCP-серверы).

**Слабые:**
- Закрытый код; синхронизация недокументирована, данные в облаке незашифрованы ([Privacy](https://mochi.cards/privacy)); sync/API только за подписку.
- Бинарная оценка; алгоритм по умолчанию непрозрачен (множители не опубликованы).
- Нет пререквизитов/направленного графа: `[[ссылки]]` не влияют на расписание; нет адаптивной разблокировки тем; нет FIRe/encompassing.
- Верификация — самооценка и string-match; нет исполняемых проверок.
- API: 1 concurrent request; нет (по списку endpoints) записи ревью; Free — без API.
- Нет Git-дружественного текстового формата: источник истины — внутренняя БД; экспорт в Markdown/CSV теряет историю ревью.
- Формат экспорта: наблюдаемые расхождения в docs (JSON vs EDN, битый пример).

## 11. Что заимствовать / чего избегать

1. **Заимствовать:** карточка как Markdown + `---` для сторон + `{{1::cloze}}` — минимальный синтаксис, который парсится детерминированно и хорошо диффится в Git.
2. **Заимствовать:** независимое расписание для каждой «единицы проверки» (cloze-группа, обратное направление, маска) — у нас единица = (card-id, variant-id) в learner state SQLite.
3. **Заимствовать:** формат обмена как ZIP с версионированным `data.*` (`:version 2`) + явная схема Review `{date, due, interval, remembered?, duration}`; для нас — вести полный лог ревью (append-only), чтобы можно было пересчитать FSRS и оптимизировать веса (у Mochi это возможно только через экспорт/API).
4. **Заимствовать:** FSRS с миграцией «state выводится из лога ревью, а не хранится как источник истины» — делает смену алгоритма безболезненной и упрощает синхронизацию (сливаются логи, не состояния).
5. **Заимствовать:** шаблоны с полями + placeholders, а также сборку карточек из структурированных данных (`fields`) — для наших курсов это генерация карточек из YAML/JSON-frontmatter топика.
6. **Заимствовать:** wiki-ссылки `[[id]]` и embed `![[id/field]]`, но добавить **типизированные направленные рёбра** (`requires`, `encompasses`) — то, чего у Mochi нет и что является нашим отличием.
7. **Заимствовать:** primary-field/имя карточки и стабильные короткие ID (0-9A-Za-z ≥8 симв.) — устойчивы к переименованию; `pos` как дробный лексикографический ключ (вставка между соседями без перенумерации) хорошо работает в Git-контенте.
8. **Избегать:** закрытой синхронизации и облака без шифрования; для нас — sync вне Git (журнал событий/CRDT-подобное слияние логов ревью) с опциональным E2E.
9. **Избегать:** только бинарной самооценки как единственной верификации; добавить детерминированные проверки (тесты/CAS/SQL) — `<input value=... >` у Mochi показывает востребованность авто-проверки, но она ограничена string-match.
10. **Избегать:** внутренней БД как единственного источника контента (экспорт теряет историю; правка вне приложения — через ZIP); контент — файлы в Git, состояние — SQLite; API/rate-limit «1 concurrent request» — не повторять для локального API.

## 12. Источники (реально прочитаны)

- https://mochi.cards/
- https://mochi.cards/pricing/
- https://mochi.cards/changelog/ (первые 300 строк + grep по всему)
- https://mochi.cards/privacy
- https://mochi.cards/docs/
- https://mochi.cards/docs/api/ (строки 1–300 полностью, остальное — grep по заголовкам/endpoint'ам)
- https://mochi.cards/docs/getting-started/what-is-mochi/
- https://mochi.cards/docs/getting-started/backing-up/
- https://mochi.cards/docs/cards/
- https://mochi.cards/docs/decks/intro/
- https://mochi.cards/docs/decks/sharing/
- https://mochi.cards/docs/templates/intro-to-templates/
- https://mochi.cards/docs/templates/dynamic-fields/
- https://mochi.cards/docs/markdown/advanced-formatting/
- https://mochi.cards/docs/reviewing/
- https://mochi.cards/docs/reviewing/new-cards/
- https://mochi.cards/docs/reviewing/fsrs/
- https://mochi.cards/docs/reviewing/cloze-deletions/
- https://mochi.cards/docs/import-and-export/mochi-format-reference/
- https://github.com/mochi-cards/open-source
