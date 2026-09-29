---
name: storybook-vue-stories
description: Пишет Storybook stories (CSF 3, Storybook 10) для Vue 3 компонентов. Использовать при создании или правке `*.stories.ts`, при просьбе "напиши story / сторис для компонента", "подключи storybook", "покажи компонент в storybook", для UI-компонентов `@lms/ui` и `apps/desktop/src/shared/ui`. Write Storybook stories for Vue 3 components.
---

# Storybook stories для Vue 3

Формат — CSF 3 на Storybook 10 (`@storybook/vue3-vite`). Форма story взята из статьи https://habr.com/ru/articles/761570/ (кнопка: `argTypes` с контролами, story по варианту, story-сетка `Template` со `v-bind="args"`), но на актуальном API: в статье Storybook 7 (`StoryFn`, `Template.bind`, `defaultValue`), так писать не нужно.

Пример ниже собран и прогнан в отдельном Vue 3 + Vite 8 + Storybook 10.6 проекте: `storybook build` проходит, `vue-tsc` чистый, все stories отрисовываются, `play` выполняется и падает при неверном ассерте [ИЗМЕРЕНО]. Файл story проходит `eslint` и `prettier` репозитория.

## Порядок работы

1. Прочитать компонент: props (`defineProps`), события (`defineEmits`), слоты (`defineSlots` или `<slot>` в шаблоне), зависимости от Vuetify и провайдеров.
2. Проверить, что Storybook настроен (`.storybook/main.ts` в пакете, скрипт `storybook`). Если нет, см. «Подключение Storybook».
3. Создать `<Name>.stories.ts` рядом с компонентом (не в отдельной папке `stories/`).
4. Заполнить meta и набор stories по разделу «Какие stories писать».
5. Проверить по разделу «Проверка».

## Анатомия файла

```ts
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { expect, fn } from 'storybook/test';
import AppButton from './AppButton.vue';

const meta = {
  component: AppButton,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'radio', options: ['small', 'medium', 'large'] },
    color: { control: 'select', options: ['primary', 'secondary'] },
  },
  args: { disabled: false, size: 'medium', color: 'primary', onClick: fn() },
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: '<AppButton v-bind="args">Button</AppButton>',
  }),
} satisfies Meta<typeof AppButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = { args: { color: 'primary' } };
export const Secondary: Story = { args: { color: 'secondary' } };
export const Disabled: Story = { args: { disabled: true } };

export const Sizes: Story = {
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: `
      <div style="display: flex; gap: 12px;">
        <AppButton v-bind="args" size="large">Button</AppButton>
        <AppButton v-bind="args" size="medium">Button</AppButton>
        <AppButton v-bind="args" size="small">Button</AppButton>
      </div>
    `,
  }),
};

export const WithIcons: Story = {
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: `
      <AppButton v-bind="args">
        <template #left-icon>←</template>
        Button
        <template #right-icon>→</template>
      </AppButton>
    `,
  }),
};

export const EmitsClick: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button'));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
```

Компонент для этого примера (`AppButton.vue`) — `defineProps<Props>()` с JSDoc у props, `defineEmits<{ click: [event: MouseEvent] }>()`, `defineSlots<{ default(): unknown; 'left-icon'?(): unknown; 'right-icon'?(): unknown }>()`.

### Правила meta

