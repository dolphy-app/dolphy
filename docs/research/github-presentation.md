# Оформление GitHub-организации и репозиториев: исследование и план

Дата: 2026-10-12. Выборка: ~30 README (Zed, Tauri, Excalidraw, Logseq, Joplin, AppFlowy, Bruno, Anki, Ghostty, Jan, Zen, Hoppscotch, Vite, Vitest, Vue, Vuetify, Tailwind, shadcn, TanStack, tRPC, Supabase, Astro, Svelte, Immich, Vicinae и др.), 13 профилей организаций, официальная документация GitHub. Читалась разметка README, а не рендер: размеры картинок в пикселях проверены только там, где указано. Что не подтверждено — помечено `[НЕ ПРОВЕРЕНО]`.

**Принятые решения (2026-10-12).** Сайта нет, `homepage` пуст до его появления. `README.ru.md` удалён. Слоган: «Learn in the right order. Remember for good.» Стиль шапки: логотип + слоган + hero-скриншот (без баннера). Чата нет, бейджа Discord нет. Разделы 4–6 ниже описывают исходное состояние и план; выполнение — ветка `feature/readme-redesign` в `dolphy` и PR «docs: redesign README…» в `courses`, `extensions`, `extension-template`; организация, About и репозиторий `.github` настроены.

## 1. Что делают популярные проекты

### Шапка README

Почти везде одна и та же схема, сверху вниз:

1. Логотип по центру (60–128 px высотой) или широкий баннер. Логотип: Vite, Tailwind, Logseq, Bruno, Ghostty, Vicinae. Баннер: Tauri, Jan, Excalidraw, Hoppscotch, tRPC, Astro.
2. Название и **одна строка** слогана.
3. 3–6 бейджей (медиана 4–5; больше 8 — исключение: Tauri, Logseq).
4. Строка ссылок: `Download · Docs · Discord · Roadmap`.
5. Один hero-визуал: скриншот (Vicinae, Excalidraw, Bruno, Supabase), GIF (Logseq, tRPC), баннер (Tauri, Jan). У Zed, Anki, Ghostty, Zen героя нет, и это не считается дефектом: первый экран важнее картинки.

### Пример Vicinae (10k звёзд)

README (`vicinaehq/vicinae`): логотип 96 px → `<h1>` → `<h4>` слоган → 2 бейджа (сайт, Discord) → один скриншот → абзац «что это» → маркированный список возможностей, **каждый пункт — ссылка в документацию** → «Documentation: vicinae.com» → спонсоры. Установки, сборки и архитектуры в README нет.

About на GitHub у Vicinae:

| Поле | Значение |
|---|---|
| description | `A focused launcher for your desktop - native, fast, extensible` (слоган из README, одна строка, без точки) |
| homepage | `https://vicinae.com` |
| topics | 11 штук: `app-launcher`, `cpp23`, `linux`, `macos`, `windows`, `qt`, `nodejs`, `react`, `raycast`, `productivity`, `poweruser` (категория + стек + ОС + «чем заменяет») |
| discussions | включены; wiki выключена |
| org description / website | `Building power user tooling` / `https://docs.vicinae.com` |
| остальные репозитории орг. | у каждого есть description, у большинства — homepage (`docs`, `website`, `extensions` и т. д.) |

Вывод: description — это слоган, а не описание устройства; homepage заполнен везде; org-страница ведёт в документацию.

### Где живёт техничка

- Вынесена из README в 11 из 12 desktop-проектов: `ARCHITECTURE.md` (Tauri), `HACKING.md` (Ghostty), `CONTRIBUTING.md`, `docs/development.md` (Anki, Logseq), `DEVELOPERS.md` (Supabase), сайт документации (Vite, Tailwind, shadcn, Immich).
- 13 из 13 dev-tool проектов ссылаются на сайт документации; 8 из 13 корневых README ≤ 5,4k символов. Длинными README делают спонсоры, таблицы пакетов, списки переводов — не API.
- GitHub Docs («About READMEs»): README — только то, что нужно, чтобы начать пользоваться и вносить вклад; длинное — в wiki/docs.
- Оглавление пакетов монорепо: корневой README держит таблицу «пакет → одна строка → бейдж версии» (Vite, Astro), сами `packages/*/README.md` — заглушки на 1–3 строки со ссылкой в docs (`@vue/compiler-core`: 21 символ; `vitest`: 256; `vite`: 1,2k). Бренд-пакеты (TanStack, tRPC, Supabase) повторяют баннер.

