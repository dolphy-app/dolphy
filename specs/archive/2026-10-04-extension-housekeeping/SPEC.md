---
status: done
branch: feature/extension-housekeeping
created: 2026-10-04
closed: 2026-10-04
touches: [extension-host, extension-catalog, extension-install, extension-tools, create-extension, desktop]
depends-on: [specs/archive/2026-10-03-catalog-metadata]
supersedes: null
superseded-by: null
---

# Уборка перед фундаментом расширений

> Исторический документ. Не источник требований.

Живой документ, пока `status` — `draft` или `active`: `Progress`, `Surprises & Discoveries`, `Decision Log` обновляются вместе с кодом. По завершении фичи переносится в `specs/archive/` и не меняется. Правила — скилл `spec-workflow`.

## Цель

Перед волнами развития расширений (W1–W5) закрыть мелкие долги: зафиксировать политику эволюции API (ADR 0014), свернуть слой совместимости каталога до одного индекса, ограничить `activate()` сроком 10 с в обоих режимах, убрать устаревший текст из шаблона проекта и строку с идентификатором расширения из плиток тем. Контракт `@dolphy-app/engine-contract` не меняется; отдельный релиз до W1 не нужен.

## Не цели

- Новые ключи манифеста, точки вклада, разрешения — волны W1–W5.
- Структурные диагностики, безопасный режим, журнал в файл — W1.
- Правка тел ADR 0001, 0002, 0004, 0013: меняются только строки `status`.
- Отмена зависшей синхронной активации в процессе хоста: цикл прервать нечем (ограничение 8 «Пределов» остаётся); срок лишь освобождает вызывающего.
- Переименование индекса и смена адреса каталога (см. Решения).
- Отказ от терпимого (lenient) разбора индекса в приложении: он остаётся.

## Требования

Наблюдаемое поведение. Проверки — юнит-тесты `packages/*/test`, `apps/desktop/test`, e2e `apps/desktop/e2e`.

- R1. Политика эволюции API. В `docs/adr/` есть ADR 0014 «Эволюция API расширений»: до заморозки API совместимость не гарантируется, `apiVersion` остаётся 1, ломающие изменения допустимы в любом релизе с записью в `CHANGELOG.md`; заморозка и правила устаревания вводятся отдельным решением владельца. Строки `status` ADR 0001 и 0002 ссылаются на 0014, у 0004 — на ADR-0005, ADR-0006, ADR-0010, у 0013 — на ADR-0014. Проверка: ревью файлов; `pnpm lint` проходит.
- R2. Один индекс каталога. `dolphy-ext catalog build` пишет один файл `index.v2.json` (схема v2) и не пишет `index.json`. Приложение читает только его: нет запасного обращения к `index.json` при 404, 404 — «каталог недоступен». Из кода удалены формат первой схемы, `legacySubset`, `isLegacyVersion`/`isLegacyEntry`, профиль LEGACY и разрешения/файлы только для неё. Проверка: тесты `packages/extension-tools` — после `catalog build` в выходном каталоге ровно один индекс; тест `packages/extension-install` — запрос при 404 `index.v2.json` не уходит на `index.json`; `grep -r legacySubset packages apps` пуст.
- R3. Каталог целиком. Версия расширения с любым разрешением, типом файла и ключом записи схемы v2 попадает в индекс и доступна в приложении (раньше часть версий исключалась из `index.json`). Проверка: тест `catalog build` на фикстуре с расширением, использующим все файловые типы и разрешения, — версия есть в `index.v2.json`.
- R4. Срок активации. `activate()`, не завершившийся за 10 с, — сбой с причиной `activation-timeout`, и для расширения в процессе хоста, и для ограниченного процесса; вызвавший (команда, событие, `project`/`grade`) получает её, а не чужой дедлайн. Проверка: юнит-тест рантайма с фальшивыми часами и вечным `activate`; тот же сценарий в `restricted-runner.test.ts`.
- R5. Сбой запоминается. После `activation-timeout` повторные вызовы не запускают `activate()` заново и сразу получают ту же причину, пока сборка не заменена (перезагрузка, включение/выключение, новая версия). Проверка: `activate` вызван один раз при трёх обращениях; после замены сборки — снова один раз.
- R6. Поздняя активация не оживает. Регистрации (команды, события, обработчики), сделанные `activate()` после срока, не попадают в рантайм. Проверка: команда, зарегистрированная после срока, отвечает `activation-timeout`.
- R7. Причина видна. Вызов команды расширения с `activation-timeout` показывает в окне сообщение «расширение не запустилось за 10 с» (ru/en, `vue-i18n`). Проверка: тест адаптера команд `apps/desktop/test`; e2e — расширение с вечным `activate()`, команда из палитры.
- R8. Шаблон без устаревшего текста. README, который создаёт `create-dolphy-extension`, не содержит «There is no installation from the app yet»; описывает установку из каталога (Settings → Extensions → Catalog), ручную копию в `<userData>/extensions/` и `DOLPHY_DEV_EXTENSIONS`. Проверка: `generate.test.ts`.
- R9. Плитки тем без идентификатора. В Настройки → Внешний вид у плитки темы расширения нет видимой подписи с `extensionId`; идентификатор — `title` плитки и связан через `aria-describedby`. Плитки «Как в системе», «Светлая», «Тёмная» не меняются. Проверка: юнит-тест модели плиток (нет `caption`, есть `tooltip`); e2e `themes.e2e.test.ts`.
- R10. Документация верна. «Пределы» п. 8, раздел «Сроки» и «Установка и каталог» в `docs/design/extensions.md` описывают срок активации, `activation-timeout` и один индекс; блоки кода документа проходят `packages/create-extension/test/docs.test.ts`. Проверка: этот тест и ревью.
- R11. Парковка отложенного. Decision Log содержит единый список отложенного; W1–W5 ссылаются на него. Проверка: ревью.

