# Расширения

Расширение — каталог с манифестом `extension.json`, который добавляет приложению один или несколько вкладов (точек вклада): виды заданий, темы оформления, рендереры блоков кода в Markdown, правила оценки. Любой вид задания (SQL, выбор варианта, дальше — перетаскивание, сопоставление) — расширение: ядро движка знает только конверт «вид + spec + ответ → вердикт», содержимое видов ему непрозрачно. Решение и его причины — `docs/adr/0001-exercise-types-as-extensions.md`; форма расширения для авторов и принятый риск безопасности — `docs/adr/0002-authoring-simplicity-over-isolation.md`.

## Что такое расширение

Каталог с манифестом `extension.json` и файлами вкладов. Расширение может вносить любую комбинацию из четырёх точек (`contributes.exerciseTypes`, `themes`, `markdownRenderers`, `gradePolicies`, раздел «Точки вклада»). Код для процесса расширений (`main`, ES-модуль `.mjs`) нужен только вкладам `exerciseTypes` и `gradePolicies`; у расширения из одних тем и рендереров содержимого `main` — `null`, и `src/main.ts` писать не нужно. Ниже — расширение с видом задания: JSON Schema для `spec` и ответа лежат в файлах или записаны прямо в манифесте, элемент ввода ответа (`renderer`) определяет custom element:

```
lms.choice/
  extension.json
  main.mjs            # export default { activate(ctx), deactivate? }
  view.mjs            # определяет custom element ввода ответа
```

Минимальный манифест:

```json
{
  "id": "lms.choice",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "exerciseTypes": [
      {
        "id": "lms.choice",
        "specSchema": { "type": "object", "required": ["options", "correct"] },
        "answerSchema": "./schema/answer.json"
      }
    ]
  }
}
```

Умолчания (`normalizeManifest`): `main` — `./main.mjs`; `renderer` — `./view.mjs`; `element` — `id` вида с точками, заменёнными на дефисы, и суффиксом `-answer` (`lms.choice` → `lms-choice-answer`). Явные значения важнее умолчаний. `specSchema` и `answerSchema` — либо путь к `.json` внутри каталога, либо непустая схема объектом. Формат один: после разбора манифест всегда нормализован.

Правила манифеста проверяет `parseManifest` (`packages/extension-host/src/manifest.ts`): `id` — `[a-z][a-z0-9-]*(.[a-z][a-z0-9-]*)*`; `id` вида равен `id` расширения или начинается с `<id>.`; `main` — `.mjs`, `renderer` — `.js` или `.mjs`; выведенный или явный `element` — допустимое имя тега (с дефисом); все пути относительные и внутри каталога; `apiVersion` — `1`. Неизвестные ключи `contributes` отклоняются: расширение с более новой точкой вклада не загрузится в старом приложении. Имя каталога равно `id`. Если файл по умолчанию (`main.mjs`, `view.mjs`) отсутствует, диагностика называет его и помечает как умолчание.

Типы и константы API — пакет `@lms/extension-api`.

## Код расширения

Ниже — низкоуровневый API `ExtensionModule`. Писать расширение проще через SDK: `defineExtension` и `defineAnswerElement` (раздел «Как написать расширение»).

```ts
export default {
  activate(ctx) {
    ctx.registerExerciseType('lms.choice', {
      project: ({ spec }) => ({ options: spec.options }), // публичный вид, без ключей ответов
      grade: ({ spec, answer, timeoutMs, authorMode }) => ({
        outcome: 'passed',
      }),
      referenceAnswer: ({ spec }) => spec.correct, // для проверки компилятором
    });
  },
};
```

`ctx` даёт `extensionId`, `logger`, `library` (`readText`/`stat` по библиотеке курсов) и `registerExerciseType`. Тип обязан быть объявлен в манифесте. Активация ленивая: по первому запросу к виду, отказ активации запоминается до перезапуска процесса.

