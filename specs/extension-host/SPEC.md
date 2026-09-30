---
status: active
branch: feature/extension-host
created: 2026-09-30
closed: null
touches:
  [
    engine-contract,
    engine,
    engine-rpc,
    engine-sql-runner,
    testkit,
    extension-api,
    extension-host,
    ext-sql,
    ext-choice,
    desktop,
  ]
depends-on: []
supersedes: null
superseded-by: null
---

# Расширения и хост расширений: виды заданий

Живой документ, пока `status` — `draft` или `active`: `Progress`, `Surprises & Discoveries`, `Decision Log` обновляются вместе с кодом. По завершении фичи переносится в `specs/archive/` и не меняется. Правила — скилл `spec-workflow`.

## Цель

Любой вид задания (SQL, выбор варианта, дальше — перетаскивание, сопоставление и т. д.) приходит из расширения, а не из кода движка: расширение — каталог с манифестом, кодом проверки и элементом ввода ответа. Виды по умолчанию (`lms.sql`, `lms.choice`) — тоже расширения-каталоги, поставляемые вместе с приложением; пользователь может положить свои в `<userData>/extensions`. Код расширений работает в отдельном процессе, поэтому сбой расширения не роняет движок и приложение.

## Не цели

- Установка и скачивание расширений (URL, архив, каталог расширений в интерфейсе): расширение — каталог, установка — копирование.
- Песочница и права (`permissions`): пользовательский код исполняется с правами пользователя, renderer-часть — в общем JS-контексте.
- Горячая перезагрузка расширений: они подхватываются при запуске.
- Другие точки вклада (`contributes`), кроме `exerciseTypes`: темы, рендереры контента, импортёры, политики оценки, панели.
- Локализация сообщений расширений (`l10n`): текст вердикта — данные расширения.

## Требования

Наблюдаемое поведение, не реализация. У каждого требования есть проверка.

- R1. Упражнение с блоком `engine.exercise: { type, timeoutMs?, spec? }` проверяется расширением, объявившим вид `type`: `beginAttempt` возвращает `view` (результат `project`), `submitAnswer` принимает `answer` и возвращает вердикт расширения. Проверка: unit `attempts.test.ts` с фейком видов; `pnpm smoke` (сценарии `sql`, `choice`); e2e «виды заданий».
- R2. `lms.sql` и `lms.choice` поставляются каталогами расширений (`extension.json`, `main.mjs`, `view.mjs`, `schema/*.json`; у `lms.sql` ещё `worker.mjs`) вне кода приложения: в разработке — `<outRoot>/extensions`, в упаковке — `Resources/extensions`. Проверка: `apps/desktop/test/release-bundle.test.ts` (оба каталога на месте и находятся без диагностик); `pnpm smoke:packaged`.
- R3. Пользовательское расширение из `<userData>/extensions/<id>/` загружается тем же кодом; при совпадении id с расширением из поставки побеждает пользовательское. Проверка: `discover.test.ts` (переопределение); e2e: `acme.echo` проходит упражнение, копия `lms.choice` версии `1.0.1` переопределяет встроенную.
- R4. Код расширений исполняется в отдельном `utilityProcess` (`lms-ext-host`). Падение процесса во время проверки даёт вердикт `error/worker_crash`, зависание — `error/timeout` с перезапуском хоста; движок и приложение продолжают работать, следующая проверка после перезапуска проходит; повторные падения (больше `MAX_CRASHES` за минуту) прекращают перезапуск, но не завершают приложение. Проверка: `extension-host` `process.test.ts`, `client.test.ts`; `ext-supervisor.test.ts`; вручную `pkill -f lms-ext-host` при открытом SQL-упражнении.
- R5. Ключи ответов не попадают в renderer: `ExerciseDto` содержит только `task { type, timeoutMs, element, rendererUrl }`, а `AttemptDto.view` — результат `project` расширения. Проверка: `dto.test.ts`, `attempts.test.ts`; тест `ext-choice` (`project` не отдаёт `correct`).
- R6. Компилятор проверяет упражнения по схеме вида: `spec` не по схеме — `E_EXERCISE_SPEC`; вид неизвестен установленным расширениям — `W_UNKNOWN_EXERCISE_TYPE`; эталон (`referenceAnswer`) не проходит собственную проверку — `E_REFERENCE_FAILS`. Проверка: `checks.test.ts`, `reference-check.test.ts`; `engine-cli validate <библиотека> --run-checks --extensions <каталог>`.
- R7. Контракт: `submitAnswer({ attemptId, answer })`, причины вердикта — открытые строки, данные расширения — `data`, `CONTRACT_VERSION = 2`; блок `engine.verification` удалён, библиотеки `sql-course` мигрированы на `engine.exercise`. Проверка: `pnpm typecheck`, `engine-rpc` тесты, golden-тесты `sql-course`.
- R8. Ввод ответа — custom element в shadow DOM, определяемый модулем `view.mjs` расширения и подгружаемый по `lms-ext://` под CSP приложения; контракт — свойства `view`/`value`/`disabled`/`verdict` и события `lms-answer-change`/`lms-answer-submit`. SQL-задание вводится в textarea с Ctrl/⌘+Enter, выбор — радио/чекбоксами. Проверка: e2e (ввод и проверка ответов SQL, choice и `acme.echo`).

## Решения

**Расширение = каталог с `extension.json`.** Манифест: `id`, `version`, `apiVersion: 1`, `main` (`.mjs`, `export default` — `ExtensionModule`), `contributes.exerciseTypes[]` (`id`, `specSchema`, `answerSchema` — пути к JSON Schema 2020-12, `element`, `renderer`). Отдельный файл, а не `package.json`: рантайм не зависит от семантики npm, установка — копирование. Типы и константы — пакет `@lms/extension-api`.

