# Расширения: виды заданий

Любой вид задания (SQL, выбор варианта, дальше — перетаскивание, сопоставление) — расширение. Ядро движка знает только конверт «вид + spec + ответ → вердикт», содержимое видов ему непрозрачно. Решение и его причины — `docs/adr/0001-exercise-types-as-extensions.md`.

## Что такое расширение

Каталог с манифестом `extension.json`, кодом проверки (`main`, ES-модуль `.mjs`) и элементом ввода ответа (`renderer`). JSON Schema для `spec` и ответа лежат в файлах или записаны прямо в манифесте:

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

```ts
export default {
  activate(ctx) {
    ctx.registerExerciseType('lms.choice', {
      project: ({ spec }) => ({ options: spec.options }), // публичный вид, без ключей ответов
      grade: ({ spec, answer, timeoutMs, authorMode }) => ({ outcome: 'passed' }),
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

Два корня: расширения из поставки (`Resources/extensions`, в разработке — `<outRoot>/extensions`, read-only) и пользовательские (`<userData>/extensions`). Подкаталог с `extension.json` — расширение. Одинаковый `id` в обоих корнях — побеждает пользовательское (лог `info`). Повторный id вида или `element` у разных расширений: первое выигрывает, второе пропускается с предупреждением. Расширения подхватываются при запуске.

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

## Расширения по умолчанию

`lms.sql` (`packages/ext-sql`, раннер SQL из `@lms/engine-sql-runner` в дочерних процессах, воркер `worker.mjs`) и `lms.choice` (`packages/ext-choice`, один или несколько верных вариантов) собираются `pnpm -F <пакет> build` в `dist-ext/`. Плагин Vite `lms:extensions` (`apps/desktop/vite.config.ts`) собирает все `packages/ext-*` и копирует в `<outRoot>/extensions/<id>/`; упаковка кладёт каталог в `Resources/extensions` (`extraResources`).

## Границы

- Нет песочницы и прав: код расширения исполняется с правами пользователя, renderer-часть — в общем JS-контексте приложения. Безопасность держится на том, что каталог `<userData>/extensions` наполняет сам пользователь.
- Нет установки и скачивания: расширение = каталог, установка = копирование.
- Из точек вклада есть только `exerciseTypes`.