## Решения

**Один индекс.** Остаётся `index.v2.json`: имя не меняем, чтобы не ломать опубликованное и адрес каталога (идентичность каталога в `.dolphy-install.json` — `catalogUrl`, остаётся адресом, рядом с которым лежит индекс; `fullIndexUrl` в `packages/extension-catalog/src/urls.ts` продолжает его выводить). Удаляется: `packages/extension-catalog/src/legacy.ts`; `LEGACY_PROFILE`, `legacyIndexSchema`, `LEGACY_SCHEMA_VERSION`, `isLegacyCatalogPath` и ветка `isLegacyIndex` в `schema.ts`; `LEGACY_FILE_EXTENSIONS` в `assets.ts`; запасной источник `['legacy', catalogLocation]` и вид `legacy` в `packages/extension-install/src/installer.ts` и `cache.ts`; `legacy` у `buildIndexes` и `isLegacy*` в `packages/extension-tools/src/catalog/{index-file,build}.ts`; замороженная схема `packages/extension-tools/test/fixtures/released-schema-v1.ts` и тесты `formats.test.ts`, `catalog-assets.test.ts`, `catalog-metadata.test.ts`, опирающиеся на неё; режим `format: 'legacy'` в `apps/desktop/e2e/support/catalog-server.ts`. Лимит файлов версии (`MAX_FILES_V2`) и схема v2 остаются, их название «v2» — просто имя формата. Терпимый разбор индекса в приложении оставлен. Приложения до этой фичи теряют каталог — принято владельцем.

**Каталог-репозиторий (отдельный PR в `dolphy-app/dolphy-extensions`, клон `/Users/tinkerbells/projects/dolphy-extensions`).** После выпуска версии `@dolphy-app/extension-tools` с одним индексом: обновить зависимость, workflow деплоя перестаёт публиковать `index.json`; в репозитории не должно остаться ссылок на него в README и проверках. Порядок: сначала релиз приложения и tools, затем PR каталога; до слияния PR каталог продолжает отдавать старый файл — приложению он не нужен.