`grade` возвращает `GradeResult`: `passed`, `failed` (вина ученика: `reason`, необязательно `feedback`, `detail` — только в режиме автора) или `error` (не вина ученика, попытка не тратится). Причины `failed`/`error` — открытые строки расширения; причины хоста (`timeout`, `resource_kill`, `worker_crash`, `internal`) порождает хост. Оценку FSRS считает ядро по `outcome` (`GradePolicy`); расширение её не выставляет.

## Элемент ввода ответа

Custom element (тег из `element`) в shadow DOM, определяется модулем `renderer`. Приложение выставляет свойства `view` (результат `project`), `value`, `disabled`, `verdict` и слушает события `lms-answer-change` (`detail: { value, complete }`) и `lms-answer-submit`. Кнопку «Проверить», подсказки и вердикт рисует приложение. Строки интерфейса приложения расширению недоступны: текст в элементе — данные задания или `aria-label` от приложения. Цвета берутся из CSS-переменных темы (`--v-theme-*`).

## Процессы

```
renderer ── MessagePort ──► движок (utilityProcess «lms-engine»)
                              │  ExerciseTypes: describe/validate (манифесты, Ajv)
                              │  project / grade / referenceAnswer — MessageChannelMain
                              ▼
                            хост расширений (utilityProcess «lms-ext-host»)
                              │  runtime: activate, обработчики, воркеры (lms.sql: fork)
```

- Канал движок ↔ хост расширений создаёт main (`host-link.ts`); при перезапуске любого процесса выдаётся новая пара портов.
- Клиент в движке (`createRemoteExerciseTypes`) держит дедлайн `timeoutMs + 2 с` на `grade`. Синхронный цикл в расширении не прервать, поэтому по дедлайну клиент отдаёт `error/timeout` и просит main перезапустить хост (`restart-ext-host`). Закрытие канала во время `grade` — `error/worker_crash`.
- Хост расширений перезапускается с backoff; после `MAX_CRASHES` падений за минуту перезапуск прекращается, приложение продолжает работать (карточки), вызовы видов получают `EXERCISE_TYPE_UNAVAILABLE`.

## Обнаружение

Два корня: расширения из поставки (`Resources/extensions`, в разработке — `<outRoot>/extensions`, read-only) и пользовательские (`<userData>/extensions`). Подкаталог с `extension.json` — расширение. Одинаковый `id` в обоих корнях — побеждает пользовательское (лог `info`). Повторный id вида, id темы или правила оценки, `element` или язык рендерера содержимого у разных расширений: первое выигрывает, второе пропускается целиком с предупреждением. Расширения подхватываются при запуске. «Настройки → Расширения» показывает каждое расширение, его вклады по точкам и причину, по которой оно не загрузилось или было перекрыто.

Скрипт элемента отдаёт протокол `lms-ext://<id>/<путь>`: только `.js`/`.mjs` внутри каталога расширения, пользовательский корень приоритетнее. CSP приложения содержит `script-src 'self' lms-ext:`.

## Авторинг

Упражнение объявляет вид в `engine.exercise`:

```yaml
engine:
  exercise:
    type: lms.sql
    timeoutMs: 2000 # необязательно, по умолчанию 2000
    spec:
      fixture: fixtures/emp.sql
      expected: checks/join.csv
      reference: solutions/join.sql
```

Компилятор проверяет `spec` по схеме вида (`E_EXERCISE_SPEC`), сообщает о неизвестном виде (`W_UNKNOWN_EXERCISE_TYPE`) и прогоняет эталон: `referenceAnswer` → `grade` (`E_REFERENCE_FAILS`). CLI: `engine-cli validate <библиотека> --run-checks --extensions <каталог-корень>` (флаг повторяемый; без него проверки видов пропускаются, а `--run-checks` требует его).

Ответ ученика не попадает в журнал как есть: журнал хранит оценку и источник (`runner`); `spec` и ключи ответов в renderer не уходят — там только `task { type, timeoutMs, element, rendererUrl }` и `view` из `project`.

