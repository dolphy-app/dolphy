---
status: done
branch: feature/extension-frameworks
created: 2026-10-08
closed: 2026-10-08
touches: [extension-api, extension-sdk, extension-tools, create-extension, desktop, docs]
depends-on: [specs/archive/2026-10-07-extension-runtime]
supersedes: null
superseded-by: null
---

# Интерфейс расширений не только на Vue: монтируемые компоненты и пресеты сборки

> Исторический документ. Не источник требований.

Живой документ, пока `status` — `draft` или `active`: `Progress`, `Surprises & Discoveries`, `Decision Log` обновляются вместе с кодом. По завершении фичи переносится в `specs/archive/` и не меняется. Правила — скилл `spec-workflow`.

## Цель

Расширение рисует свой интерфейс на любом фреймворке, а не только на Vue: панель, вставка в любое место окна, вид ответа и блок markdown принимают либо Vue-компонент, либо «монтируемый» (`Mountable`): функцию `mount(el, ctx)`, которая рисует в выданный элемент и возвращает очистку. Расширения на разных фреймворках работают в одном окне одновременно; сбой одного не трогает остальные. Vue остаётся фреймворком по умолчанию (общий Vuetify, тема, оболочка ошибок, бандл 1–2 КиБ). Первый поддерживаемый не-Vue фреймворк — React.

## Не цели

- Общий рантайм между расширениями (одна копия React для всех): отдельная спека, вероятный путь — расширение-пакет `dolphy.react` (`dependencies`), которое выдаёт `react` как общий модуль.
- Компоненты Vuetify и оверлеи приложения (`VDialog`, `VMenu`) в чужих фреймворках; тема доступна переменными и `ctx.theme`, диалоги автор рисует сам.
- Svelte, Solid, Lit и другие пресеты в этой фиче: механизм пресетов их допускает, но доказывается он на React.
- Shadow DOM для изоляции стилей (`defineMountable(fn, { shadow: true })`): по запросу.
- Серверная часть (`server`) не меняется: она остаётся на Node без UI.

## Требования

Наблюдаемое поведение, не реализация. У каждого требования есть проверка.

- R1. `component` принимает Vue-компонент или `Mountable`. Все четыре поверхности (`addPanel`, `addInjection`, `addAnswerView`, `addMarkdownRenderer`) рисуют `Mountable` в выданном `<div>`; при размонтировании (смена маршрута, отключение или удаление расширения, исчезновение цели инъекции) вызывается очистка; props и события вида ответа проходят через `ctx`. Проверка: unit хоста монтирования на каждую поверхность; e2e `extension-react`.
- R2. Несколько фреймворков одновременно. React-панель одного расширения и Vue-вставка другого рисуются в одном окне, обе реагируют на смену темы и языка; исключение в `mount` или `ctx.reportError(error)` заменяет только область этого компонента карточкой «Расширение <название>: <ошибка>» с кнопкой «Повторить» (R4 прежней спеки), остальное работает. Проверка: e2e `extension-react`.
- R3. `MountContext` не зависит от Vue: `props` и `onProps(listener)`, `emit(event, payload)` (вид ответа), `app` (`AppApi`), `engine`, `callRpc(contract, input)`, `theme` и `onTheme(listener)`, `locale`, `extensionId`, `signal` (`AbortSignal`, отменяется при размонтировании), `reportError(error)`. Те же возможности, что дают `useApp`, `useEngine`, `useRpc`, `usePanel`, `useInjection` Vue-компоненту. Проверка: unit; тип `Mountable` в `types.test-d.ts`.
- R4. React как пресет. `dolphy-ext.config.json` принимает `"frameworks": ["react"]` (по умолчанию `["vue"]`): `.tsx`/`.jsx` компилируются автоматическим JSX-рантаймом, `react` и `react-dom` входят в бандл расширения (внешние только `vue`/`vuetify`). `@dolphy-app/extension-sdk/react` даёт `reactComponent(Component)` (оборачивает компонент React в `Mountable`) и хуки `useApp`, `useEngine`, `useRpc`, `usePanel`, `useInjection` на React-контексте, который адаптер выдаёт. Проверка: тест сборки `extension-tools` на пресет; `generated-project.test.ts` для шаблона `react-panel`; e2e.
- R5. Проверяемый пример и шаблон. `create-dolphy-extension --template react-panel` создаёт проект, который собирается, проходит `tsc` и `vitest` (компонент монтируется в тесте через `createTestClient`/`mountForTest`); рецепт в `packages/extension-sdk/docs`. Проверка: `generated-project.test.ts`, `sdk-docs.test.ts`.
- R6. Цена видна. Размер бандла панели React «привет, мир» замеряется при реализации и записывается в `Progress` и в раздел документа «Что стоит знать»; порога и теста на размер нет (решение владельца: размер не важен).
- R7. `.vue` (SFC). Пресет `vue` собирает `.vue` в клиентском бандле: `<script setup lang="ts">`, `<template>` с компонентами Vuetify как `<v-btn>`, `<style>` и `<style scoped>`; бандл не содержит `vue` и `vuetify` (импорты идут к общим модулям окна), стили вставляются тегом `<style data-dolphy-ext="<id>">` при загрузке `client.mjs` (глобально в документе окна; один раз на модуль, при перезагрузке модуля старый тег заменяется); `.vue` в серверной части — ошибка сборки. Проверка: тест сборки `extension-tools`, e2e `extension-sfc` (кнопка Vuetify, scoped-стиль, две темы), шаблон `command-panel` на SFC в `generated-project.test.ts`.
- R8. Документ `docs/design/extensions.md` описывает `Mountable`, `MountContext`, пресеты (включая SFC) и ограничения (нет Vuetify и оверлеев приложения, свой рантайм в каждом расширении, ошибки React ловит автор через `reportError`). Проверка: `docs-contributions.test.ts`.