- Импорты: `Meta`, `StoryObj`, `Preview`, `setup` — из `@storybook/vue3-vite`; `expect`, `fn`, `screen` — из `storybook/test`. Не `@storybook/vue3`, не `@storybook/test`.
- `satisfies Meta<typeof X>`, а не `as Meta`; `type Story = StoryObj<typeof meta>`. Так `args` проверяются по props компонента.
- `title` не задавать: Storybook строит его по пути файла. Задавать только осознанно и статической строкой (динамический `title` не читается при сборке).
- `tags: ['autodocs']` включает страницу документации, нужен `@storybook/addon-docs` в `addons`.
- `argTypes` только для того, что не выводится из типов: тип контрола (`radio`, `select`, `color`, `date`), `options`, `description` для того, что нельзя сказать JSDoc в компоненте. Описания props пишутся JSDoc-комментариями в самом компоненте: при `docgen: 'vue-component-meta'` они попадают в таблицу документации, defaults и типы событий и слотов выводятся сами.
- Значения по умолчанию задаются в `args` на уровне meta. `argTypes.defaultValue` из статьи не использовать.
- Общий `render` кладётся в meta, у story переопределяется только когда разметка отличается.
- Обработчики событий: `onClick: fn()` в `args` (props вида `onXxx` для события `xxx`). В Actions/Interactions виден вызов, в `play` — проверка.
- Имена story — UpperCamelCase, по смыслу состояния (`Disabled`, `WithIcons`), не по значению arg. Русское имя в панели — через `name: '...'`.

## Какие stories писать

|Story|Когда|Как|
|---|---|---|
|`Default`|всегда|`{}` — всё берётся из meta|
|по варианту (`Primary`, `Secondary`)|у props есть enum/union, влияющий на вид|`args: { color: 'secondary' }`|
|состояние (`Disabled`, `Loading`, `Error`, `Empty`)|у компонента есть состояние|`args` с нужным prop|
|сетка (`Sizes`, `AllColors`)|нужно сравнить варианты рядом|свой `render`: несколько экземпляров, у каждого `v-bind="args"` и своё переопределение|
|слоты (`WithIcons`)|есть именованные слоты|свой `render` с `<template #name>`|
|события/взаимодействие (`EmitsClick`)|компонент реагирует на ввод|`play` + `fn()`; DOM через `canvas`, ввод через `userEvent`|
|длинный контент, пусто, RTL|ломается вёрстка|`args` с крайним значением|

Не плодить stories «для галочки»: каждая — реальное состояние или сравнение. Если компонент без props и слотов, хватит `Default`.

Слоты в примере заданы через `render` с шаблоном, как в статье: это работает независимо от docgen. Слот в `args` не полагать рабочим без проверки на своём компоненте [НЕ ПОДТВЕРЖДЕНО].

`play`: контекст даёт `args`, `canvas`, `userEvent`, `context`. Для содержимого вне корня story (диалог, меню Vuetify телепортируются в `body`) — `screen` из `storybook/test`, а не `canvas`. Одну story можно переиспользовать: `await Other.play!(context)`.

## Vuetify и провайдеры

Vuetify-компоненту нужны плагин и корневой `<v-app>`. Без них story падает.

`.storybook/preview.ts`:

```ts
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { setup } from '@storybook/vue3-vite';
import type { Preview } from '@storybook/vue3-vite';
import { createVuetify } from 'vuetify';

setup((app) => {
  app.use(createVuetify({}));
});

const preview: Preview = {
  decorators: [
    (story) => ({
      components: { story },
      template: '<v-app><v-main><story /></v-main></v-app>',
    }),
  ],
  parameters: { layout: 'centered' },
};

export default preview;
```

`vite.config.ts` Storybook должен подхватывать `vite-plugin-vuetify` (после `@vitejs/plugin-vue`): если конфиг пакета его содержит, Storybook берёт этот файл сам. Пример выше собран именно так [ИЗМЕРЕНО]. Всё, что приложение регистрирует глобально (`app.use`, `app.component`, `provide`), регистрируется и в `setup((app) => ...)`, иначе story отличается от приложения. Остальные Vuetify-вызовы — по скиллу `vuetify-skilld`.

`@lms/ui` держит Vuetify как peer: `createLmsVuetify()` лежит в приложении (`apps/desktop/src/shared/ui`), поэтому в `.storybook/preview.ts` пакета плагин создаётся локально через `createVuetify`, приложение из пакета не импортировать.

## Репозиторий