## Точки вклада

Манифест может содержать любые из четырёх ключей `contributes`; пропущенный ключ — пустой список. Неизвестный ключ отклоняется. Во всех точках с `id`: `id` равен id расширения или начинается с `<id расширения>.`. Каждый пример в этом разделе, помеченный строкой `Файл ...`, проверяется тестом `packages/extension-tools/test/docs-contributions.test.ts`.

### Виды заданий (`exerciseTypes`)

Что даёт ученику: новый способ отвечать на упражнение — свой элемент ввода и проверка кодом расширения (подробности — разделы выше и «Как написать расширение»). Упражнение выбирает вид в `engine.exercise.type`.

Файл `extension.json` (вид задания):

```json
{
  "id": "acme.echo",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "exerciseTypes": [
      {
        "id": "acme.echo",
        "specSchema": {
          "type": "object",
          "required": ["expected"],
          "properties": { "expected": { "type": "string" } }
        },
        "answerSchema": { "type": "string" }
      }
    ]
  }
}
```

Код — `defineExtension({ exerciseTypes: { 'acme.echo': { project, grade, referenceAnswer? } } })`. Пользователь видит вид в экране упражнения (элемент ввода) и в «Настройки → Расширения». Нужен `main` и, если не задан иной, `view.mjs` с элементом.

### Темы (`themes`)

Что даёт ученику: плитка темы в «Настройки → Внешний вид» рядом с «Как в системе», «Светлая», «Тёмная». Тема — только данные, кода нет (`main` — `null`).

Файл `extension.json` (тема):

```json
{
  "id": "acme.midnight",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "themes": [
      {
        "id": "acme.midnight",
        "label": "Полночь",
        "dark": true,
        "colors": {
          "background": "#101820",
          "surface": "#1B2733",
          "primary": "#FFB000",
          "on-primary": "#101820"
        },
        "variables": { "border-opacity": 0.2 }
      }
    ]
  }
}
```

Правила:

- `id` не из встроенных (`system`, `light`, `dark`); `label` — 1–60 символов; `dark` — тёмная ли тема (влияет на базовые цвета Vuetify).
- `colors` — непустой объект; значения — строго `#rrggbb` или `#rrggbbaa`. Разрешённые ключи (`THEME_COLOR_KEYS`): `background`, `surface`, `surface-bright`, `surface-light`, `surface-variant`, `on-background`, `on-surface`, `on-surface-variant`, `primary`, `on-primary`, `secondary`, `on-secondary`, `error`, `on-error`, `warning`, `on-warning`, `success`, `on-success`, `info`, `on-info`, `hero-start`, `hero-end`, `hero-contrast`. Любой другой ключ — ошибка манифеста.
- `variables` — необязательно. Разрешённые ключи (`THEME_VARIABLE_KEYS`): `border-color` (цвет `#rrggbb`/`#rrggbbaa`), `border-opacity`, `medium-emphasis-opacity`, `high-emphasis-opacity`, `disabled-opacity` (числа от 0 до 1).

### Рендереры содержимого (`markdownRenderers`)

Что даёт ученику: блоки кода ` ```<language> ` в тексте заданий и уроков выводит расширение (например, `lms.math` рисует формулы из блоков ` ```math `). Без расширения такой блок остаётся обычным кодом.

Файл `extension.json` (рендерер содержимого):

```json
{
  "id": "acme.shout",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "markdownRenderers": [{ "language": "shout" }]
  }
}
```

`language` — `[a-z][a-z0-9-]{0,31}`, один язык — одно расширение. `renderer` — путь к `.js`/`.mjs`, по умолчанию `./markdown.mjs` (в проекте `lms-ext` — `src/markdown.ts`, браузерный бандл). Модуль — `export default` с методом `render(source, container, context)`; `defineMarkdownRenderer` задаёт эту форму:

Файл `src/markdown.ts` (рендерер содержимого):