## Решения

**Монтируемый компонент.** `Mountable<Props> = { readonly [MOUNTABLE]: true; mount(el: HTMLElement, ctx: MountContext<Props>): Unmount | Promise<Unmount> }`; `defineMountable(mount)` строит его, `isMountable` распознаёт по бренду. Тип `Unmount = () => void | Promise<void>`. Определение живёт в `@dolphy-app/extension-api` (типы и бренд), помощники — в SDK. Регистрации (`PanelRegistration`, `InjectionRegistration`, видов ответа и рендереров markdown) принимают `Component | Mountable` в поле `component`; для разных поверхностей `Props` разные (`PanelProps`, `AnswerViewProps`, `MarkdownBlockProps`, для инъекции — `InjectionHandle`).

**Окно.** Один внутренний компонент `MountableHost.vue` (общий для `PanelHost`, `InjectionHost`, `AnswerView`, `MarkdownBlock`): создаёт `<div>`, вызывает `mount` в `onMounted`, в `onBeforeUnmount` отменяет `signal` и вызывает очистку, переносит изменения props в `onProps`, `reportError` и исключения `mount` передаёт в существующую оболочку R4. Тема и язык приходят из тех же реактивных источников, что у `AppApi`. `MountContext.app` и `engine` — те же объекты, что получает `client(c)`; `callRpc` — функция без композаблов поверх `engine.extensions.invokeRpc`.

**Пресеты сборки.** `extension-tools` читает `frameworks` из `dolphy-ext.config.json` (следующим шагом — из `dolphy-ext.config.ts`, если понадобятся плагины автора) и подключает набор пресетов; пресет — модуль `{ name, extensions, plugins() }`. `vue` (по умолчанию) — `@vitejs/plugin-vue`; шаблонные компоненты Vuetify (`<v-btn>`) превращаются в импорты из `vuetify/components`, которые `hostModulesPlugin` заменяет на общие модули окна; CSS компонентов собирается в строку и вставляется тегом `<style>` при загрузке модуля (правило `assets-plugin`, отклоняющее CSS автора, для `.vue` не действует). `react` — автоматический JSX без плагина (`oxc.jsx.runtime = 'automatic'`), `react`/`react-dom` ставит автор. Пресеты — подпути `@dolphy-app/extension-tools/presets/*`; зависимости фреймворков опциональные, нужный пресет подключается только если фреймворк указан в конфиге. SDK получает тонкие подпути `@dolphy-app/extension-sdk/react` (и позже `/svelte`) с адаптером и хуками; `react` — необязательная peer-зависимость SDK.

**Что не меняется.** Хост расширений, протокол, контракт движка, каталог, `defineRpc`, хуки; сборка серверной части; правила границ (`vue`, `vuetify*` не в `main.mjs`, `node:*` не в `client.mjs`). Правило границ для `react` не нужно: серверный файл с `react` — обычная зависимость автора.

## Progress