**Срок активации.** `ACTIVATION_TIMEOUT_MS = 10_000` в `packages/extension-host/src/runtime.ts` и параметр `activationTimeoutMs` рантайма (по образцу `readyTimeoutMs` в `restricted-runner.ts`). `activate` (~L300–420) оборачивается в гонку с таймером. Слот активации хранит отклонённый `ready` (`openSlot`, `activationOf`), сбрасывается только при замене/выгрузке (`slots.delete`, ~L701, ~L759) — отсюда запоминание. `RuntimeFailure` получает причину `activation-timeout`. Поздняя активация: флаг `abandoned` в `Activation`, `ctx.*.register` после него ничего не регистрирует.

**Ограниченный процесс.** Готовность после `activate` ждёт `readyTimeoutMs` (10 с, `restricted-runner.ts`); при истечении причина меняется с `activation-failed` на `activation-timeout`, процесс убивается как раньше. Дедлайны вызовов не меняются.

**Протокол.** `ExtFailureCause` в `packages/extension-host/src/protocol.ts` получает `'activation-timeout'`. `ExerciseTypeErrorCause` (`packages/engine/src/ports/exercise-types.ts`) не меняем: для `project`/`grade` клиент хоста свёртывает причину в `activation-failed`. Для команд причина доходит до окна через `client.ts`; если список причин `CommandOutcome` в `@dolphy-app/extension-api` закрыт, он расширяется. Контракт движка не меняется, `CONTRACT_VERSION` не поднимается.

**Шаблон.** `packages/create-extension/src/template.ts` (~L417–420): английский раздел установки без «no installation yet».

**Плитки тем.** `AppearanceSection.vue` (`themeTiles`, L28–40) вместо `caption: theme.extensionId` — поле `tooltip`; `ThemeTile.vue` ставит `title` и `aria-describedby` на скрытый элемент с идентификатором.

**ADR 0014 (текст для `docs/adr/0014-extension-api-evolution.md`).**

```
---
status: accepted
date: 2026-10-04
spec: specs/archive/<дата-закрытия>-extension-housekeeping/SPEC.md
---

# 0014. Эволюция API расширений

Один ADR — одно решение. Уточняет ADR 0001 и 0002 в части версионирования; их остальные решения не отменяет.

## Контекст

ADR 0001: «`apiVersion` не меняется, пока манифест только растёт». ADR 0002: «новые ключи сопровождаются повышением версии API». Они противоречат друг другу. Приложение и экосистема расширений молоды, внешних авторов, зависящих от API, нет; обратная совместимость стоила бы слоёв (терпимый разбор, второй индекс каталога, гейтинг по версии приложения) ради нуля пользователей.

## Решение

1. До заморозки API совместимость не гарантируется. `apiVersion` остаётся 1.
2. Ломающие изменения (манифест, точки вклада, разрешения, `ctx`, каталог) допустимы в любом релизе; их перечень записывается в `CHANGELOG.md` релиза.
3. Слои совместимости не создаются; устаревший код заменяется чисто, расширения из поставки и из каталога обновляются в том же изменении.
4. Момент заморозки и правила устаревания (в частности, не менее двух минорных релизов с предупреждением в журнале) вводятся отдельным решением владельца, когда каталог откроют сторонним авторам.

## Рассмотренные варианты

- Повышать `apiVersion` с каждым ключом (ADR 0002): без внешних авторов версия ничего не защищает.
- Не повышать никогда и расти только совместимо (ADR 0001 буквально): требует терпимого разбора и гейтинга по версии приложения, то есть именно слоёв, которые не нужны.
- Ввести окно устаревания сейчас: процесс без потребителей.

## Последствия

- Любая волна может добавлять и менять поля; она обновляет все расширения репозитория и каталога сама.
- Выпущенные приложения могут перестать работать с новым каталогом и расширениями (принято: каталог — один индекс, ADR 0013 в части двух индексов отменён).
- При открытии каталога сторонним авторам нужен новый ADR о заморозке; до него `apiVersion: 2` не вводится.
```

## Progress