### Организация

- Профиль-README: `<org>/.github/profile/README.md` (публичный `.github`); для участников — `.github-private`. До 6 закреплённых репозиториев.
- Большинство крупных организаций (vuejs, tailwindlabs, TanStack, supabase, shadcn-ui, electron, Anthropic) профиль-README **не имеют** — только аватар, описание и 6 пинов. Те, у кого есть: Vite, Vitest, Biome, Tauri (одна SVG-иллюстрация + ссылки Docs/Discord), Vuetify, Prisma. Шаблон везде: логотип по центру → слоган → одна строка ссылок.
- Файлы сообщества (`CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `SUPPORT`, `FUNDING.yml`, шаблоны issue/PR) можно положить в публичный `.github` один раз для всех репозиториев. Свой `.github/ISSUE_TEMPLATE` в репозитории полностью отключает общий. `LICENSE` по умолчанию задать нельзя.

## 2. Картинки: как это устроено технически

| Вопрос | Факт | Источник |
|---|---|---|
| Светлая/тёмная тема | `<picture>` + `<source media="(prefers-color-scheme: dark)">`, внутри обязательный `<img alt>` как fallback. Суффиксы `#gh-dark-mode-only` / `#gh-light-mode-only` объявлены устаревшими; на npm и вне GitHub показывают обе картинки. Применяют `<picture>`: Vite, Tailwind, Excalidraw, tldraw, Hoppscotch; суффиксы — Supabase, Bruno (старый стиль) | github.blog 2025-04-18, 2022-08-15 |
| Относительные пути | GitHub переписывает их на просматриваемую ветку, это рекомендуемый способ; работают в профиль-README организации (Tauri: `./intro.svg`) и внутри `<picture>`. **Ломаются** на npm и в маркетплейсах | docs.github.com «About READMEs» |
| Где хранят | относительный путь в репо — 7 из 19 (Tauri `.github/splash.png`, Astro `.github/assets/`, Nuxt, Immich, Bruno); CDN/сайт — Vite, Excalidraw, Vue; `user-attachments` — 5 из 19; абсолютный `raw.githubusercontent.com` — Tailwind, Supabase. Отдельного репозитория под ассеты не встретилось | README проектов |
| Загрузка через редактор (`user-attachments`) | не в git, нельзя ревьюить и версионировать, нет API. Для **видео** это единственный способ получить плеер: `<video>` на файл из репо GitHub вырезает | docs.github.com «Attaching files»; тест moonjar.ai |
| Размеры/форматы | PNG, JPG, GIF, SVG, WebP; загрузка до 10 МБ; видео mp4/mov/webm 10 МБ (free) / 100 МБ (paid). Camo-прокси: по умолчанию 5 МиБ на файл `[прод-лимит НЕ ПРОВЕРЕН]` | docs, atmos/camo |
| Ширина | колонка README ≈ 830 px на github.com, ≈ 1012 px в просмотре `.md`, ≈ 710 px в VS Code Marketplace (сторонний замер 2025-05). Картинки автоматически получают `max-width:100%` | wh0.github.io |
| Санитайзер | `style`, `class`, `<video>` вырезаются; остаются `width`, `height`, `align`, `alt`, `picture`, `source`, `details`, `table`, `kbd`. Размер — только атрибутом `width`/`height`; центрирование — `<p align="center">` | html-pipeline, тест Markdown API |
| SVG | в `<img>` не грузятся внешние шрифты и ресурсы, скрипты запрещены; текст нужно переводить в контуры или встраивать шрифт base64; `currentColor` в `<img>`-SVG не наследует цвет страницы | github/markup, Excalidraw #4855 |
| Social preview | PNG/JPG/GIF < 1 МБ, лучше 1280×640, минимум 640×320; задаётся только в Settings репозитория, API нет (2026); у организации отдельного нет — `og:image` берётся из аватара. Есть сообщение о 404 после загрузки (2026-08) — проверять после загрузки | docs.github.com, discussions #172072, #205556 |
| About | description ≤ 350 символов `[по официальной документации НЕ ПРОВЕРЕНО]`; topics: строчные, цифры, дефис, ≤ 50 символов, до 20 штук | docs.github.com |
| Бейджи | shields.io (`style`, `logo`, `logoColor`, `labelColor`); нативный бейдж Actions `…/actions/workflows/<file>/badge.svg?branch=main` (Vite, Ruff, Astro, Vue) | shields.io, docs |
| Доступность | alt в квадратных скобках, текст с картинки дублировать в alt, эмодзи не как маркеры, заголовки по порядку | github.blog 2023-10-26 |

### Баннеры в реальных проектах

Размеры: Tauri 2251×432 (≈5,2:1, тёмная карточка «запечена» в картинку, поэтому работает в обеих темах), Jan 2048×280, Astro ≈ 2110×684, tldraw 2560×1280. В README показываются масштабированными: `width=830`, `350` (логотип Tailwind), `height=60` (Vite/Vitest), `64`–`173` (логотипы приложений). Размерные классы CSS не используются нигде.

Три рабочих варианта для баннера:

1. Запечённый тёмный баннер без `<picture>` (Tauri, Nuxt, Astro, Jan): проще всего, одинаково на обеих темах; на светлой теме тяжёлый, нужны скруглённые края и поля.
2. Пара `…-light` / `…-dark` в `<picture>` (Excalidraw, Hoppscotch, tRPC): аккуратнее, вдвое больше файлов.
3. Прозрачный логотип-SVG плюс слоган текстом (Vite, Tailwind, Vicinae): самый лёгкий и самый «шумоустойчивый».

Скриншоты приложения: в рамке окна на цветном фоне (Supabase) или чистое окно (Vicinae, Bruno — пара light/dark). Демо — GIF (Logseq, tRPC, ≈ 480–900 px, 15 fps) или mp4, загруженный через редактор.

### Вкус

Из 19 прочитанных README ни один не использует typing-SVG, capsule-render, змейки, trophies, stats-карточки и счётчики посетителей — это приём профилей, не проектов. Рекомендации авторов (Yegor256, thoughtbot): логотип ≤ 100 px, не больше 5 бейджей в строку, одинаковой высоты, один абзац «что это», затем сразу «как попробовать».

## 3. Автогенерация скриншотов (идея под наш e2e)

В e2e уже есть настоящий Electron под Playwright. Playwright Electron API даёт `window.screenshot()`, `colorScheme: 'light'|'dark'`, `recordVideo`; `nativeTheme.themeSource` переопределяет тему. Паттерн из практики (portone-io/headlamp-argo-rollouts #32, nebari-dev/nebari-landing):

- отдельный spec `screenshots` вне набора проверок, фикстуры детерминированы, время и аватары маскируются;
- пары `<имя>-light.png` / `<имя>-dark.png`, `oxipng -o 4 --strip safe`;
- запуск на одной закреплённой ОС (шрифты и рендер различаются между macOS и Linux — иначе diff «дребезжит»);
- CI открывает PR «chore: refresh screenshots» только если картинки изменились (`peter-evans/create-pull-request`) либо коммитит с `[skip ci]` и `concurrency`.

`window.screenshot()` снимает содержимое страницы без нативной рамки окна; для «рамки» нужен постпроцесс (HTML-шаблон или Figma) `[ВЫВОД]`.

## 4. Текущее состояние (на 2026-10-12)

| Что | Состояние |
|---|---|
| Организация `dolphy-app` | описания, сайта, e-mail нет; репозитория `.github` нет; 4 публичных репозитория; индекс здоровья `dolphy` — 12 % (есть только README) |
| `dolphy` | About пуст: нет description, homepage, topics; нет корневого `LICENSE` (GitHub не определил лицензию; MIT лежит в `apps/desktop/LICENSE`); нет CONTRIBUTING, SECURITY, CoC, шаблонов issue/PR; discussions выключены |
| `courses` | description есть; topics и homepage нет; wiki включена, но не используется; лицензия `NOASSERTION` (CC BY-NC) |
| `extensions` | нет description, topics, лицензии |
| `extension-template` | description и 3 topics есть (`dolphy`, `dolphy-extension`, `template`) |
| Корневой `README.md` (115 строк) | логотип 96 px и слоган — хорошо; но нет ни одного скриншота и нет бейджей; вперемешку маркетинг («Why Dolphy», «A day with Dolphy») и инструкции по установке неподписанной сборки, раздел «Built on Trane» с таблицей сравнения, «By the numbers», «Roadmap», ссылки на русскоязычные `AGENTS.md`/`docs/` в «Contributing»; `README.ru.md` — русскоязычный публичный документ (противоречит правилу AGENTS.md о языке документов) |
| `apps/desktop/README.md` (296 строк) | чистая техничка (схема процессов, таблица каталогов, fuses, e2e); GitHub показывает его на странице каталога |
| `packages/README.md` (79 строк) | карта пакетов + абзацы на 700–1000 символов про внутренности движка; README у отдельных пакетов есть только у 5 (`ext-js`, `keybindings`, `extension-sdk` 648 строк, `extension-tools` 438 строк) |
| Опубликованные пакеты | README генерируется из `tools/templates/package-readme.md`; картинок и бренда нет (на npm относительные пути не работают) |
| Ассеты | только `apps/desktop/src/shared/assets/logo.svg` (824×824, градиенты, в рабочем дереве изменён) и `build/icon.png`; скриншотов, баннера, OG-картинки нет |

## 5. Целевая структура

### Корневой README `dolphy` (≈ 70–90 строк, 100 % маркетинг)

```
<picture> логотип light/dark, height=96 </picture>
# Dolphy
Слоган (1 строка)
[бейджи: Release · CI · License · Platforms]      ← не больше 4
Download · Docs · Courses · Extensions · Discord?   ← одна строка ссылок
<hero: скриншот light/dark в <picture>, width=830>

Абзац «что это» (3 предложения)
## Why Dolphy      — 3 коротких пункта (порядок, проверка кода, local-first) + по картинке
## Features        — 3–4 блока «картинка + 2 строки» (граф, ежедневный план, SQL-раннер, курсы-Markdown)
## Download        — 3 кнопки/ссылки, строка про «unsigned: see first-launch guide»
## Courses & extensions — ссылки на `courses`, `extensions`, `extension-template`
## Built on Trane  — 3 предложения + ссылка (таблица сравнения уходит в docs)
## Contributing    — ссылка на CONTRIBUTING.md; Community; License
```

Что уходит из README и куда:

| Из корневого README | Куда |
|---|---|
| «Try it from source», команды | `CONTRIBUTING.md` (английский, в корне) |
| «First launch of an unsigned build» | `<details>` под кнопками скачивания; позже — страница сайта документации |
| «If you know Anki», таблица «From Trane / Added in Dolphy», список изученного | страница «Why Dolphy / Compared to…» сайта документации; в README остаётся одно предложение |
| «By the numbers» (2 800 тестов, 18 564 ревью…) | оставить 1 строкой-«полоской» под features либо перенести на сайт; на первом экране не нужны |
| «Roadmap» | GitHub Milestones/Discussions или страница сайта; в README — одна ссылка |
| Ссылки на `AGENTS.md`, `docs/repository.md` (русские) | только в `CONTRIBUTING.md`, помечено «internal, Russian» |

### Остальные README

- `apps/desktop/README.md` → короткий (≈ 20 строк: что это, `pnpm dev`, ссылка на `ARCHITECTURE.md`). Содержимое текущего README переезжает **как есть** в `apps/desktop/ARCHITECTURE.md` (английский публичный документ; паттерн Tauri). Не в `docs/`: там русский.
- `packages/README.md` → таблица «пакет — одна строка — опубликован?» (≤ 40 строк); абзацы про внутренности (строки 30–48) → `packages/ARCHITECTURE.md`; разделы «Publishing», «Tests», «TypeScript 7» → `CONTRIBUTING.md` или тот же файл.
- Пакеты, публикуемые в npm (`extension-api`, `keybindings`, `extension-sdk`, `extension-tools`, `create-extension`): README-заглушка по Vite/Vitest — слоган, install, один пример, ссылка на документацию. Баннер не нужен; если нужен — **абсолютный** URL `https://raw.githubusercontent.com/dolphy-app/dolphy/main/.github/assets/…` (ветка `main` стабильна — только релизы). Шаблон `tools/templates/package-readme.md` расширить блоком `docs`/`links`. 648- и 438-строчные README `extension-sdk`/`extension-tools` → справочник API на страницу `docs`, в README — quickstart.
- `courses`: логотип/баннер, слоган, таблица курсов с обложкой/числом уроков, «Add to Dolphy» (3 шага), лицензия; «Validate» и «Exercise format» → `CONTRIBUTING.md`.
- `extensions`: слоган, витрина (список расширений с описаниями), «Install» (3 строки), «Publish» (ссылка); правила ревью → `CONTRIBUTING.md`.
- `extension-template`: слоган, кнопка «Use this template» (ссылка `…/generate`), что внутри (4 пункта), как запустить.

## 6. План работ

Решения и риски перед стартом (нужны ваши ответы): см. раздел 7.

### Этап 0. Решения (без кода)

1. Слоган и описание (разделы 5 и 8).
2. Есть ли сайт/домен для `homepage`; если нет — GitHub Pages для `dolphy-app.github.io/dolphy` (одна страница + docs) или временный `homepage` = страница Releases.
3. Судьба `README.ru.md` (правило AGENTS.md запрещает новые/изменённые русскоязычные публичные документы). Рекомендация: убрать или заморозить; Bruno и Jan — единственные в выборке с переводами README, остальные 10 обходятся английским.
4. Корневой `LICENSE` (MIT уже лежит в `apps/desktop/LICENSE`) и лицензия `extensions`.

### Этап 1. Ассеты (ветка `feature/brand-assets`)

- Логотип: SVG без внешних шрифтов и скриптов; варианты `logo-light.svg`, `logo-dark.svg` (для `<picture>`); текстовая версия (иконка + «Dolphy» в контурах).
- Хранение: `.github/assets/` (паттерн Tauri/Astro; относительные пути из корневого README, абсолютные raw-URL из npm-README).
- Hero-скриншоты ≥ 3 (план дня, граф знаний, сессия с SQL) × light/dark; 1600–2000 px по ширине, `oxipng`, показываются с `width="830"`.
- Опционально демо-GIF ≤ 10 МБ (ffmpeg palettegen, 15 fps, ширина 800) или mp4 через редактор GitHub — mp4 по умолчанию не автоплеит.
- Social preview 1280×640 (< 1 МБ) для `dolphy`; аватар организации — иконка без текста, квадрат; отдельная картинка на остальные репозитории не нужна (`og:image` генерируется GitHub).
- Автоматизация: spec `apps/desktop/e2e/screenshots.spec.ts` + job в `desktop-checks.yml` (раз в релиз-PR) — по разделу 3.

### Этап 2. Переоформление `dolphy` (ветка `feature/readme-redesign`)

1. Перенести технику: `apps/desktop/ARCHITECTURE.md`, `packages/ARCHITECTURE.md`, `CONTRIBUTING.md` (команды, workflow, source build).
2. Переписать корневой README по разделу 5; прогнать `pnpm fix && pnpm lint`.
3. Сократить `apps/desktop/README.md`, `packages/README.md`; обновить ссылки в `AGENTS.md` и `docs/repository.md`, если они указывают на удалённые разделы.
4. Добавить в `AGENTS.md` короткий подраздел «Оформление README» (структура шапки, `<picture>`, правила ссылок и ассетов).
5. Коммиты `docs(...)`, PR в `develop`.

### Этап 3. Пакеты npm

- Расширить `tools/templates/package-readme.md`; пересобрать `pnpm build:packages`; убедиться, что в `dist-publish/*/README.md` нет относительных путей.
- Сократить README `extension-sdk` и `extension-tools`; справочник — в `ARCHITECTURE`/docs-страницы.

### Этап 4. Организация и About (делается вручную или `gh`, без PR)

`gh repo edit` и `gh api` для всего ниже; social preview — только вручную в UI.

| Репозиторий | description (EN) | homepage | topics |
|---|---|---|---|
| `dolphy` | `Learn in the right order. Remember for good. A local-first desktop app for skill-based learning` | сайт/Pages | `spaced-repetition`, `fsrs`, `learning`, `knowledge-graph`, `flashcards`, `education`, `local-first`, `desktop-app`, `electron`, `vue`, `typescript`, `sqlite` |
| `courses` | `Open course library for Dolphy: lessons as plain Markdown, exercises checked by running code` | сайт/Pages | `dolphy`, `courses`, `education`, `spaced-repetition`, `markdown` |
| `extensions` | `Community extension catalog for Dolphy: exercise types, themes and tools` | сайт/Pages | `dolphy`, `dolphy-extension`, `extensions`, `catalog` |
| `extension-template` | `Starter template for Dolphy extensions: Vue, React, server + RPC and themes` | сайт/Pages | `dolphy`, `dolphy-extension`, `template` |

- Организация: description = слоган (`Local-first learning tools`/подобное), website = сайт/docs, аватар, email/location по желанию; открепить лишнее, закрепить `dolphy`, `courses`, `extensions`, `extension-template`.
- Создать публичный репозиторий `dolphy-app/.github`: `profile/README.md` по шаблону Vite/Tauri (логотип по центру → слоган → одна строка ссылок Download · Docs · Courses · Extensions), плюс общие `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, шаблоны issue (bug/feature) и PR. Здоровье репозитория поднимается с 12 %.
- `dolphy`: включить Discussions (канал «вопросы» вместо Discord на старте), корневой `LICENSE`, `.github/FUNDING.yml` по необходимости; `courses`: выключить пустую wiki.

### Этап 5. `courses`, `extensions`, `extension-template`

README по разделу 5; общий визуальный набор (логотип/цвет), в каждом — строка «Part of Dolphy» со ссылкой на организацию; бейдж CI валидатора. Менять через ветки `feature/...` каждого репозитория по `git-workflow`.

### Этап 6. Закрепление

- Релиз-процесс не меняется (semantic-release считает `docs:` без релиза).
- Проверка перед слиянием: README открыть на github.com в светлой и тёмной теме, на мобильной ширине (≤ 400 px — баннеры масштабируются), в `npm view <pkg> readme` для опубликованных пакетов, и проверить `og:image` ссылки в Slack/Discord/Telegram.

## 7. Открытые вопросы к вам

1. Есть ли домен/сайт? Без него `homepage` и «Docs» ведут на Releases или GitHub Pages — нужно решить, делать ли сайт (новый пакет `apps/docs` потребует спеки по AGENTS.md).
2. Оставляем ли `README.ru.md` (противоречит текущему правилу о языке документов)?
3. Слоган: сейчас «Learn in the right order. Remember for good. Keep everything on your computer.» — три фразы; для About нужна одна строка до ~100 символов.
4. Стиль баннера: запечённый тёмный (как Tauri/Jan), пара light/dark (как Excalidraw) или только логотип + слоган (как Vite/Vicinae)? Рекомендую третий вариант + hero-скриншот.
5. Нужен ли Discord/чат; без него бейдж не добавляем (ложные ссылки хуже отсутствия).

## 8. Рекомендация одной строкой

Шапка как у Vicinae и Vite (логотип, слоган, 3–4 бейджа, строка ссылок, один скриншот), техничка по паттерну Tauri (`ARCHITECTURE.md` + `CONTRIBUTING.md`), картинки лежат в `.github/assets/` и подключаются относительными путями через `<picture>`, для npm — абсолютными raw-URL, About заполнен слоганом + homepage + 8–12 topics, организация получает `.github/profile/README.md` и общие файлы сообщества.

## Источники

- GitHub Docs: About READMEs; Basic writing and formatting (images, `<picture>`); Attaching files; Customizing your organization's profile; Default community health files; Customizing the social preview; Classifying with topics; Add a status badge.
- GitHub Blog: «How to make your images in Markdown on GitHub adjust for dark mode and light mode» (2025-04-18); changelog 2022-08-15 (theme context GA), 2023-05-08 (private attachments), 2026-09-01 (`gh --attach`); «5 tips for making your GitHub profile page accessible» (2023-10-26).
- Реальные README: `raw.githubusercontent.com/<owner>/<repo>/HEAD/README.md` для проектов из выборки; `vicinaehq/vicinae` (README, REST `repos/vicinaehq/vicinae`, `orgs/vicinaehq`).
- Сторонние: wh0.github.io/2025/05/18/banner-width.html (ширина колонки), stefanjudis.com (dark-mode картинки), moonjar.ai (санитайзер и видео), yegor256.com «Elegant READMEs», thoughtbot «How to write a great README», matiassingers/awesome-readme, ffmpeg-cookbook.com (GIF), playwright.dev (`class-electron`, `test-snapshots`), portone-io/headlamp-argo-rollouts#32, nebari-dev/nebari-landing.