```ts
import { defineMarkdownRenderer } from '@lms/extension-sdk';

export default defineMarkdownRenderer((source, container) => {
  const pre = container.ownerDocument.createElement('pre');
  pre.textContent = source.toUpperCase();
  container.replaceChildren(pre);
});
```

`context` — `{ language, signal }`: по `signal` (структурный `AbortSignal`) отменяется вывод при уходе со страницы. Модуль загружается в окне приложения по `lms-ext://` (общий JS-контекст, как у элементов ввода ответа). Если модуль не загрузился, не имеет `render()` или `render` бросил исключение, блок остаётся исходным текстом, под ним показывается заметка «Не удалось вывести блок…», страница работает дальше.

### Правила оценки (`gradePolicies`)

Что даёт ученику: в «Настройки → Обучение» (группа «Оценка», «Правило оценки») кроме встроенного `passAtN` появляется правило расширения. Оценка FSRS 1–5 за закрытую попытку считается выбранным правилом; выбор хранится в настройках.

Файл `extension.json` (правило оценки):

```json
{
  "id": "acme.policy",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "gradePolicies": [{ "id": "acme.policy.generous", "label": "Щедрое" }]
  }
}
```

Файл `src/main.ts` (правило оценки):

```ts
import { defineExtension } from '@lms/extension-sdk';

export default defineExtension({
  gradePolicies: {
    'acme.policy.generous': ({ verdicts, gaveUp }) => {
      if (gaveUp) return 1;
      return verdicts.some(({ outcome }) => outcome === 'passed') ? 5 : null;
    },
  },
});
```

Контракт:

- Вход — `GradePolicyInput`: `verdicts` (вердикты попытки по порядку: `{ outcome: 'passed' | 'failed' | 'error', reason? }`) и `gaveUp` («Сдаться»).
- Результат — целое 1–5 или `null` («правило оценки не ставит, нужна самооценка»); можно вернуть промис.
- `id` — не `passAtN` (занят встроенным правилом), `label` — 1–60 символов; правило в коде регистрируется под тем же `id` (`registerGradePolicy`, в SDK — ключ `gradePolicies` в `defineExtension`). Нужен `main`.
- Любой сбой правила — хост недоступен, исключение, дедлайн 2 с (`POLICY_DEADLINE_MS` в `packages/extension-host/src/client.ts`), результат вне 1–5 и не `null`, расширение пропало — даёт предупреждение в лог и оценку по `passAtN` (`resolveGradePolicy`); закрытие попытки не зависит от чужого кода. Если выбранное правило пропало, экран настроек показывает, что действует Pass@N.
- Проверить правило без приложения: `loadGradePolicy` из `@lms/extension-sdk/testing`.

### Как добавить новую точку вклада

Для разработчиков платформы: точка — один модуль в `packages/extension-host/src/points/` (`ContributionPoint`: zod-схема записи, `normalize`, `check`, `resolve` файлов, `claims` для конфликтов, `needsMain`), который добавляется в список `CONTRIBUTION_POINTS` (`points/index.ts`); типы записи и ключ манифеста — в `@lms/extension-api`. Если данные нужны окну приложения, добавьте поле в `ContributionsDto` и отдавайте его через порт `ExtensionRegistry.contributions()`; если нужен вызов кода расширения — метод в протоколе `protocol.ts`, регистрация в `ExtensionContext` и порт в `@lms/engine`, как у `GradePolicies`.

## Как написать расширение

Расширение — каталог с `extension.json`, кодом для процесса расширений (`main.mjs`) и, при необходимости, элементом ввода ответа (`view.mjs`). Писать его удобнее всего на TypeScript с [`@lms/extension-sdk`](../../packages/extension-sdk/README.md), собирать — [`lms-ext`](../../packages/extension-tools/README.md).

### Быстрый старт

Из корня репозитория:

```sh
pnpm create-extension ~/projects/acme-hello --local .
cd ~/projects/acme-hello
pnpm install
pnpm test
pnpm dev # lms-ext build --watch
```

