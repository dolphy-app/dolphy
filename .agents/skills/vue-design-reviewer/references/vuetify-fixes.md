# Исправления для Vue 3 + Vuetify 4

Адаптировано из `web-design-reviewer/references/framework-fixes.md` (github/awesome-copilot): только то, что относится к этому стеку. Порядок предпочтения: props компонента, `defaults`/тема в `createVuetify`, утилитарные классы Vuetify, `<style scoped>` компонента, `@layer vuetify-overrides`. Подробности API — скилл `vuetify-skilld` (`references/styling.md`, `references/configuration.md`, `references/migration-v4.md`).

Все примеры — только шаблоны правки: перед применением подтвердить, что Vuetify-класс или prop есть в установленной версии. Утилитарные классы (`text-truncate`, `text-no-wrap`, `text-break`, `text-medium-emphasis`, `ga-*`) взяты из документации Vuetify, в `vuetify-skilld` их нет, в этом репозитории не прогонялись [НЕ ПОДТВЕРЖДЕНО].

## Переполнение и обрезка текста

Утилитарные классы Vuetify вместо своего CSS:

```vue
<!-- было: длинный заголовок ломает карточку -->
<v-card-title>{{ title }}</v-card-title>

<!-- стало: одна строка с многоточием -->
<v-card-title class="text-truncate">{{ title }}</v-card-title>
```

Другие классы: `text-no-wrap`, `text-break` (перенос длинных слов). Для многострочной обрезки нужен свой CSS:

```vue
<style scoped>
.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
```

Flex-ряд, который не сжимается: `class="d-flex flex-wrap ga-2"`; дочернему элементу с текстом нужен `min-width: 0` (иначе `text-truncate` не срабатывает внутри flex).

## Сетка Vuetify 4

`v-row` теперь использует CSS `gap` вместо отрицательных полей.

```vue
<!-- было (v3) -->
<v-row dense align="center" justify="space-between">

<!-- стало (v4) -->
<v-row density="compact" class="align-center justify-space-between" gap="8">
```

Если разметка полагается на старое поведение, вернуть его можно только осознанно и в слое:

```css
@layer vuetify-overrides {
  .v-row {
    gap: unset;
    margin: calc(var(--v-col-gap-y) * -0.5) calc(var(--v-col-gap-x) * -0.5);
  }
}
```

## Типографика и elevation

Переименование: `h1`–`h3` → `display-*`, `h4`–`h6` → `headline-*`, `subtitle-1`/`body-1` → `body-large`, `caption` → `body-small`, `button`/`subtitle-2` → `label-large`. Elevation: 6 уровней (0–5) вместо 25 (0–24); старые значения переводятся на ближайший новый уровень (`migration-v4.md`).

## Контраст и цвета

Не менять hex «на глаз». Использовать токены темы:

```vue
<!-- было -->
<p style="color: #999">Подсказка</p>

<!-- стало -->
<p class="text-medium-emphasis">Подсказка</p>
```

Если токена нет, добавить цвет в тему (`createVuetify({ theme: { themes: { light: { colors: {...} }, dark: { colors: {...} } } } })`) для обеих тем, а не в компонент. Контраст проверять после правки: `tab.a11y()` и `tab.styles()`.

## Focus и состояния

Не убирать outline (`outline: none`) без замены. Для собственных интерактивных элементов вернуть видимый focus:

```vue
<style scoped>
.action:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
```

Vuetify-компоненты (`v-btn`, `v-text-field`) уже дают focus и состояния; если их не видно, чаще виновато `overflow: hidden` родителя или перекрывающий слой.

## Адаптивность

Сначала утилиты и props сетки (`cols`, `sm`, `md`, классы `d-none d-md-flex`), затем `useDisplay()` для логики, и только потом `@media` в scoped-стилях. Брейкпоинты Vuetify 4: `sm 600`, `md 840`, `lg 1145`, `xl 1545`, `xxl 2138`.

## Глобальные значения по умолчанию

Одна и та же правка в нескольких местах (например, у всех `v-btn` лишний `uppercase` или неверная плотность) — это `defaults`, а не правка каждого использования:

```ts
createVuetify({
  defaults: {
    VBtn: { density: 'comfortable', class: 'text-none' },
  },
});
```

`class` и `style` поддерживаются только в ключах конкретных компонентов, не в `global`. Значение `null` отключает глобальный default.

## Свой CSS поверх Vuetify

Стили Vuetify 4 лежат в каскадных слоях (`vuetify-core`, `vuetify-components`, `vuetify-overrides`, `vuetify-utilities`, `vuetify-final`); CSS вне слоя всегда выигрывает у Vuetify. Поэтому:

- достаточно обычного `<style scoped>` с классом компонента;
- для внутренностей Vuetify-компонента — `:deep(.v-field__input)` внутри `scoped`;
- `!important` не нужен; если он «понадобился», вероятно, конфликт слоёв (Tailwind, если появится): задать порядок слоёв явно (`@layer theme, base, vuetify, components, utilities;`).

## Иконки и шрифты

Пустые иконки: не подключён `@mdi/font` (или SVG-набор) в `preview` Storybook или в приложении. Текст в запасном шрифте: не подключён Roboto. Это правится в подключении плагина (`shared/ui/vuetify.ts` приложения, `.storybook/preview.ts`), а не в компонентах. В `apps/desktop` CSP должен разрешать шрифты (`font-src 'self'`), иначе они блокируются.

## После правки

Повторить тот же вьюпорт, тему и story, что показали проблему, сравнить скриншоты до и после, прогнать остальные stories компонента, затем `pnpm typecheck` и `pnpm lint`.