- [x] 2026-10-08 проектирование (этот документ), решения владельца в `Decision Log`
- [x] 2026-10-08 типы `Mountable`, `MountContext`, бренд, `types.test-d.ts` (`extension-api`)
- [x] 2026-10-08 `defineMountable`, `callRpc`, `mountForTest`, `createTestClient` (SDK)
- [x] 2026-10-08 `MountableHost.vue`, подключение к четырём поверхностям, тесты (окно)
- [x] 2026-10-08 пресеты сборки и `frameworks` в `dolphy-ext.config.json`, пресет `react` (`extension-tools`)
- [x] 2026-10-08 `@dolphy-app/extension-sdk/react`: `reactComponent`, хуки
- [x] 2026-10-08 шаблон `react-panel`, рецепт, документ, e2e `extension-react`
- [x] 2026-10-08 замер размера: React «hello, world» без минификации 565 515 Б / 106 460 Б gzip (с `esbuild --minify` ≈ 69 КиБ gzip), SFC с одной `<v-btn>` 1 152 Б / 568 Б gzip; порога нет
- [x] 2026-10-08 пресет `vue` с `.vue`: `plugin-vue`, `<v-*>` в шаблоне, стили, правило границы для сервера, шаблон `command-panel` на SFC, e2e `extension-sfc`

## Surprises & Discoveries

- Vite 8 при `NODE_ENV≠production` включает `jsxDEV`, которого нет в production-сборке React: пресет `react` ставит `oxc.jsx.development = false`, иначе панель падала бы в рантайме.
- Серверный бандл тянул `react`/`react-dom`/`scheduler` (1,5 МБ): пресет объявляет пакеты фреймворка, их импорты вычищаются из `main.mjs`.
- `@vitejs/plugin-vue` по умолчанию кладёт в бандл `__file` с путём машины сборки: пресет `vue` всегда собирает в production-форме.
- Механизм peer-зависимостей публикации не переносил `peerDependenciesMeta`: `react` не стал бы необязательным (`derivePeerDependenciesMeta`).

## Decision Log

- 2026-10-08. `Mountable` принимается везде, где сейчас `component` (а не отдельными методами `addPanelElement`). Причина: один API на все поверхности, решение владельца.
- 2026-10-08. Общий рантайм (одна копия React) откладывается: у каждого расширения свой бандл, позже расширение-пакет `dolphy.react`. Решение владельца.
- 2026-10-08. Фреймворк доказывается на React. Svelte и Lit возможны тем же механизмом пресетов, но не входят в фичу. Решение владельца.
- 2026-10-08. Сборка — пресеты `vue`/`react`/`svelte` как подпути (предложение владельца), а не произвольные плагины автора и не вшитый список: пресет подключается по `frameworks` в конфиге. Плагины автора (`dolphy-ext.config.ts`) — отдельная возможность, если пресетов не хватит.
- 2026-10-08. `.vue` (SFC) входит в фичу как часть пресета `vue` (R7). Решение владельца.
- 2026-10-08. Пресет `react` обходится встроенным JSX (`oxc.jsx.runtime = 'automatic'`), без `@vitejs/plugin-react`; Fast Refresh не нужен. Решение владельца.
- 2026-10-08. `ctx.props` — неизменяемый снимок плюс `onProps(listener)`, а не реактивный объект. Решение владельца.
- 2026-10-08. Порога размера бандла нет: размер замеряется и записывается. Решение владельца.

## Outcomes

Сделано всё из «Цели»: `Mountable` на четырёх поверхностях, `MountContext` без привязки к Vue, пресеты `vue` (SFC) и `react`, `@dolphy-app/extension-sdk/react`, шаблоны `react-panel` и `command-panel` на SFC, рецепты и раздел документа, e2e (225 из 225 при закрытии) с React и Vue SFC в одном окне. Решение оформлено в ADR 0023.

**Отличия от плана.** Размер бандла не ограничен (решение владельца): замеры в `Progress`. `vue-tsc` в шаблоне заменён shim'ом `*.vue`. Пресеты внутри бинарного бандла `extension-tools`, отдельных подпутей `presets/*` нет. `peerDependenciesMeta` для публикации добавлено в `tools/lib/package-manifest.mjs`.

**Остатки.** Общий рантайм между расширениями (расширение-пакет `dolphy.react`); пресеты Svelte и других; Shadow DOM; минификация клиентских бандлов; плагины сборки автора, если пресетов не хватит.