- [x] 0a. Документы и мелкий UI (один PR)
  - [x] ADR 0014; `status` ADR 0001, 0002, 0004 (+ADR-0006), 0013; ссылки в `docs/design/extensions.md`
  - [x] README шаблона `create-extension`, тест в `generate.test.ts`
  - [x] Плитки тем: `tooltip`, `title`, `aria-describedby`; юнит-тест, `themes.e2e.test.ts`
- [x] 0b. Один индекс каталога (один PR)
  - [x] Удаление слоя совместимости в `extension-catalog`, `extension-install`, `extension-tools`, e2e-сервере (R2, R3)
  - [x] `docs/design/extensions.md` («Установка и каталог»), `packages/README.md`
  - [ ] Отдельный PR в `dolphy-app/dolphy-extensions` (деплой без `index.json`) — вне этого PR, после релиза tools: список правок в Decision Log и в Outcomes, делает координатор
- [x] 0c. Срок активации (один PR)
  - [x] `activation-timeout` в `protocol.ts`, `runtime.ts`, `restricted-runner.ts`, `client.ts`; тесты R4–R6
  - [x] Сообщение ru/en, e2e с вечным `activate()` (R7)
  - [x] «Сроки» и «Пределы» п. 8 (R10)

Все три этапа выполнены одним PR (`feature/extension-housekeeping`).

## Surprises & Discoveries

- `ready` ограниченного процесса уже ждёт 10 с (`DEFAULT_READY_TIMEOUT_MS`), но причина — общая `activation-failed`; в процессе хоста срока нет (`await module.activate(context)`, `runtime.ts` ~L417).
- Слот активации хранит отклонённый `ready`: запоминание сбоя уже работает, сбрасывается только при замене/выгрузке.
- Слой совместимости каталога широкий: `legacy.ts`, профиль в `schema.ts`, запасной источник в `installer.ts`, замороженный `released-schema-v1.ts`, режим `legacy` в e2e-сервере.
- Фраза «There is no installation from the app yet» (`template.ts` ~L420) тестом не закреплена: `generate.test.ts` проверяет лишь отсутствие `Installing dependencies`.
- `caption` темы — единственное место, где `extensionId` виден в плитке (`AppearanceSection.vue` L36).

Реализация: поле `abandoned` в `Activation` нужно и при срыве срока до создания активации (модуль ещё грузится) — `openSlot` помнит срыв и ставит флаг сразу после создания. `deadline` вызова ограниченного процесса (`OTHER_DEADLINE_MS` и `commandDeadlineMs`) стартует раньше `readyTimeoutMs`, поэтому без поправки зависшая активация давала бы `handler-failed`/`handler-timeout` («чужой дедлайн»): раннер определяет, что процесс ещё не `ready` в момент дедлайна, и отвечает `activation-timeout`. Сбой ограниченного процесса запоминается самим раннером (раннер заменяется вместе со сборкой). Закрытый список причин команды — `ExtensionCommandFailureReason` в `engine-contract` (тип `details.reason`): в него добавлено `activation-timeout` (расширение типа без новых методов и полей, `CONTRACT_VERSION` не менялась). `innerText` скрытого `visually-hidden` текста плитки видим тестам: e2e измеряет видимую подпись без таких узлов. В `desktop-installer.test.ts` индекс первой схемы был единственным: тест переведён на `index.v2.json`.

Design review плиток тем и сообщения о сроке (`/tmp/dolphy-design-review-extension-housekeeping`, не в репозитории; настоящее приложение в Electron через Playwright): P0–P2 не найдено. Измерено: у всех четырёх плиток высота 158 px (подпись-идентификатор не добавляет строку), у плитки темы расширения `title` и `aria-describedby` указывают на `acme.midnight`, у встроенных плиток их нет, фокус-кольцо видно на плитке «Полночь» (`tiles-focus.png`), в тёмной теме и на ширине 700 px плитки перестраиваются в две колонки без обрезки (`appearance-dark-700.png`); сообщение «Расширение не запустилось за 10 с.» читаемо в светлой теме (`notice-timeout.png`). Не проверено: английский текст сообщения визуально (покрыт тестом `en: typeof ru`), тёмная тема для сообщения, axe-core (не установлен; контраст подписи плитки посчитан вручную без учёта альфа-канала 0,87).