`--local <корень>` подключает `@lms/extension-sdk` и `@lms/extension-tools` как `link:<корень>/packages/...` (пакеты не опубликованы; без флага в `package.json` попадёт условное `^0.0.0`, и генератор напечатает предупреждение). Id по умолчанию — kebab-case имени каталога, задаётся флагом `--id`. Во втором терминале запустите приложение с каталогом сборки:

```sh
LMS_DEV_EXTENSIONS=~/projects/acme-hello/dist-ext pnpm dev
```

Правка исходника пересобирает бандл, приложение перезапускает хосты и перезагружает окно (см. «Режим разработчика» ниже).

### Раскладка проекта

```
acme-hello/
  extension.json      # манифест
  src/main.ts         # defineExtension: код вида задания (utilityProcess)
  src/view.ts         # defineAnswerElement: элемент ввода ответа (окно)
  test/               # vitest: обработчик без приложения и элемент в happy-dom
  package.json  tsconfig.json  README.md  .gitignore
  dist-ext/acme.hello/  # результат сборки (extension.json, main.mjs, view.mjs)
```

Схемы `spec` и ответа можно писать объектами прямо в манифесте или путями к файлам в `schema/`; `main`, `renderer` и `element` по умолчанию — `./main.mjs`, `./view.mjs` и `<id без точек>-answer`.

### Минимальный манифест и код

Так выглядит проект, который создаёт генератор для id `acme.hello` (вид «text match»: ответ сравнивается с `spec.expected`).

`extension.json`:

```json
{
  "id": "acme.hello",
  "version": "0.1.0",
  "apiVersion": 1,
  "contributes": {
    "exerciseTypes": [
      {
        "id": "acme.hello",
        "specSchema": {
          "type": "object",
          "required": ["expected"],
          "additionalProperties": false,
          "properties": {
            "expected": { "type": "string", "minLength": 1 },
            "ignoreCase": { "type": "boolean" }
          }
        },
        "answerSchema": { "type": "string" }
      }
    ]
  }
}
```

`src/main.ts`:

```ts
import { defineExerciseType, defineExtension } from '@lms/extension-sdk';

interface Spec {
  expected: string;
  ignoreCase?: boolean;
}

const matches = (answer: string, spec: Spec): boolean => {
  if (spec.ignoreCase === true) {
    return answer.toLowerCase() === spec.expected.toLowerCase();
  }
  return answer === spec.expected;
};

// схемы из extension.json уже проверили spec и ответ до вызова обработчиков
export default defineExtension({
  exerciseTypes: {
    'acme.hello': defineExerciseType<Spec, string, Record<string, never>>({
      project: () => ({}),
      grade: ({ spec, answer }) =>
        matches(answer, spec)
          ? { outcome: 'passed' }
          : { outcome: 'failed', reason: 'mismatch' },
      referenceAnswer: ({ spec }) => spec.expected,
    }),
  },
});
```

Элемент ввода `src/view.ts` — обычное поле `<input>` внутри shadow DOM (`defineAnswerElement('acme-hello-answer', mount)`); полный текст — в сгенерированном проекте.

### Шпаргалка по SDK

- `defineExtension({ exerciseTypes, activate?, deactivate? })` — готовый модуль расширения (`export default` в `main.ts`): виды из `exerciseTypes` регистрируются сами, при `deactivate` освобождаются.
- `defineExerciseType<Spec, Answer, View>({ project, grade, referenceAnswer? })` — типизированный обработчик. `project` отдаёт элементу публичный вид задания (без ключей ответа); `grade` возвращает `{ outcome: 'passed' }`, `{ outcome: 'failed', reason, detail? }` или `{ outcome: 'error', reason }`; `referenceAnswer` — эталон для проверки библиотеки компилятором. К моменту вызова `grade` `spec` и ответ уже проверены схемами из манифеста.
- `defineAnswerElement(tag, mount)` — определяет custom element с shadow DOM. `mount(api, props)` получает `api.root`, `api.label` (`aria-label` от приложения), `api.setAnswer(value, complete)` и `api.submit()`, возвращает `{ update(props), destroy?() }`; `props` — `view`, `value`, `disabled`, `verdict`.
- `@lms/extension-sdk/testing`: `loadExerciseType(module, type)` запускает `project`/`grade`/`referenceAnswer` без приложения и проверяет форму результата; `createSchemaValidator(schema)` — проверка `spec` и ответа по своим схемам; `createMemoryLibrary(files)` — библиотека в памяти для видов, читающих файлы курса.

