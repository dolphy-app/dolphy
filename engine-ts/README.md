# engine-ts: с чего продолжить разработку

Слой бизнес-логики (TypeScript, без `electron`) — порт Trane v0.34.1 на ts-fsrs плюс слой F1–F7. Кода движка ещё нет: есть дизайн v1 и пять проверенных прототипов. Пометки: [ИЗМЕРЕНО] — прогон, [ВЫВОД] — умозаключение, [НЕ ПОДТВЕРЖДЕНО] — не проверено.

## Порядок чтения

1. `design/engine-ts.md` — главный документ: решения (§0), трассировка F1–F7 → FR → API → веха → приёмка (§1.1), модель данных (§5), F-слой (§6a), дорожная карта M0–M7 (§11), открытые вопросы (§12).
2. `design/engine-ts-api.md` — контракт `@spirula/engine-contract` (типы проверены `tsc` 7.0.2).
3. `design/engine-ts-testing.md` — стратегия vitest, обязательные тесты T-01…T-60, CI-матрица Node 22 + 24.
4. `design/engine-ts-electron.md` — псевдокод сервисов, транспорта и процессов внутри Electron (`@spirula/engine-rpc`, хост в `utilityProcess`, main, preload).
5. `design/engine-ts-diagram.html` — схема (открывать через `python3 -m http.server`, не `file://`).
6. `research/report-*.md` — числа и контрпримеры за каждым решением; `research/spec-*.md` — поведение модулей Trane с `file:line`.

## Каталоги

| Каталог | Что там |
|---|---|
| `design/` | пять документов выше (пункты 1–5) |
| `research/` | 4 спеки Trane, 8 отчётов (FSRS, PowerLaw, загрузчик, F1–F7) и `facts-stack.md` (факты о стеке) |
| `spike/` (вне репозитория) | прототипы с тестами: песочница `/Users/tinkerbells/projects/lms-platform/engine-ts/spike/`; `node_modules` и `target` удалены, ставятся `npm ci` |
| `reference/trane-pristine/` (вне репозитория) | Rust-эталон v0.34.1 (тег `v0.34.1`, коммит `6f5f84a85667b4bf0402b1185ae5a889ff57e01d`, https://github.com/trane-project/trane) для golden-тестов |
| `reference/sql-course/` (вне репозитория) | образцовый курс на 7 уроков (неполон: нет фикстур и эталонных CSV, ключ `check:` вместо `engine.verification`) |
| `reference/fsrs-scorer/` (вне репозитория) | Rust-адаптер FSRS, 12 тестов |

Каталоги `spike/` и `reference/` остались в песочнице `/Users/tinkerbells/projects/lms-platform/engine-ts/` и в git не входят. Пути `engine-ts/spike/…` и `engine-ts/reference/…` в документах относятся к ней (список — в корневом `README.md`).

## Что переносить из спайков (M0–M6)

| Спайк | Куда | Замечание |
|---|---|---|
| `powerlaw-port/` | `@spirula/engine` scoring | 31 тест ×2 precision, fixture 5 919 кейсов, генератор `golden-rs/` |
| `fsrs-check/` | `MemoryModel` | рецепт `next_state` + `forgetting_curve`, не `next()`; эталон py-fsrs |
| `loader-bench/` | схемы zod, loader, граф, редукция | `algo.ts` — редукция на битовых множествах |
| `compiler/` | `authoring/`, CLI | `scan`, `checks`, `diagnostics`, `compile`, `revision`, `cli`; мини-парсер YAML и `loader-ref.ts` не переносить |
| `diagnostic/` | `placement/` | `dag.ts`, `engine.ts` (V3, жёсткое замыкание) |
| `fire-plan/` | `planning/` | `memory.ts`, `memory-index.ts`, `planner.ts`, кредит в `graph.ts`; за флагом |
| `sql-runner/` | `@spirula/engine-sql-runner` | `engine`, `compare`, `pool`, `prefilter`, `types`, `verifier`, `worker` |
| `journal-sync/` | `sync/`, `@spirula/engine-sqlite` | `log`, `proj`, `replica`, `folder-sync`, `sqlite-store`, `writer` |

Проверка любого спайка: `cd /Users/tinkerbells/projects/lms-platform/engine-ts/spike/<имя> && npm ci && npx tsc --noEmit && npx vitest run` (на 2026-09-29 прошли все: 13, 25, 44, 153 + 1 пропущенный, 65 тестов).

## Старт M0 (800 строк)

1. `pnpm` 9.15.9 workspace, Node 22.22 (dev) и 24.x (Electron 44), TypeScript 7.0.2 (`tsc -b`, нет JS API), vitest 5.0.2 (`test.projects`, `pool: 'forks'`), ESLint + Prettier, CI на обеих Node.
2. Пакеты: `@spirula/engine-contract`, `@spirula/engine`, `@spirula/engine-sqlite`, `@spirula/engine-sql-runner`, dev-пакет `@spirula/testkit` (FakeClock, SeededRng, TestId, билдеры курсов и журнала).
3. Приёмка M0: `pnpm test` и typecheck зелёные на Node 22 и 24; эталон py-fsrs проходит контрактный тест `MemoryModel`.
4. Дальше по порядку M1 → M7 (§11 главного документа); у каждой вехи автоматическая приёмка.

## Решения владельца

- Порт Trane, структура модулей сохраняется; скорер — FSRS (ts-fsrs 5.4.2, вариант H); тесты на vitest.
- Движок в `utilityProcess`; лицензия отложена (AGPL применима, вернуться до первого внешнего релиза); латентность `getBatch` остаётся измерением на M3/M4.
- Каталоги `spike/trane-mvp` и `spike/trane-fsrs` удалены.

## Что ещё не решено (полный список — §12)

1. `getDay` или `getBatch` как основной путь UI.
2. Включать ли неявный повтор (FIRe): выключен по умолчанию, нужен A/B на реальных ответах.
3. Нужен ли UI разрешения конфликтов журнала и репликация решений между устройствами.
4. Порождение процессов раннера SQL внутри настоящего `utilityProcess` Electron 44.

## Что не проверено

- F3 и F4 проверены только на синтетических круговых учениках; у F6 спайка нет.
- `getFrontier` («нет данных = закрыто») против Rust `get_candidates`: спайки прочли гейт по-разному, решает тест M3.
- Rust-Trane на курсе с `engine`-frontmatter.
- Потеря питания, iCloud/Syncthing/Dropbox/Git, Windows и Linux, холодный кэш диска, латентность `getBatch` в TS.
- Схемы `log_conflict` и `imported_segment`, карантин `clock-skew`, `W_GRANULARITY`, `E_REFERENCE_FAILS`.

## Ловушки

- Node 24 без установки: `npx -y -p node@24 node …` (Electron 44 = Node 24.21).
- vitest 5: `bench` — фикстура теста, а не экспорт.
- ts-fsrs округляет до 8 знаков: сравнения только с допуском.
- Параллельные фоновые `node` из подоболочки могут молча не стартовать: запускать по очереди.
- `PRAGMA fullfsync` на macOS выключен по умолчанию: `synchronous=FULL` без него почти бесполезен для носителя.
