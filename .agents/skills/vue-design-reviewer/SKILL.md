---
name: vue-design-reviewer
description: Визуальный review страницы или Vue 3 компонента (вёрстка, адаптивность, доступность, тёмная тема, состояния, консистентность) через браузер; если у компонента есть stories, проверка идёт в Storybook. Использовать на просьбы "проверь дизайн / UI / вёрстку", "сделай review компонента / страницы", "найди проблемы в интерфейсе", "проверь адаптивность / контраст". Visual design review of a Vue page or component, Storybook-first.
---

# Vue design review

Визуальная проверка страницы или Vue-компонента: скриншоты, DOM, axe-аудит, размеры, консоль. По умолчанию результат — отчёт. Исправления в исходниках делаются только если пользователь просит («исправь», «почини»); тогда действует раздел «Исправления».

Основано на https://github.com/github/awesome-copilot/blob/main/skills/web-design-reviewer/SKILL.md. Отличия: браузер — встроенный `browser` из `eval` (не Playwright MCP, см. `omp://mcp-config.md`), стек фиксирован (Vue 3 + Vuetify 4 + Vite, Electron), для компонентов с stories проверка идёт через Storybook, по умолчанию правок нет.

## Шаг 0. Выбрать режим

|Цель|Режим|Как|
|---|---|---|
|Компонент, рядом есть `<Name>.stories.ts`|**Storybook** (предпочтительно)|каждая story — отдельное состояние, проверять все|
|Компонент без stories|предложить story|по скиллу `storybook-vue-stories`; без story изолированно смонтировать компонент нечем, а вёрстка «в приложении» смешивает проблемы компонента и страницы|
|Страница по URL (dev-сервер, staging)|**URL**|обычная вкладка `browser`|
|Страница `apps/desktop`|**Storybook со story страницы** или Electron|рендерер зависит от `window.spirula` из preload (`apps/desktop/electron/preload`); в обычном браузере откроется `StartupError`. Story страницы делается с моком `ENGINE_KEY` через decorator/`provide`; запуск настоящего Electron под `browser` (`app.path`/`app.cdp_url`) не проверялся [НЕ ПОДТВЕРЖДЕНО]|

Наличие stories: `glob` по `**/<Name>.stories.ts` и `.storybook/main.ts` в пакете. Storybook в репозитории ставится отдельно (см. `storybook-vue-stories`): если его нет, сказать об этом и предложить установку, а не подменять проверку.

Один вопрос пользователю допустим, если непонятен объём («какая страница/компонент, только смотреть или чинить»). Всё остальное (стек, стили, расположение) берётся из репозитория: Vue 3, Vuetify 4, Vite, FSD (`skill://feature-sliced-design`), стиль `js-conventions`.

## Шаг 1. Поднять цель

**Storybook.** Проверить, что запущен: `http://localhost:6006/index.json` (порт по умолчанию). Иначе запустить `pnpm -F <пакет> storybook` как именованный сервис (`ready` по порту) или собрать `build-storybook` и раздать `storybook-static` статическим сервером. Список stories компонента — из `index.json`: id вида `<путь-в-нижнем-регистре>--<имя-story-в-kebab-case>`, docs — `<...>--docs`.

**URL.** Проверить доступность; для локального проекта — `pnpm dev`/`pnpm -F <пакет> dev` как сервис. Production — только чтение.

## Шаг 2. Осмотр

Инструмент — `browser` в `eval` (docs: `xd://eval/browser`). Проверенные вызовы: `browser.open({ name, url, viewport })`, `tab.goto`, `tab.emulate({ viewport })`, `tab.emulate({ media: { colorScheme: 'dark' } })`, `tab.screenshot({ selector?, fullPage?, silent? })`, `tab.a11y()` (axe-core, список нарушений), `tab.observe()`, `tab.box(sel)`, `tab.styles(sel, [props])`, `tab.console()`/`tab.errors()`, `tab.evaluate(fn)`.

Каркас для Storybook (для URL — тот же цикл без `iframe.html`):

```js
const base = 'http://localhost:6006';
const idx = await (await fetch(`${base}/index.json`)).json();
const ids = Object.keys(idx.entries).filter(
  (id) => id.startsWith('components-appbutton--') && !id.endsWith('--docs'),
);
const tab = await browser.open({ name: 'review', url: base, viewport: { width: 1280, height: 800 } });
for (const id of ids) {
  await tab.goto(`${base}/iframe.html?id=${id}&viewMode=story`);
  await new Promise((r) => setTimeout(r, 1200)); // дождаться рендера и play
  const shot = await tab.screenshot({ selector: '#storybook-root', silent: true });
  const overflow = await tab.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth;
  });
  const a11y = await tab.a11y();
  display(`${id}: overflow=${overflow} axe=${a11y.counts.violations} shot=${shot}`);
}
display(JSON.stringify(await tab.errors()));
```

`tab.a11y()` на странице story-iframe добавляет правила уровня документа (`document-title`, `html-has-lang`, `landmark-one-main`, `page-has-heading-one`, `region`): это артефакт iframe, а не дефект компонента, их отсеивать по `id` (`a11y.violations[].id`). Правила про контраст, метки и роли — значимые: на тестовой странице `color-contrast` сработал на серый `#999` по белому [ИЗМЕРЕНО].

Выведенные пути скриншотов надо смотреть глазами (изображение анализируется, а не только пишется в отчёт): один скриншот на состояние.

Что прогонять:

1. **Каждая story** компонента: default, варианты, состояния (`Disabled`, `Loading`, `Error`, `Empty`), слоты, крайние значения.
2. **Ширины** через `tab.emulate({ viewport })`: 375, 768, 1280, 1920. Для `apps/desktop` мобильные ширины применимы только если окно Electron столько допускает (`createWindowOptions` в `apps/desktop/electron/main/shells/window.ts`); иначе проверять разрешённый минимум и типичные размеры.
3. **Тема**: в Vuetify 4 тема по умолчанию `system`, поэтому светлая и тёмная проверяются обе: `tab.emulate({ media: { colorScheme: 'dark' } })`, затем то же самое заново. Если приложение фиксирует `defaultTheme`, переключение делается через `useTheme()` в story/decorator.
4. **Клавиатура и состояния**: Tab по элементам (`tab.press('Tab')`), видимый focus; `tab.hover`, нажатие; открытые оверлеи Vuetify (меню, диалог) рендерятся в `body`, а не в `#storybook-root`, скриншот делать без `selector`.
5. **Контент**: длинные слова и строки, русский текст (длиннее английского), пустые и большие списки.
6. **Консоль**: `tab.errors()` и `tab.console()` без ошибок и предупреждений Vue/Vuetify.
7. **Docs-страница** (`viewMode=docs`, если `autodocs`): таблица props/events/slots совпадает с компонентом.

Чек-лист пунктов — `references/visual-checklist.md`. Проходить его на осмотре и повторно после исправлений.

Если у story есть `play`, он уже выполнился при загрузке. Провал в iframe оверлея не даёт, только событие канала `playFunctionThrewException`: слушать через `window.__STORYBOOK_ADDONS_CHANNEL__` и `forceRemount` (как в `storybook-vue-stories`, раздел «Проверка»).

Ограничения Storybook-режима: проверяется компонент изолированно, без `v-app-bar`, `v-navigation-drawer` и других layout-компонентов страницы. Взаимодействие компонента с окружением (порядок слоёв, `order`, отступы от layout) смотреть на странице или в story страницы.

## Шаг 3. Оценка

|Приоритет|Смысл|Примеры|
|---|---|---|
|P0|ломает функциональность|элемент перекрыт, контент пропал, story падает|
|P1|серьёзно вредит UX|нечитаемый текст, контраст ниже 4.5:1, нет focus, недоступная кнопка, горизонтальный скролл|
|P2|заметный дефект|выравнивание, разные отступы у однотипных элементов, обрезка текста|
|P3|мелочь|расхождения в пару пикселей, оттенки|

Каждая проблема в отчёте — с доказательством: скриншот (путь), селектор, измеренное значение (`box`, `styles`, axe `id`). «Кажется» без измерения не пишется.

## Исправления (только по просьбе)

1. Минимальные правки, по одной проблеме за раз, после каждой — повторный осмотр той же story/вьюпорта.
2. Vuetify-first: сначала props (`density`, `variant`, `size`), `defaults` в `createVuetify`, тема, утилитарные классы Vuetify; свой CSS — в `<style scoped>` компонента, поверх Vuetify — внутри `@layer vuetify-overrides`. Подробности и примеры — `references/vuetify-fixes.md` и скилл `vuetify-skilld`.
3. Жёсткие цвета и размеры заменяются на токены темы, а не на другие жёсткие значения.
4. Файлы и границы по FSD: не тащить страничную логику в `shared`, не импортировать вверх по слоям.
5. Больше трёх попыток на одну проблему — остановиться и спросить пользователя.
6. Крупные правки (смена компонента, перестройка layout, редизайн) — только после подтверждения.
7. Финал: `pnpm typecheck`, `pnpm lint`; если правился компонент со story — снова прогнать все его stories и `play`.

## Шаг 4. Отчёт

```markdown
# Design review: <цель>

|Поле|Значение|
|---|---|
|Режим|Storybook / URL|
|Цель|<компонент, story id или URL>|
|Ширины|375, 768, 1280, 1920|
|Темы|светлая, тёмная|
|Найдено|N (P0: a, P1: b, P2: c, P3: d)|
|Исправлено|M (если просили чинить)|

## Проблемы

### [P1] <заголовок>
- **Где**: story id / страница, ширина, тема
- **Элемент**: селектор или описание
- **Что не так**: измеренное значение против ожидаемого (контраст 3.1:1 при нужных 4.5:1)
- **Доказательство**: путь скриншота, axe id
- **Исправление**: файл и суть правки (или «не исправлялось»)

## Не исправлено
- <проблема>: причина и рекомендация

## Что не проверено
- <вьюпорт, тема, состояние, которое не удалось посмотреть, и почему>
```

Раздел «Что не проверено» обязателен: пропущенные состояния и ограничения режима (изолированный компонент, нет stories, Electron-мост не эмулирован) называются явно.

## Ловушки

- Шрифты и иконки: без `@mdi/font` иконки Vuetify пустые, без Roboto текст в запасном шрифте. Это ошибка окружения (preview Storybook), а не дефект компонента: сначала проверить `.storybook/preview.ts`.
- Headless-скриншоты отличаются от macOS-рендера сглаживанием; сравнивать до/после в одном окружении.
- Анимации: дождаться окончания перед скриншотом, иначе кадр «посередине».
- `parameters.layout: 'centered'` в preview прячет проблемы растяжения по ширине; для проверки адаптивности смотреть в `fullscreen`.
- Проблемы из-за версии Vuetify (сетка на `gap`, переименованная типографика, уровни `elevation` 0–5, `VBtn` без `uppercase`) — см. `references/vuetify-fixes.md`.