### Сборка и проверка

```sh
pnpm build     # lms-ext build → dist-ext/<id>
pnpm validate  # lms-ext validate dist-ext/<id>
pnpm test
```

`lms-ext validate` разбирает манифест тем же кодом, что приложение (`inspectExtensionDir`), и завершается кодом 1 при проблеме. Подробности, дополнительные входы и внешние пакеты — в README `@lms/extension-tools`.

### Режим разработчика

`LMS_DEV_EXTENSIONS=<каталог>` добавляет корень расширений `dev` с наивысшим приоритетом. Для проекта это `<проект>/dist-ext`; `pnpm dev` (`lms-ext build --watch`) пересобирает бандлы, приложение по правке файла перезапускает хосты и перезагружает окно. Манифест и схемы копируются один раз — после их правки перезапустите `pnpm dev`. Причины, по которым расширение не загрузилось, видны в «Настройки → Расширения».

### Установка вручную

Скопируйте `dist-ext/<id>` в `<userData>/extensions/` и перезапустите приложение. Совпадение id с расширением из поставки — побеждает пользовательское.

### Текущие ограничения

- Установки из приложения (по адресу, из архива, каталог) пока нет: расширение — каталог, установка — копирование.
- Прав (`permissions`) нет: код расширения исполняется с правами пользователя, элемент ввода и рендереры содержимого — в общем JS-контексте приложения.
- Точек вклада четыре (раздел «Точки вклада»); расширения подхватываются при запуске приложения.

## Расширения по умолчанию

`lms.sql` (`packages/ext-sql`, раннер SQL из `@lms/engine-sql-runner` в дочерних процессах, воркер `worker.mjs`) и `lms.choice` (`packages/ext-choice`, один или несколько верных вариантов) — проекты `lms-ext` (`extension.json`, `src/main.ts`, `src/view.ts`, `schema/`; у `ext-sql` ещё `lms-ext.config.json` с воркером и внешним `better-sqlite3`): `pnpm -F <пакет> build` (`lms-ext build`, `@lms/extension-tools`) собирает тем же кодом, что и у сторонних авторов, каталог `dist-ext/<id>/`. Плагин Vite `lms:extensions` (`apps/desktop/vite.config.ts`) собирает все `packages/ext-*` и копирует единственный каталог `dist-ext/<id>/` в `<outRoot>/extensions/<id>/` (имя каталога должно совпасть с `id` манифеста); упаковка кладёт его в `Resources/extensions` (`extraResources`).

`lms.math` (`packages/ext-math`) — расширение без кода для процесса расширений: вклад `markdownRenderers` для языка `math` (блоки ` ```math `, формулы TeX рисует MathJax в SVG); собирается так же, как остальные.

## Границы

- Нет песочницы и прав: код расширения исполняется с правами пользователя, renderer-часть — в общем JS-контексте приложения. Безопасность держится на том, что каталог `<userData>/extensions` наполняет сам пользователь.
- Нет установки и скачивания: расширение = каталог, установка = копирование.
- Точек вклада четыре: `exerciseTypes`, `themes`, `markdownRenderers`, `gradePolicies`. Команды, панели, импорт/экспорт, планировщик и модель памяти расширениями не задаются.
- Изоляции нет (ни песочницы, ни отдельных прав для вкладов): это следующая работа.