## Decision Log

- 2026-10-04. Обратная совместимость не обеспечивается (владелец): приложение и расширения сырые, ломаем сразу. Причина: экономия усилий, нет внешних пользователей API.
- 2026-10-04. Спека не требует релиза до W1; контракт движка не меняется. Причина: изменения локальные.
- 2026-10-04. Индекс остаётся под именем `index.v2.json`, адрес каталога (`catalogUrl`) не меняется. Причина: переименование ломает идентичность установленных расширений и опубликованное без выгоды.
- 2026-10-04. Срок активации 10 с, одинаков для обоих режимов, не настраивается. Причина: совпадает с `readyTimeoutMs`; настройка добавила бы поле контракта.
- 2026-10-04. Поздняя активация отбрасывается, зависший цикл не прерываем. Причина: в процессе хоста прервать нечем.
- 2026-10-04. `ExerciseTypeErrorCause` не меняется. Причина: `activation-timeout` — внутренняя причина хоста.
- 2026-10-04. Правим только строки `status` ADR 0001/0002/0004/0013. Причина: ADR неизменяемы, решение — в ADR 0014.
- 2026-10-04. Уровень безопасности — как у Obsidian: ревью, безопасный режим, диагностика. Вне всех волн: независимый аудит, песочница ОС, подписанный индекс и проверка издателей, принудительное ограничение сети, лимит кучи V8, запрет симлинков, процессные тесты на всех ОС. Лимиты вывода и IPC — стабильность, W1.
- 2026-10-04. **Парковка отложенного (единственный список).** Не делаем сейчас: сайт документации; typedoc-сайт; витрина каталога; `dolphy-ext analyze`; постраничный индекс; мастер «новое расширение» в приложении; хуки планировщика и модели памяти (вернуться после статистики и импортёров); сервисы между расширениями; инструмент матрицы совместимости; автообновление (только ручное, ADR 0004).
- 2026-10-04. Порядок волн: W0 `extension-housekeeping`, W1 `extension-foundation`, W2 `extension-api-breadth-1`, W3 `extension-authoring`, W4 `extension-api-breadth-2`, W5 `extension-distribution-ux`.
- 2026-10-04. Правки репозитория каталога `dolphy-app/dolphy-extensions` (делает координатор после релиза приложения и tools, не в этом PR): (1) `package.json` — обновить `@dolphy-app/extension-tools`; (2) `.github/workflows/pr-check.yml` — `INDEX_URL` на `.../index.v2.json`, шаги «Fetch published index» и «Reindex (dry)» кладут файл как `site/index.v2.json`; (3) `.github/workflows/deploy.yml` — в «Build site» добавить `rm -f site/index.json`, публикуется только `index.v2.json`; (4) `README.md` — таблица «Published files and index» и абзацы об индексе называют `index.v2.json`, адрес каталога остаётся `.../index.json`. Причина: приложение и tools перестали читать и писать `index.json`; сначала релиз, затем PR каталога.

## Outcomes

Реализовано целиком. Политика эволюции API — [ADR 0014](../../../docs/adr/0014-extension-api-evolution.md) (до заморозки совместимость не гарантируется, `apiVersion` остаётся 1; у ADR 0001, 0002, 0013 `status` ссылается на него, у ADR 0004 — на ADR-0005, ADR-0006, ADR-0010). Каталог — один `index.v2.json`: удалены `legacy.ts`, `legacySubset`, профиль первой схемы, запасное обращение к `index.json` и замороженная схема выпущенного приложения; 404 индекса — «каталог недоступен»; любая версия попадает в индекс целиком. `activate()` ограничен 10 с в обоих режимах: причина `activation-timeout` запоминается до замены сборки, поздние регистрации отбрасываются, окно показывает «Расширение не запустилось за 10 с». README шаблона описывает установку из каталога, вручную и `DOLPHY_DEV_EXTENSIONS`; у плитки темы расширения идентификатор — `title` и `aria-describedby`. Долговечное описание — `docs/design/extensions.md` («Сроки», «Пределы» п. 8, «Установка и каталог», «Границы» с единым списком отложенного). Контракт `@dolphy-app/engine-contract`: `CONTRACT_VERSION` не менялась (тип `ExtensionCommandFailureReason` получил значение `activation-timeout`).

