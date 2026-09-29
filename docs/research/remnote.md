# RemNote — отчёт-исследование

> Метод: прочитаны страницы help.remnote.com (в формате `.md`), remnote.com/pricing, docs плагинов, сторонний manual плагина Incremental RemNote. Всё, что не найдено в источниках, помечено `[НЕ ПОДТВЕРЖДЕНО]`. Часть help-статей помечена «Updated … ago» с датами 2026 — данные актуальны на момент чтения.

## 1. Что это

RemNote — проприетарное (лицензия приложения явно не найдена → `[НЕ ПОДТВЕРЖДЕНО]`) облачное приложение «notes + flashcards + spaced repetition» на основе иерархического outliner'а. Позиционируется как «All-in-One Tool for Thinking and Learning» ([help.remnote.com](https://help.remnote.com/)); в 2026 маркетинг сместился в сторону AI: «Study Faster with AI Flashcards, Quizzes & Summaries» ([remnote.com](https://www.remnote.com/)). Клиенты: web, desktop (Windows/Mac/Linux), iOS/Android ([offline-mode](https://help.remnote.com/en/articles/6752029-offline-mode.md)). Монетизация — подписка ([privacy-of-your-notes](https://help.remnote.com/en/articles/7974260-privacy-of-your-notes.md): «we earn money through subscription fees»). Автор большинства help-статей — Soren Bjornstad (указан в выдаче поиска). Из сторонней базы: основана в 2019, стадия Seed, ~19 сотрудников, США ([Tracxn](https://platform.tracxn.com/a/d/company/58c134c6e4b057a3f2e32ad4/remnote), сторонний агрегатор, точность не проверена). Plugin template — MIT ([GitHub](https://github.com/remnoteio/remnote-plugin-template-react)); сам SDK-репозиторий по предполагаемому URL вернул 404 → лицензия SDK `[НЕ ПОДТВЕРЖДЕНО]`. Активность: help-статьи обновлялись в июле–сентябре 2026 (например, FSRS v6, «Managing New Cards», AI credits).

## 2. Архитектура и стек