**Ядро знает конверт, содержимое вида непрозрачно.** Порт движка `ExerciseTypes` (`packages/engine/src/ports/exercise-types.ts`) заменяет `Verifier`: `describe/list/validateSpec/validateAnswer` (синхронно по манифестам, схемы проверяет Ajv в процессе движка) и `project/grade/referenceAnswer` (асинхронно, в хосте расширений). `grade` не бросает: сбои хоста — `error`-вердикт (`timeout`, `worker_crash`, `internal`). Оценка FSRS считается ядром по `outcome` (`GradePolicy`), расширение выставить её не может.

**Топология процессов.** Движок (`utilityProcess`) и хост расширений (`utilityProcess`) соединены прямым `MessageChannelMain`, который выдаёт main (`host-link.ts`); при перезапуске любого из процессов выдаётся новая пара портов. Протокол — `project`/`grade`/`referenceAnswer` поверх `MessageEndpoint`. Клиент на стороне движка держит дедлайн `timeoutMs + 2 с`; синхронный цикл в расширении не прервать, поэтому по дедлайну клиент просит main перезапустить хост (`restart-ext-host`).

**Обнаружение.** Два корня: из поставки (read-only) и `<userData>/extensions`; манифесты читаются в обоих процессах независимо, при совпадении id побеждает пользовательский. Код исполняется только в хосте расширений, ленивая активация по первому запросу к виду.

**Renderer.** Скрипт элемента ответа отдаёт протокол `lms-ext://<id>/<путь>` (только `.js`/`.mjs` внутри каталога расширения, приоритет пользовательского корня); CSP расширена `script-src ... lms-ext:`. Пользовательский renderer-код исполняется в общем JS-контексте приложения (сознательно, без изоляции).

**Сборка.** Расширения по умолчанию — пакеты `packages/ext-sql`, `packages/ext-choice`; `pnpm -F <пакет> build` собирает каталог `dist-ext/`; плагин Vite `lms:extensions` (`apps/desktop/vite.config.ts`) собирает их и копирует в `<outRoot>/extensions/<id>/`; упаковка — `extraResources`. SQL-раннер (`@lms/engine-sql-runner`) переехал внутрь расширения `lms.sql` (воркер — `worker.mjs` рядом с `main.mjs`).

Пакеты: `@lms/extension-api`, `@lms/extension-host` (манифест, обнаружение, каталог, рантайм, клиент, локальный адаптер для CLI и тестов), `@lms/ext-sql`, `@lms/ext-choice`. Затронуты контракт `@lms/engine-contract` (v2) и схема RPC `practice.submitAnswer`; схема БД не меняется.

## Progress

- [x] 2026-09-30 пакет `@lms/extension-api`, скелеты пакетов
- [x] 2026-09-30 контракт: открытый вердикт (`reason: string`, `data`)
- [x] 2026-09-30 порт `ExerciseTypes` и фейк в `@lms/testkit`
- [x] 2026-09-30 `@lms/extension-host` (манифест, обнаружение, каталог, рантайм, клиент, local; тесты)
- [x] 2026-09-30 пакеты `ext-sql`, `ext-choice` (сборка `dist-ext`, тесты)
- [x] 2026-09-30 миграция фикстур на `engine.exercise`, библиотека `choice-course`
- [ ] контракт v2, движок, авторинг, CLI, RPC и их тесты
- [ ] desktop: процессы, протокол `lms-ext://`, сборка, renderer
- [ ] смоук и e2e
- [ ] закрытие: перенос в документацию, ADR, архив

## Surprises & Discoveries

- `AGENTS.md` ветки `develop` требует спеки для таких фич; спека заведена после начала реализации (первые коммиты шагов 1–3 без неё).

## Decision Log

- 2026-09-30. Виды заданий — только расширения, встроенных видов в коде приложения нет. Причина: расширяемость важнее удобства; дефолтные виды проверяют, что интерфейс не подогнан под SQL.
- 2026-09-30. Хост расширений — отдельный `utilityProcess`, а не `fork` из движка. Причина: выбор пользователя; падение расширения не затрагивает журнал и SQLite движка.
- 2026-09-30. Расширения по умолчанию — read-only каталоги в поставке, пользовательские побеждают по id; скачивание и установка вне этой фичи. Причина: решение пользователя; формат каталога уже пригоден для будущей установки.
- 2026-09-30. Renderer-часть расширений — Web Component в shadow DOM без изоляции. Причина: выбор пользователя; допустимо, пока каталог наполняет сам пользователь.
- 2026-09-30. Манифест — `extension.json`, не `package.json`. Причина: независимость рантайма от npm, простая установка копированием.
- 2026-09-30. `engine.verification` удалён, фикстуры мигрированы (чистый переход). Причина: выбор пользователя; единая модель без двух форматов.
- 2026-09-30. `CONTRACT_VERSION = 2`. Причина: несовместимые клиент и хост должны отказать в `engine.hello`.
- 2026-09-30. Коды `E_NO_VERIFICATION`/`I_NO_VERIFICATION`/`E_REFERENCE_FAILS` сохранены, `W_UNKNOWN_RUNNER` заменён на `W_UNKNOWN_EXERCISE_TYPE`, добавлен `E_EXERCISE_SPEC`. Причина: каталог кодов — публичный, «verification» по-прежнему означает «проверяемое упражнение».

## Outcomes

<Заполняется при закрытии.>
