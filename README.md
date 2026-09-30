# lms-platform-design

Документы системного дизайна локальной адаптивной обучающей платформы (граф знаний + интервальные повторения + курсы как Markdown/Git, ответы проверяют детерминированные раннеры) и дизайн слоя бизнес-логики `engine-ts` (TypeScript-порт Trane на ts-fsrs для Electron-приложения). Кода движка ещё нет. Язык документов: русский, идентификаторы и код — английские. Пометки: [ИЗМЕРЕНО] — получено прогоном, [ВЫВОД] — умозаключение, [ОЦЕНКА] — расчёт, [НЕ ПОДТВЕРЖДЕНО] — не проверено.

С чего начать разработку: `engine-ts/README.md`. Правила репозитория (монорепо на pnpm-workspace, git-процесс `feature/*` → `develop` → `main`, CI): `AGENTS.md`. Приложение: `apps/desktop` (Electron + Vue 3 + Vite).

## Карта документов

| Путь                                                                                                   | Что                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/platform-synthesis.md`                                                                    | синтез исследований, требования платформы F1–F7 (§4), архитектура                                                                                                                                                       |
| `docs/design/mvp-trane.md`, `mvp-trane-vs-knowledge-spaces.md`, `build-vs-port.md`, `fsrs-in-trane.md` | варианты построения ядра (Trane как движок MVP, сравнение с пространствами знаний, порт против своего ядра, FSRS в Trane)                                                                                               |
| `docs/research/`                                                                                       | исследования: Trane (обзор, аудит исходников, спайк), Math Academy, Vanderbilt Knowledge Spaces, RemNote, Mochi, FSRS против PowerLaw, FSRS в Trane (скорер, усечение истории, интеграция)                              |
| `engine-ts/README.md`                                                                                  | порядок чтения, старт M0, открытые вопросы, ловушки                                                                                                                                                                     |
| `engine-ts/design/`                                                                                    | главный дизайн v1 (`engine-ts.md`), API-контракт, стратегия тестов, схема (`.html`)                                                                                                                                     |
| `engine-ts/research/`                                                                                  | 4 спеки поведения Trane, 8 отчётов спайков (FSRS, PowerLaw, загрузчик, F1–F7), `facts-stack.md`                                                                                                                         |
| `spike/REPORT-audit.md`, `spike/REPORT-spike.md`                                                       | отчёты первого раунда спайков Trane; `REPORT-audit.md` отличается от `docs/research/trane-source-audit.md` (48 КБ против 39.8 КБ), `REPORT-spike.md` — копия `docs/research/trane-spike.md` с другой пометкой о статусе |

Пути внутри документов записаны от корня исходного проекта и в репозитории сохранены как есть (`docs/…`, `engine-ts/design/…`, `engine-ts/research/…`, `spike/REPORT-*.md`).

## Артефакты вне репозитория

Код песочницы остался в `/Users/tinkerbells/projects/lms-platform/` и в git не входит. Ссылки на эти пути в документах ведут туда.

| Путь в документах                                                     | Что                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine-ts/spike/`                                                    | 8 прототипов и бенчмарков (`compiler`, `diagnostic`, `fire-plan`, `fsrs-check`, `journal-sync`, `loader-bench`, `powerlaw-port`, `sql-runner`; у `loader-bench` тестов нет, только бенчмарки) и зонды `probes/`, `specs/`; зависимости ставятся `npm ci` |
| `engine-ts/reference/trane-pristine/`                                 | Rust-эталон Trane v0.34.1 = тег `v0.34.1`, коммит `6f5f84a85667b4bf0402b1185ae5a889ff57e01d` (https://github.com/trane-project/trane), нужен для golden-тестов                                                                                           |
| `engine-ts/reference/sql-course/`, `engine-ts/reference/fsrs-scorer/` | образцовый курс на 7 уроков и Rust-адаптер FSRS (12 тестов)                                                                                                                                                                                              |
| `spike/fsrs-vs-trane/`                                                | эксперимент «FSRS против PowerLaw» (Rust + Python, CSV)                                                                                                                                                                                                  |

## Скиллы

[metarhia/metaskills](https://github.com/metarhia/metaskills) (MIT) подключён как git submodule `vendor/metaskills`, зафиксирована версия 1.0.5 (коммит `fe4c4230ea054e4b354d9e81400e26299f1be6d7`). Семь скиллов: `js-conventions`, `js-data-structures`, `data-structures`, `metautil-data-structures`, `js-gof`, `error-handling`, `npm-publish`.

Агентам они доступны через симлинки: `.agents/skills/<name>` → `vendor/metaskills/skills/<name>`, `.claude/skills/<name>` → `.agents/skills/<name>` (как в `~/.claude/skills`). Симлинки лежат в git. Проверено: headless-сессия `omp -p`, запущенная в этом каталоге, видит все семь скиллов в системном промпте [ИЗМЕРЕНО].

```sh
git submodule update --init && scripts/link-skills.sh          # после клонирования без --recurse-submodules
git submodule update --remote vendor/metaskills && scripts/link-skills.sh   # обновить скиллы
```

Почему не `npx metaskills`: он создаёт одну ссылку `<ide>/skills/metaskills` на всю папку, то есть раскладку `skills/metaskills/<name>/SKILL.md`, а omp ищет скиллы ровно на один уровень ниже `skills/` (документация omp, `skills.md`). Поэтому `scripts/link-skills.sh` линкует каждый скилл отдельно.

Скилл [`vuetify-skilld`](https://github.com/harlan-zw/vue-ecosystem-skills/tree/main/skills/vuetify-skilld) (harlan-zw/vue-ecosystem-skills, Vuetify 4.0.1) лежит в git как обычный каталог `.agents/skills/vuetify-skilld` (копия из GitHub, не через market.lobehub.com), `.claude/skills/vuetify-skilld` — симлинк на него. `scripts/link-skills.sh` его не трогает: скрипт снимает только висячие ссылки на `vendor/metaskills`.

Скилл [`feature-sliced-design`](https://github.com/feature-sliced/skills) (Feature-Sliced Design v2.1) поставлен `npx skills add https://github.com/feature-sliced/skills --skill feature-sliced-design` (с `DISABLE_TELEMETRY=1`); CLI кладёт копию в `.claude/skills/`, каталог перенесён в `.agents/skills/feature-sliced-design`, в `.claude/skills/` — симлинк, как у остальных. Источник и хэш записаны в `skills-lock.json`.

Свой скилл `storybook-vue-stories` (`.agents/skills/storybook-vue-stories`, симлинк в `.claude/skills/`) — как писать Storybook stories для Vue 3 компонентов (CSF 3, Storybook 10, Vuetify, `play`); основан на статье https://habr.com/ru/articles/761570/.

Скилл `vue-design-reviewer` (`.agents/skills/vue-design-reviewer`, симлинк в `.claude/skills/`) — визуальный review страницы или компонента Vue; для компонентов со stories проверка идёт через Storybook, по умолчанию только отчёт. Основан на [web-design-reviewer](https://github.com/github/awesome-copilot/blob/main/skills/web-design-reviewer/SKILL.md) из github/awesome-copilot, браузер — встроенный `browser` omp вместо Playwright MCP.

Скилл [`vue-i18n-skilld`](https://github.com/skilld-dev/vue-ecosystem-skills/tree/main/skills/vue-i18n-skilld) (skilld-dev/vue-ecosystem-skills, vue-i18n 11.4.12; листинг https://mcpmarket.com/tools/skills/vue-i18n-internationalization) скопирован из GitHub в `.agents/skills/vue-i18n-skilld`, симлинк в `.claude/skills/`. `vue-i18n` в проект пока не подключён.

Линтер и форматтер: ESLint (`eslint-config-metarhia`) + Prettier, как требует `js-conventions`; решение принято вместо Biome из первоначального дизайна `engine-ts` (M0).