- **Модель данных**: «всё — bullet (Rem)»: документы, папки, теги, шаблоны, powerup'ы, свойства, PDF/файлы, строки и ячейки таблиц — тоже bullet'ы. Единственное исключение — flashcards: они не bullet'ы, а производные от bullet'а и пересоздаются при его правке/удалении ([bullets](https://help.remnote.com/en/articles/8017859-bullets.md)). В UI термин Rem заменён на «bullet»; в plugin-API остаётся Rem.
- **Два типа Knowledge Base (KB)**: *synced* (доступна на всех устройствах, синхронизируется через серверы RemNote) и *local* (только desktop, целиком на диске, никогда не проходит через серверы) ([multiple-knowledge-bases](https://help.remnote.com/en/articles/7867942-multiple-knowledge-bases.md)).
- **Хранилище на desktop**: в папке KB лежат `remnote.db`, `remnote.db-shm`, иногда `remnote.db-wal`, папка `backups/` (`.db.zip`), папка `files/` (все когда-либо загруженные картинки/PDF/аудио) ([backups](https://help.remnote.com/en/articles/6301627-remnote-backups.md)). Суффиксы `-shm/-wal` характерны для SQLite WAL — это `[ИНФЕРЕНЦИЯ]`, формат БД в документации прямо не назван.
- **Облако**: данные synced KB — MongoDB Atlas поверх AWS, шифрование at rest и TLS in transit; E2EE нет ([privacy](https://help.remnote.com/en/articles/7974260-privacy-of-your-notes.md)).
- **Расширяемость**: plugin SDK (Docusaurus-сайт, React-first), sandboxed (IFrame) и native (main thread JS) плагины, widgets, CSS-темы, «Extensive API» с hooks; scopes на уровне Rem/Document/Powerup ([docs.remnote.com](https://plugins.remnote.com/)). Шаблон: TypeScript/React, webpack, Tailwind ([template repo](https://github.com/remnoteio/remnote-plugin-template-react)).
- **AI-провайдеры** (список может меняться без уведомления): OpenAI, Groq, Replicate, Anthropic, Google Gemini, Cerebras, DeepInfra, OpenRouter ([privacy](https://help.remnote.com/en/articles/7974260-privacy-of-your-notes.md)).
- Third-party: CloudConvert (конвертация не-PDF в PDF), DuckDuckGo favicon service, Wikimedia Commons (Lab-фича).

## 3. Модель знаний и зависимостей

**Формальных prerequisites в RemNote нет.** Ни в help-статьях про bullets/references/tags/portals/documents, ни в документации схедулера не найдено сущности «depends on / prerequisite» и не найдено использования графа зависимостей для гейтинга карточек. Есть Knowledge Graph — визуализация «всех bullets» и связей ([Knowledge Graph](https://help.remnote.com/en/articles/8771354-knowledge-graph) — прочитан только сниппет выдачи) — но это визуализация, а не DAG-ограничение.

Единственное косвенное упоминание: в статье про Concept/Descriptor Framework сказано, что «RemNote can also fine-tune the sequence in which cards are presented for review based on the structure of references between those concepts» ([CDF](https://help.remnote.com/en/articles/6026154-structuring-knowledge-with-the-concept-descriptor-framework.md)). Детали алгоритма не опубликованы → `[НЕ ПОДТВЕРЖДЕНО]`, как это реально работает.

Как связаны сущности:

| Механизм | Что означает | Связь с prerequisites |
|---|---|---|
| **Parent/child (иерархия)** | Каждый bullet имеет ≤1 parent и любое число children; ancestor/descendant/sibling ([outlines](https://help.remnote.com/en/articles/8196578-outlines-and-terminology.md)). Это **дерево**, не DAG. | Только «часть-целое / контекст». Предки показываются как контекст на карточке (`Cell > Mitochondria > вопрос`) ([creating-flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards.md)). Порядок детей — визуальный, гейтинга нет. |
| **Reference** (`[[`, `++`, `@`) | Ссылка на bullet; при переименовании обновляется; автоматически создаёт **backlink** ([references](https://help.remnote.com/en/articles/6030714-references.md)). | Ненаправленная ассоциативная связь («relates to»). Backlinks двусторонние → нельзя выразить «A требует B». |
| **Tag** (`##`) | «What kind of thing a bullet is» (is-a): Cat → Animal; тег — обычный bullet ([tags](https://help.remnote.com/en/articles/6030770-tags.md)). Тег + properties + templates + advanced tables. Практика по тегу включает карточки помеченных bullet'ов и их потомков. | Таксономия/группировка, не зависимость. Карточка, лишь *упомянутая* references, в очередь тега не попадает ([practicing](https://help.remnote.com/en/articles/6904503-practicing-specific-flashcards.md)). |
| **Portal** | «Окно» в другой bullet: единый источник, отображаемый в нескольких местах; правка внутри портала меняет оригинал ([portals](https://help.remnote.com/en/articles/6030742-portals.md)). Портал наследует priority документа-контейнера; в очередь идут только видимые (не свёрнутые) bullets. | Механизм переиспользования; позволяет «один concept — много документов», но не порядок изучения. |
| **Document / Folder / Top-level bullet** | Document — точка зума; Folder — только организация, содержит только folders и documents; top-level — bullet без parent ([doc vs folder](https://help.remnote.com/en/articles/8032170-what-s-the-difference-between-a-document-a-folder-and-a-top-level-bullet.md)). | Единица приоритета, планировщика, экзамена. |
| **Sources** (Link Documents) | Документ-агрегатор: «all flashcards from its sources will be included in the queue» ([practicing](https://help.remnote.com/en/articles/6904503-practicing-specific-flashcards.md)). | Ближайшая к «курсу как набору модулей» сущность, но без порядка. |

**Concept/Descriptor Framework (CDF)** — главная методика: Concepts (существительные, **bold**, с заглавной) образуют иерархию; Descriptors (свойства, *italic*, со строчной) описывают concept; связи между concepts — References/Tags ([CDF](https://help.remnote.com/en/articles/6026154-structuring-knowledge-with-the-concept-descriptor-framework.md)). Из структуры карточки генерируются автоматически.

**Синтаксис (плоский текст, пригоден для импорта/вставки)** ([creating-flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards.md), [import from text](https://help.remnote.com/en/articles/9252072-how-to-import-flashcards-from-text.md)):

```
Вопрос >> Ответ            # basic forward (== тоже); << reverse; <> both; >- disabled
Mitochondria :: органелла   # concept, двусторонняя; :> forward; :< reverse; :- disabled
происхождение ;; эндосимбиоз # descriptor, forward; ;< reverse
{{скрытый фрагмент}}{({подсказка})} # cloze с hint
Вопрос >>>                  # multi-line (дети = элементы ответа); <<< reverse
Вопрос >>1.                 # list-answer; дети нумеруются
Вопрос >>A)                 # multiple choice; первый вложенный = правильный (порядок при показе перемешивается)
#[[Extra Card Detail]]      # powerup: доп. пояснение к обратной стороне
```

Отметка: в help-статье про создание descriptor bidirectional указан как `;<>`, а в таблице импорта — `;;<` (расхождение внутри документации; какой корректен — `[НЕ ПОДТВЕРЖДЕНО]`). Вложенность при импорте текста определяется одинаковыми пробельными отступами; префикс `-` конвертируется в bullet.

## 4. Алгоритм обучения/повторения

**Схедулеры** ([custom-schedulers](https://help.remnote.com/en/articles/6958056-custom-schedulers.md)):
- `Exponential` — устаревший проприетарный, не настраивается; не рекомендуется.
- `Anki SM-2` — **по умолчанию** (Global Default Scheduler) ([SM-2](https://help.remnote.com/en/articles/6026144-the-anki-sm-2-spaced-repetition-algorithm.md)).
- `FSRS v6` — по Jarrett Ye; встроен (ранее был плагином); в статье помечен как **beta**, может стать default; заявлено «20–30% fewer reviews» при том же retention (заявление вендора, независимо не проверено) ([FSRS](https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm.md)).
- Плагины могут добавлять свои алгоритмы; можно писать собственные.

**Назначение схедулера иерархически**: для карточки проверяется bullet-источник, затем его parent, и так вверх до top-level; иначе Global Default. Схедулеры назначаются документам/папкам через `Settings > Schedulers` или `/`-меню ([custom-schedulers](https://help.remnote.com/en/articles/6958056-custom-schedulers.md)).

**SM-2 в RemNote (формулы из статьи)**:
- Кнопки: Forgot / Partially recalled / Recalled with effort / Easily recalled.
- Learning phase: фиксированные шаги (пример `30m,2h,2d`); Forgot → шаг 1; Partially → остаётся на шаге, ждёт половину; Effort → следующий шаг; Easy → сразу в экспоненциальную фазу (*Easy Interval on Exiting Learning*).
- Exponential phase: `ease` стартует 230% (Starting Ease), минимум 130% (ниже — карточка считается «leech-кандидатом»).
  - Forgot: factor = Lapse Interval Multiplier (по умолчанию 0.1), ease −20 п.п., → Relearning.
  - Partially: factor 1.2, ease −15 п.п.
  - Effort: factor = ease, ease без изменений.
  - Easy: factor = ease × Easy Bonus (1.3), ease +15 п.п.
  - Затем × Interval Multiplier (1.0), плюс небольшой случайный шум (anti-clumping).
  - Overdueness bonus: при просрочке к интервалу добавляется доля просрочки — 25% / 50% / 100% для Partially / Effort / Easy по умолчанию.
- Learn Ahead Limit: карточки в learning показываются до 15 минут раньше срока по умолчанию.
- Relearning: шаги, затем возврат в exponential с `last_interval × Lapse Interval Multiplier`.

**FSRS в RemNote**: у карточки *difficulty* и *stability*; главный параметр — желаемая вероятность recall на момент повтора (desired retention); learning/relearning steps (пример `1m,10m`); *New Card Forgot Interval*; 17 весов (`weights`) обучаются оптимизатором по истории («Auto train weights on your knowledge base»); рекомендуется ≥1000 повторов на default-весах до оптимизации ([FSRS](https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm.md)). Формулы FSRS в статье не приведены — ссылка на awesome-fsrs wiki (не читалось → `[НЕ ПОДТВЕРЖДЕНО]` в части формул).

**Priority (5 уровней, применяются к документу)** ([priorities](https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards.md)):
1. `Exam` — показываются раньше всех.
2. `Currently Studying` — сразу как due, перед остальными.
3. `Maintaining` — после Currently Studying.
4. `Paused` — не попадают ни в одну очередь; **таймер due продолжает идти** (для корректной оценки забывания при возобновлении).
5. `No Priority` — в конец глобальной очереди.
Разрешение конфликтов: Exam побеждает всё, кроме Paused; No Priority всегда проигрывает; иначе — ближайший предок с приоритетом; при нескольких размещениях (portal/source) — максимальный (CS > Maintaining > Paused). Это **очередь-приоритезация по группам**, а не по графу зависимостей.

**Отключение карточек**: суффикс `-` (`>>-`), `Ctrl+Alt+F`, `Disable Descendant Cards` powerup (`/ddc`, не действует на карточки в порталах, в отличие от Paused).

**Режимы практики** ([practicing-specific-flashcards](https://help.remnote.com/en/articles/6904503-practicing-specific-flashcards.md)):
- `Practice with Spaced Repetition` — только due.
- `Practice All Flashcards` — все, в случайном порядке; результаты учитываются, но с поправкой на «ранний повтор», чтобы интервал не разбухал.
- `Practice All Flashcards in Order` — в порядке появления в документе, **Pro-only**; при нескольких карточках с одного bullet сначала показываются все «первые» карточки по порядку, затем все «вторые». Помечен как не для регулярного использования (не SRS: нужен reorder).
- `Practice Without Recording Answer Choices` — без влияния на историю.

**Exam scheduler (Pro; первый экзамен бесплатно)** ([exam](https://help.remnote.com/en/articles/9101991-preparing-for-an-exam.md)): дата экзамена на папку/документ; Learning Period (карточка покидает его после двух повторов), Catch Up Period, Final Review Period (каждая карточка ещё раз в последние дни), Ensure Mastery (два правильных подряд), выбор учебных дней, дневная цель (пример максимума 50/день), выбор схедулера для экзамена. Новые карточки (импорт/AI) идут в отдельную очередь *Need to Learn*; при изучении можно выбрать порядок «In Order» — статья прямо говорит, что это подходит, «когда каждая идея зависит от предыдущей» — то есть зависимость выражается **только порядком документа**, вручную.

**Incremental reading**: **нативной поддержки в help-центре не найдено** (в help-выдаче есть только запрос на feedback.remnote.com). Реализуется **сторонним плагином** Incremental RemNote / Incremental Everything (автор bjsi / Hugo Marins): тег `#Incremental`, extracts (`Alt+X`), cloze (`Alt+Z`), приоритеты 0–100, priority inheritance, Priority Shields, Priority Review Documents, свой IncRem scheduler (exponential и beta saturating), Light/Full mode ([manual](https://hugomarins.github.io/incremental-remnote/)). Это ценный референс для очереди с overload-контролем.

**Прочее для очереди**: Daily Learning Goal, streaks (`Settings > Daily Goal`: All Documents либо «Exams + Currently Studying only») ([exam](https://help.remnote.com/en/articles/9101991-preparing-for-an-exam.md)); leech-cards ([статья](https://help.remnote.com/en/articles/7183408-dealing-with-leech-cards), не читалась).

## 5. Верификация мастерства

- Основа — **самооценка** (self-grading по 4 кнопкам). Deterministic-проверки нет.
- Type-in answer mode ([статья](https://help.remnote.com/en/articles/7752298-typing-in-answers), только упоминание в creating-flashcards) — детали сравнения строк `[НЕ ПОДТВЕРЖДЕНО]`.
- **Multiple-choice**: карточка сама предвыбирает `Forgot` или `Recalled with effort` в зависимости от правильности выбора; пользователь может изменить рейтинг ([creating-flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards.md)). То есть единственная автоматическая проверка — сопоставление с меткой correct/incorrect.
- **AI**: «AI Grading & Chat», «AI Tutor Chat», AI Multiple Choice Explanations (в тарифе Pro with AI, см. [pricing](https://www.remnote.com/pricing)). Это LLM-as-judge; детали (промпты/модели) не публикуются.
- Кода/CAS/SQL-исполнения для проверки ответов не найдено (LaTeX-cloze есть в тарифной таблице: «Math (LaTeX) Cloze Flashcards», но это рендер, не CAS-проверка).

## 6. Синхронизация, офлайн, приватность, экспорт/импорт

**Как работает офлайн/sync** ([offline-mode](https://help.remnote.com/en/articles/6752029-offline-mode.md)):
- Явного переключателя offline нет: приложение просто продолжает работать без сети ([forum](https://forum.remnote.io/t/offline-sync-help-is-there-a-way-to-clearly-show-that-documents-are-not-shared/8213), сниппет).
- «Any edits … will automatically be synced up when you reconnect; you can even safely make changes on multiple offline devices at once, and they'll be automatically merged the next time they sync.» Механизм слияния (CRDT/OT/LWW) **не документирован** → `[НЕ ПОДТВЕРЖДЕНО]`. Мобильное приложение рекламирует «Battle-tested syncing engine» ([mobile app](https://help.remnote.com/en/articles/7000505-mobile-app), сниппет).
- Прогресс повторений синхронизируется вместе с заметками («including flashcard review progress»); загрузка может занять «минуту-две».
- **Web**: работает офлайн, только пока вкладка не закрыта/не обновлена; запустить офлайн нельзя. **Desktop/mobile**: после первичной загрузки и логина — офлайн неограниченно. Desktop хранит полную копию картинок и PDF; mobile/web — нет (mobile кэширует последние, по умолчанию `Maximum Cached Images` = 100 в скриншоте настроек).
- Ограничения офлайна: большинство AI-функций недоступны; плагины недоступны; карточки с незакэшированными картинками автоматически откладываются в конец очереди; названия страниц по URL не подтягиваются.
- Переключение KB на новом устройстве требует загрузки содержимого («a few minutes»).
- **Local KB**: только desktop, без синхронизации и без прохождения через серверы; бэкапы — ответственность пользователя. Можно хранить в iCloud-папке, но открыть её на mobile нельзя ([feedback](https://feedback.remnote.com/p/offline-kb-on-mobile), сниппет).
- **Лимиты**: Free — 2 synced KB, Pro — без лимита; local KB без лимита на всех планах ([multiple-KB](https://help.remnote.com/en/articles/7867942-multiple-knowledge-bases.md)). Ссылки/порталы **между KB невозможны**, поиск только внутри KB.
- **Бэкапы**: облачные daily-бэкапы synced KB, хранятся ≥60 дней (`Settings > Backups`); локальные бэкапы desktop (`.db.zip`) с настраиваемой retention (daily/weekly/max GB) ([backups](https://help.remnote.com/en/articles/6301627-remnote-backups.md)).

**Экспорт — ограничения** ([exporting](https://help.remnote.com/en/articles/7898019-exporting-and-printing-notes.md), [backups](https://help.remnote.com/en/articles/6301627-remnote-backups.md)):
- Форматы (по убыванию полноты): **RemNote (Complete)**, OPML, Anki `.apkg` (только карточки), HTML, Markdown, Text; плюс «Without Text of Notes» (только по просьбе поддержки); PDF через Print.
- **RemNote (Complete) не включает картинки/PDF/файлы** (они на серверах; для local→synced есть отдельная процедура), не включает настройки, имя KB, темы и установки/настройки плагинов.
- **Anki-экспорт**: bullets без карточек игнорируются; родительская иерархия добавляется в текст карточки; multiple-choice → правильный ответ выделяется жирным (в Anki такого типа нет).
- **Markdown/Text/HTML** — потеря структурной семантики RemNote (references/tags/portals/scheduler-состояние) — точный перечень потерь `[НЕ ПОДТВЕРЖДЕНО]` (статья лишь ставит их ниже по «fidelity»).
- Полный export — только вручную через `Settings > Export`; **программного/инкрементального экспорта (git-friendly diff) нет**. Формат Complete — проприетарный (`.rem`/`.db`); сторонний конвертер `Remnote2Obsidian` берёт `rem.json` из JSON-экспорта ([PKMigrator](https://github.com/AnweshGangula/PKMigrator/tree/main/Remnote2Obsidian), сниппет); формат «JSON» в текущем UI в списке не упомянут → `[НЕ ПОДТВЕРЖДЕНО]`.
- Из-за merge при импорте: совпавший bullet пропускается, изменённый — добавляется рядом со старым; импорт полного бэкапа в основной KB создаёт «mess» и **необратим** (кроме восстановления другого бэкапа); при копировании/вставке может теряться история повторов.

**Импорт** ([importing](https://help.remnote.com/en/articles/7898005-importing-notes.md)): RemNote, Anki, Notion, Quizlet, Dynalist, Workflowy, Obsidian, Roam/Logseq, Markdown Files, CSV/Excel, PDF/File. Импортированные карточки не становятся due сразу, а идут в *Need to Learn* ([managing new cards](https://help.remnote.com/en/articles/16213222-managing-new-cards) — не читалась, только по ссылке).

**Приватность** ([privacy](https://help.remnote.com/en/articles/7974260-privacy-of-your-notes.md)): сотрудники не читают заметки без разрешения (Support Access — авто-отзыв через 60 дней); E2EE **нет**, «рассматривается»; статистика повторов (без текста карточек) может собираться и просматриваться людьми; фрагменты заметок уходят AI-провайдерам при AI-фичах, кроме bullets, помеченных **Super Private**; выключатель `Use AI Features`; заявление «never sell or monetize your data … do not train any AI models using the text of your notes»; плагины могут отправлять данные третьим лицам (обязаны это раскрывать на странице плагина).

## 7. Авторинг контента

- Основной рабочий цикл: конспектирование в outliner'е → «инлайн»-синтаксис создаёт карточки прямо в тексте (`>>`, `::`, `;;`, `{{}}`) → карточки перегенерируются при правке. Это самая низкая friction среди SRS-инструментов: нет отдельного «редактора карточек».
- Контекст-предки автоматически показываются на карточке → короткие промпты.
- Reader: PDF, слайды, web pages, аннотации → карточки из highlights ([practicing](https://help.remnote.com/en/articles/6904503-practicing-specific-flashcards.md)). На Free — 3 аннотированных документа ([pricing](https://www.remnote.com/pricing)).
- **AI-генерация карточек** ([статья](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai.md)): выделить текст → *Create AI Cards*; Level of Detail (High-level summary / Important ideas / Exhaustive detail); типы карточек; язык; модель; custom instructions; preview с чекбоксами; результаты кэшируются (повтор бесплатен); карточки идут в *Need to Learn*; опция «Add cards in a portal» (каждый Concept → top-level bullet + portal) для борьбы с дублями. Вендор сам рекомендует писать карточки вручную, AI — «starting point».
- Дубликаты и «дрейф» одного concept в разных документах решаются портальностью (single source of truth) — ручная дисциплина.
- **Совместная работа**: shared KB — только Pro; `Share` документа (публичный/unlisted, read-only) ([privacy](https://help.remnote.com/en/articles/7974260-privacy-of-your-notes.md)).
- **API/Plugins**: React-плагины, widgets, custom scheduler'ы, CSS; каталог плагинов и «Official RemNote Plugins» на GitHub ([docs](https://plugins.remnote.com/)). Публичного REST API для внешнего чтения KB в прочитанных источниках не найдено → `[НЕ ПОДТВЕРЖДЕНО]`. Доступность «Plugins and Themes» по тарифам в прочитанной части pricing-страницы не разобрана (иконки SVG) → `[НЕ ПОДТВЕРЖДЕНО]`.

## 8. Монетизация / рынок / аудитория

Тарифы с [remnote.com/pricing](https://www.remnote.com/pricing) (читалось 2026-09; цены в USD; переключатель Monthly/Yearly/Lifetime, значение Lifetime в прочитанной части не разобрано):
- **Free** — $0: unlimited notes & flashcards; unlimited synced devices; 3 annotated PDFs/files/websites; 5 image occlusion; 1 exam; 1 handwritten document; 250 AI credits/мес; 2 KB; 4 aliases; 2 search portals; 10 LaTeX-cloze; 3 tables; 20 file uploads/день, до 8 MB.
- **Pro** — $8/мес, $96/год: PDF annotation, image occlusion, tables & templates, exam scheduler, handwritten notes, 1000 AI credits/мес; безлимит KB/aliases/search portals/tables; 600 uploads/день, до 300 MB. По help-статьям Pro также: shared KB, `Practice All in Order`.
- **Pro with AI** — $18/мес, $216/год: 20 000 AI credits, Learn PDF (AI flashcards/quizzes/summaries), Lecture Recorder, AI Grading & Chat, Image to Text, безлимитные flashcard explanations.
- Есть EDU-план (в title страницы: «Free, Pro, and EDU Plans»), условия не прочитаны → `[НЕ ПОДТВЕРЖДЕНО]`.
- Аудитория (со слов вендора): студенты вузов (медицина, «trusted by people at» Stanford/Oxford/MIT/Harvard — логотипы на странице, не доказательство); «1,000,000+» пользователей в тексте feature-страницы `[НЕ ПОДТВЕРЖДЕНО независимо]`.

## 9. Сильные и слабые стороны

**Сильные**
- Очень низкая friction создания карточек: inline-синтаксис, автогенерация из Concept/Descriptor-структуры, контекст-предки ([creating-flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards.md)).
- Единая модель «заметка = карточка = ссылка = страница» (everything is a bullet); references/backlinks, portals с единым источником.
- Современный SRS: FSRS v6 встроен, оптимизатор весов на истории, per-document схедулеры с наследованием по иерархии.
- Богатый контроль нагрузки: 5 приоритетов, Paused с идущими часами, exam scheduler с catch-up, daily goal, Need-to-Learn очередь для импорта/AI (снижает shock от массового добавления).
- Полноценный offline на desktop/mobile, merge правок с нескольких офлайн-устройств; local KB для полностью локальной работы.
- Открытый plugin SDK; сообщество реализовало то, чего нет нативно (incremental reading).
- Поддерживаемый плоскотекстовый формат импорта карточек (`>>`, `::`, `{{}}`) — пригоден для генерации LLM/скриптами.

**Слабые**
- Нет формального графа prerequisites; иерархия — дерево, references — ненаправленные. Порядок «по зависимости» задаётся только вручную (`Practice in Order`, «Learn In Order»).
- Проприетарный формат и облачный sync; Complete-export не содержит медиа и настроек; нет git-дружественного экспорта; нет инкрементального/программного экспорта → сильный lock-in.
- Нет E2EE; synced-данные в MongoDB Atlas/AWS; AI-фичи отправляют фрагменты нескольким провайдерам.
- Верификация — самооценка; deterministic-проверки нет; AI-grading — LLM-as-judge.
- Ссылки/порталы не пересекают границы KB (лимит масштабирования по «курсам»).
- FSRS всё ещё beta, default — SM-2 (по документации).
- Значимые фичи (exam scheduler, PDF, in-order practice, shared KB) за paywall; AI-функции — кредитная модель.
- Web-версию нельзя запустить офлайн; плагины офлайн недоступны.
- Порядок «Practice All» игнорирует SRS-логику (и явно рекомендован как исключение).

## 10. Что заимствовать / чего избегать

1. **Inline-разметка карточек в Markdown** (`Q >> A`, `Term :: def`, `{{cloze}}`) — заимствовать как *формат авторинга*, но хранить в файлах Git; правила парсинга уже описаны и стабильны. Добавить явные ID карточек (в RemNote карточки — производные от bullet'а, ID неявен) для устойчивости истории при правках.
2. **Контекст из предков на карточке** — заимствовать: генерировать «breadcrumb» из иерархии Markdown-заголовков/списков, чтобы промпты были короткими.
3. **Concept/Descriptor как схема ноды графа** (concept = вершина, descriptor = атрибут/карточка) — заимствовать как методику гранулярности для валидатора «слишком крупный/мелкий топик».
4. **Не повторять отсутствие prerequisites**: сделать направленные рёбра `requires` (DAG) первым классом; References/backlinks RemNote (симметричные) — использовать только как `related`, отдельно от `requires`. Использовать «Learn In Order»-идею как fallback, но выводить её из топологической сортировки.
5. **Схедулер на уровне поддерева с наследованием вверх по иерархии** + FSRS с оптимизатором на истории (порог ≥1000 повторов до обучения весов) — заимствовать как конфигурацию курса/модуля; хранить параметры в JSON рядом с контентом.
6. **Priority-модель Exam / Currently Studying / Maintaining / Paused** — заимствовать; особенно `Paused` с продолжающимся «часами забывания» — это удобно для remediation без потери модели памяти. Подумать о приоритете, зависящем от графа (а не только от папки).
7. **Need-to-Learn очередь** для импортированных/сгенерированных карточек (не ломает due-очередь; против remediation burnout) — заимствовать напрямую, добавив лимит «новых в день» и авто-разбор по графу.
8. **Exam scheduler** (Learning / Catch-up / Final Review, Ensure Mastery «2 правильных подряд») — заимствовать как режим «дедлайн курса», применимый к целевому узлу графа.
9. **Избегать**: закрытого/облачного sync без git-дружественного экспорта; Complete-экспорта без медиа; отсутствия E2EE; LLM-судейства как основы mastery. Держать learner state в SQLite (события review в append-only логе, что даёт мерж без конфликтов), контент — в Git, медиа — рядом с контентом.
10. **Incremental reading как плагин** показывает спрос на приоритезацию при overload (priority shields, priority review docs) — заимствовать идею «top-N по приоритету + ratio карточек/чтения» как режим сессии при большом бэклоге.
11. **Plugin SDK** (sandboxed IFrame + native, scopes на Rem/Document/Powerup, custom schedulers) — референс для API расширений; сохранить принцип «плагин обязан раскрыть, какие данные куда отправляет».

## 11. Источники (фактически прочитаны)

- https://help.remnote.com/en/articles/6026144-the-anki-sm-2-spaced-repetition-algorithm.md
- https://help.remnote.com/en/articles/6958056-custom-schedulers.md
- https://help.remnote.com/en/articles/9124137-the-fsrs-spaced-repetition-algorithm.md
- https://www.remnote.com/pricing
- https://plugins.remnote.com/ (redirect → https://docs.remnote.com/)
- https://help.remnote.com/en/articles/6752029-offline-mode.md
- https://help.remnote.com/en/articles/6025481-creating-flashcards.md
- https://help.remnote.com/en/articles/7950982-setting-priorities-and-disabling-flashcards.md
- https://help.remnote.com/en/articles/7898019-exporting-and-printing-notes.md
- https://help.remnote.com/en/articles/6301627-remnote-backups.md
- https://help.remnote.com/en/articles/7898005-importing-notes.md
- https://help.remnote.com/en/articles/8196578-outlines-and-terminology.md
- https://help.remnote.com/en/articles/6030742-portals.md
- https://help.remnote.com/en/articles/8032170-what-s-the-difference-between-a-document-a-folder-and-a-top-level-bullet.md
- https://help.remnote.com/en/articles/6904503-practicing-specific-flashcards.md
- https://help.remnote.com/en/articles/7974260-privacy-of-your-notes.md
- https://help.remnote.com/en/articles/7867942-multiple-knowledge-bases.md
- https://help.remnote.com/en/articles/6030714-references.md
- https://help.remnote.com/en/articles/6030770-tags.md
- https://help.remnote.com/en/articles/8017859-bullets.md
- https://help.remnote.com/en/articles/6026154-structuring-knowledge-with-the-concept-descriptor-framework.md
- https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai.md
- https://help.remnote.com/en/articles/9101991-preparing-for-an-exam.md
- https://help.remnote.com/en/articles/9252072-how-to-import-flashcards-from-text.md
- https://hugomarins.github.io/incremental-remnote/
- https://github.com/remnoteio/remnote-plugin-template-react

Только сниппеты web_search (страницы целиком не читались): Knowledge Graph, Mobile App, forum.remnote.io offline/sync, feedback.remnote.com offline-kb-on-mobile и incremental-reading, PKMigrator/Remnote2Obsidian, Tracxn.
Не удалось получить (404/недоступно): `.../6030704-offline-mode`, `.../6030719-exporting-from-remnote`, `github.com/remnoteio/remnote-plugin-sdk`, `docs.remnote.com/getting-started/overview`, `hugomarins.github.io/incremental-everything`.