- Язык: код и идентификаторы английские, комментарии и JSDoc-описания props — русские, как в остальном репозитории.
- Стиль: скилл `js-conventions`, Prettier 80 колонок, одинарные кавычки, точки с запятой. Шаблон в `template` — обычная строка или шаблонный литерал.
- Имена компонентов из нескольких слов (`AppButton`, не `Button`): правило `vue/multi-word-component-names` включено, а `<Button>` ещё и путается с нативным `<button>`.
- Расположение: `packages/ui/src/<component>/<Name>.stories.ts` для сложных компонентов `@lms/ui`; в приложении — рядом с компонентом, в `ui`-сегменте слайса (`skill://feature-sliced-design`). Story не экспортируются из `index.ts` слайса и не импортируют слои выше своего.
- Story исключаются из сборки типов библиотеки: `"exclude": ["src/**/*.stories.ts"]` в `tsconfig.json` пакета (`emitDeclarationOnly`, иначе `.d.ts` генерируются и для них). Типы самих stories проверяются отдельным проектом (`tsconfig.stories.json`), добавленным в `typecheck` пакета.
- `play` — интеракционный тест внутри Storybook; unit-тесты Vitest остаются отдельно и не дублируют `play`.

## Подключение Storybook (если ещё нет)

В репозитории Storybook на момент написания скилла не установлен. Официальная установка для Vue + Vite: `pnpm create storybook@latest` в каталоге пакета (`packages/ui` или `apps/desktop`). Затем:

- удалить сгенерированные примеры (`src/stories`);
- в `.storybook/main.ts`: `stories: ['../src/**/*.stories.ts']`, `addons: ['@storybook/addon-docs']`, `framework: { name: '@storybook/vue3-vite', options: { docgen: 'vue-component-meta' } }`; `vue-docgen-api` по умолчанию объявлен устаревшим с 10.6;
- если у пакета `tsconfig` с references, указать `docgen: { plugin: 'vue-component-meta', tsconfig: '<файл>' }`, иначе не будут видны типы и алиасы;
- `core: { disableTelemetry: true }` в `main.ts`, если телеметрия не нужна;
- скрипты `storybook` и `build-storybook` в `package.json` пакета; из корня: `pnpm -F <имя> storybook`;
- `storybook-static` добавить в `.gitignore`, `.prettierignore` и `ignores` в `eslint.config.js`.

Установка меняет зависимости, скрипты и конфиги: делать в ветке `feature/*` и показать пользователю список изменений.

## Проверка

1. `pnpm typecheck` и `pnpm lint` (stories линтуются как обычные `.ts`).
2. `pnpm -F <пакет> build-storybook` проходит без ошибок.
3. Открыть story в браузере (`storybook` или собранный `storybook-static`, `iframe.html?id=<story-id>&viewMode=story`): текст отрисован, консоль без ошибок. Id story: `<путь-в-нижнем-регистре>--<имя-story-в-kebab-case>`, список — `index.json` в `storybook-static`.
4. `play`: провал в iframe не показывается оверлеем, только событием канала `playFunctionThrewException` (или в панели Interactions). Проверять в панели Interactions или подпиской на `window.__STORYBOOK_ADDONS_CHANNEL__` с `forceRemount`. Ассерт, который не может упасть, ничего не доказывает: убедиться, что при неверном ожидании story красная.
5. Страница Docs (`autodocs`): таблица props, events, slots заполнена, контролы работают.

## Чего не делать

- `StoryFn`, `Template.bind({})`, `Story.args = ...`, `argTypes.defaultValue`, `as Meta`: API статьи, заменено выше.
- Стили и разметка story-обёртки «для красоты»: только то, что нужно для сравнения вариантов.
- Данные из движка и IPC внутри story: передавать через `args`/моки, story не должна требовать запущенного Electron.
- Копировать в story логику компонента: story показывает компонент, а не заменяет его.