| Требование | Проверка |
| ---------- | -------- |
| R1 | ревью `docs/adr/0014-extension-api-evolution.md` и строк `status` ADR 0001, 0002, 0004, 0013; `pnpm lint` |
| R2 | `packages/extension-tools/test/catalog-assets.test.ts` («writes exactly one index file»), `catalog-cli.test.ts`, `catalog-build.test.ts`; `packages/extension-install/test/full-index.test.ts` («a 404 of index.v2.json makes the catalog unavailable and does not fall back to index.json»); `grep -r legacySubset packages apps` пуст; e2e `catalog.e2e.test.ts` («каталог без index.v2.json недоступен») |
| R3 | `catalog-assets.test.ts` («publishes a version with every permission, file type and entry key», «a version of 51 files is in the index», «keeps an extension whose only version is new and tagged»), `catalog-metadata.test.ts` |
| R4 | `packages/extension-host/test/runtime-activation.test.ts` (фальшивые часы, вечный `activate`: команда, событие, `project`, `grade`; параметр `activationTimeoutMs`), `restricted-runner.test.ts` («процесс, который не сообщил ready…», «срок вызова вышел раньше срока готовности…»), `client.test.ts`, `client-commands.test.ts` |
| R5 | `runtime-activation.test.ts` («сбой запоминается…», «после замены сборки…»), `restricted-runner.test.ts` (процесс заново не поднимается) |
| R6 | `runtime-activation.test.ts` («команда, зарегистрированная после срока…», «поздняя регистрация события и вида задания…») |
| R7 | `apps/desktop/test/extension-commands-runner.test.ts` (`activation-timeout` → `activationTimeout`); e2e `extension-surfaces.e2e.test.ts` («расширение с вечным activate()…», фикстура `slow-start-extension`) |
| R8 | `packages/create-extension/test/generate.test.ts` («README describes installation…») |
| R9 | `apps/desktop/test/theme-tiles.test.ts`; e2e `themes.e2e.test.ts` (`title`, `aria-describedby`, нет видимой подписи, встроенные плитки без подсказки) |
| R10 | `packages/create-extension/test/docs.test.ts` и `packages/extension-tools/test/docs-contributions.test.ts` проходят; ревью разделов «Сроки», «Пределы» п. 8, «Установка и каталог» |
| R11 | единый список отложенного — в Decision Log (запись «Парковка отложенного») и в `docs/design/extensions.md` («Границы»); W1–W5 ссылаются на этот путь |

**Не сделано здесь (по решению владельца — после релиза, делает координатор): PR в `dolphy-app/dolphy-extensions`.** Нужно изменить: (1) `package.json` — обновить `@dolphy-app/extension-tools` на версию с одним индексом; (2) `.github/workflows/pr-check.yml` — `INDEX_URL` указывает на `.../index.v2.json`, шаг «Fetch published index» и «Reindex (dry)» кладут файл как `site/index.v2.json` (`catalog build --reindex` читает `<out>/index.v2.json`), `--published-index` получает `index.v2.json`; (3) `.github/workflows/deploy.yml` — `catalog build` пишет только `index.v2.json`: в шаг «Build site» добавить `rm -f site/index.json`, чтобы старый файл ушёл из ветки `gh-pages`, следить, чтобы коммит публикации не добавлял `index.json`; (4) `README.md` — таблица «Published files and index» и абзацы про индекс называют `index.v2.json`, адрес каталога остаётся `https://dolphy-app.github.io/dolphy-extensions/index.json` (приложение берёт индекс рядом с ним); (5) порядок: сначала релиз приложения и tools, затем PR каталога; до слияния каталог продолжает отдавать старый `index.json` — приложению он не нужен.
