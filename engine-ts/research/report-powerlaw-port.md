# Отчёт: порт `PowerLawScorer` на TypeScript + дифференциальное тестирование против реального Rust

Проверяемая гипотеза: порт чистого модуля Trane можно валидировать дифференциально — прогнать один и тот же вход через **настоящий** Rust-код (`trane` v0.34.1, `src/exercise_scorer.rs`) и через TS-порт и сравнить выходы. Результат: подход работает; f32-эмуляция через `Math.fround` воспроизводит Rust с точностью до 1 ulp (velocity — побитово), а «чистый» f64-порт расходится в пределах шума f32 **плюс** несколько дискретных разрывов (порог «old-good floor», точные ничьи на порогах планировщика).

Каталог: `/Users/tinkerbells/projects/lms-platform/engine-ts/spike/powerlaw-port/`. Платформа: Darwin 25.5.0 arm64, node v22.22.3, vitest 5.0.2, **TypeScript 7.0.2 работает** (`tsc --noEmit` чистый; откат на 5.x не понадобился), Rust 1.97.

---

## 1. Файлы порта и LOC

Счёт: «строки / из них код» (без пустых и комментариев; `python` подсчёт, префиксы `//`, `/*`, `*`).

| Файл | Строк | Код | Назначение |
|---|---|---|---|
| `src/exerciseScorer.ts` | 444 | 321 | порт `PowerLawScorer`, переключатель `precision: 'f64' \| 'f32'`, константы |
| `src/types.ts` | 57 | 31 | `ExerciseTrial/Delta/Score/Type`, `Precision`, `TrialsNotSortedError`, `ExerciseScorer` |
| `test/exerciseScorer.test.ts` | 286 | 228 | порт 31 Rust-теста, каждый прогоняется в f64 и f32 (62 прогона) |
| `test/golden.test.ts` | 138 | 104 | дифференциальные тесты (17 кейсов vitest) |
| `test/goldenAnalysis.ts` | 181 | 158 | метрики ошибок, пороги, сводки |
| `test/goldenCases.ts` | 67 | 56 | загрузка JSONL, сек → мс, декод NaN/Infinity |
| `scripts/analyze.ts` | 52 | 49 | печать таблиц (`results/analysis.txt`, `results/analysis.json`) |
| `scripts/powfTrace.ts`, `scripts/constantScoreProbe.ts`, `scripts/branchCoverage.ts` | 32 / 19 / 23 | — | диагностика (причина 1-ulp, ничьи на константных историях, покрытие ветвей) |
| `golden-rs/src/main.rs` | 550 | 457 | генератор golden на реальном `trane::exercise_scorer::PowerLawScorer` |
| `golden-rs/src/bin/powf_probe.rs` | 33 | 25 | сравнение платформенного `f32::powf` с `fround(Math.pow)` |
| `test/golden/powerlaw.jsonl` | 5919 строк, 3 532 811 байт (gzip 649 477) | — | зафиксированный fixture (тестовый актив; не удалён при очистке) |

Rust-оригинал: `src/exercise_scorer.rs` строки 1–499 = **499 строк / 280 кодовых** (включая trait, константы, `PowerLawScorer`), тесты — строки 501–1723 = **1223 строки / 1108 кодовых**.

### Как сохранена паритетность (ключевые решения)

- **Числовая модель.** `new PowerLawScorer({ precision })`. В `f32` каждая арифметическая операция, которую Rust держит в `f32`, обёрнута в `Math.fround` **в том же порядке вычисления**, что в Rust-выражении (`a * b / c` → `r(r(a*b)/c)`), константы тоже `fround` (`constantsFor('f32')`). Для `+ - * /` вычисление в f64 с последующим `fround` побитово равно нативному f32 (двойное округление безопасно, 53 ≥ 2·24+2). Неточным остаётся только `powf`: `fround(Math.pow(..))` vs libm `powf` (`exerciseScorer.ts`, метод `powf`). В `f64` — обычные double, константы без округления.
- **Время в мс.** `elapsedDays(newerMs, olderMs)` (`exerciseScorer.ts:192`): в f64 — `diffMs / 86_400_000` (одно корректно округлённое деление; для целых секунд то же вещественное частное, что `diffSec/86400`); в f32 — `fround(fround(diffMs/1000) / 86400)`, т. е. `(secs as f32) / SECONDS_PER_DAY`. `i64::saturating_sub` эмулируется зажимом разности в ±2^63·1000 мс (`saturatingSubMs`). `elapsed_weeks` = `elapsedDays/7` с `max(0)`, как в Rust (`exercise_scorer.rs:229-232`).
- **Ошибка.** `Result<_, anyhow::Error>` → `throw new TrialsNotSortedError()` с тем же текстом `"Exercise trials not sorted in descending order by timestamp"` (`exercise_scorer.rs:464-466`). Условие то же: `windows(2).any(w[0].timestamp < w[1].timestamp)` — равные метки допустимы; дельты порядок не проверяют. Тест сравнивает текст ошибки на всех 90 error-кейсах.
- **`f32::EPSILON`** (`2^-23`) сохранён и в f64-режиме — это семантический порог (`get_curve_factor`, `velocity`: `denominator.abs() < f32::EPSILON`).
- **`f32::max/min/clamp`.** Реализованы `rustMax/rustMin/rustClamp` (Rust: при одном NaN возвращается второй операнд; `clamp` пропускает NaN). См. §6: различие не достижимо на fixture.
- Приватные функции Rust (`estimate_difficulty`, `compute_stability`, …) сделаны публичными методами с `@internal`, чтобы портированные тесты могли их вызывать (в Rust тесты — дочерний модуль с доступом к приватному).
- `exercise_id` в TS-DTO опционален (скорер его не читает).

---

## 2. Golden fixture

`test/golden/powerlaw.jsonl` — **5919 кейсов** (90 ошибок Err, 5829 Ok), детерминированно генерируется `golden-rs` (`cargo run --release`, seed `0x5EED_7A4E_2026_0929`, свой splitmix64, без `rand`). Повторный запуск дал побайтово идентичный файл (`cmp` → `FIXTURE_IDENTICAL`, sha256 `5aa6d51576f4…3325`).

Формат строки: `{id, kind, type, trials:[{score,timestamp(сек)}], deltas:[{delta,timestamp}], now(сек), expect:{ok:true,value,urgency,velocity|null} | {ok:false,error}}`. Входные float — кратчайшая десятичная запись f32 (`3.7`); выходные — точное f32-значение, расширенное до f64; NaN/±Inf кодируются строками (serde_json/`JSON.stringify` иначе пишут `null`).

| kind | n | что покрывает |
|---|---|---|
| random | 3600 | 0–25 трайалов (148 пустых), дельты 0–12 (в 5 % — несортированные), gap-микс: та же секунда / секунды / минуты / часы / дни / дробные дни / 30–150 сут / 150–550 сут; `now` = newest + 0…400 сут (≈3 % — до newest); ≈10 % нецелых оценок |
| old_good_floor | 500 | ≥2 трайалов, оценки 4–5, ≥40 сут; 1/6 — границы 49/50/51 сут, ±1 с |
| delta_term | 400 | ≥2 дельты, свежий `now` |
| mean_reversion | 400 | 15–25 трайалов, серии fail/success, чередование |
| threshold_boundary | 200 | константные оценки 4.0, 3.0, 5.0, 2.5, 3.75, 3.9999998, 4.0000005; elapsed 0/49/50/200 сут ±1 с |
| single_trial / two_trials | 150 / 150 | |
| same_second / dense_minutes / one_second_apart | 60 / 60 / 60 | вырождение OLS-знаменателя |
| now_before_newest | 120 | `now < newest` |
| no_history | 40 | пусто (value 0.0, urgency 1.0, velocity None), с дельтами и без |
| error_ascending / error_one_swap / error_off_by_one_second | 30 / 30 / 30 | все 90 → Err |
| duplicate_timestamps | 30 | равные метки — допустимы (Ok) |
| nan_score / infinite_score / out_of_range_score | 10 / 10 / 20 | NaN, ±Inf, 0, −2, 7.5, 100 |
| extreme_* | 19 | зеркало Rust-тестов: `1e10` дней назад, `i64::MAX`/`MIN`, эпоха 0, отрицательные метки, 25 трайалов на 200–800 сут, 25×5.0 + молчание 700/3650 сут (кламп `MAX_STABILITY`) |

Покрытие ветвей (модель f32, `node scripts/branchCoverage.ts`): old-good floor активен (weighted≥4 ∧ days≥50 ∧ n≥2) в **1104** кейсах, реально поднял retrievability в **567**; ненулевой delta-терм в **2429**; стабильность упёрлась в `MAX_STABILITY` в **396**, в `MIN_STABILITY` в **1412**; `velocity == 0.0` в **1044**; `now < newest` в **266**; ≥2 дельт в 2499; нецелые оценки в 2155.

---

## 3. Анализ ошибок (полностью: `results/analysis.txt`, `results/analysis.json`)

Ошибка абсолютная `|got − rust|`, относительная `abs/|rust|` (только при rust≠0). «f32-exact» — число кейсов, где `fround(got)` побитово равен Rust.

### 3.1 Дискретные показатели

| | f64-порт | f32-эмуляция |
|---|---|---|
| Ok/Err статус совпал | 5919/5919 | 5919/5919 |
| текст ошибки совпал | 90/90 | 90/90 |
| velocity None ↔ Some | 0 расхождений | 0 |
| пересечения порогов `value` (0.1, 2.5, 3.0, 3.75, 4.0, 4.5, 5.0) | **7 кейсов**: порог 3.0 — 3, 3.75 — 3, 2.5 — 1, 5.0 — 1 (кейс 677 пересекает 2.5 и 3.0) | **0** |
| флип «стагнации» `abs(velocity) < 0.2` (`filter.rs:48`) | 0 | 0 |
| смена знака velocity, сырая / при `max(abs) ≥ 1e-3` | 143 / 2 | 0 / 0 |

### 3.2 Численные ошибки, все Ok-кейсы (n = 5829; velocity — 5103, где Some)

f32-эмуляция:

| выход | max abs | mean abs | p99 abs | max rel | mean rel | f32-exact |
|---|---|---|---|---|---|---|
| value | 4.768e-7 | 1.948e-9 | 0 | 2.115e-7 | 7.952e-10 | 5787/5829 (99.28 %) |
| urgency | 5.960e-8 | 2.659e-10 | 0 | 8.766e-5* | 2.723e-8 | 5803/5829 (99.55 %) |
| velocity | 0 | 0 | 0 | 0 | 0 | **5103/5103** |

\* относительная ошибка urgency = `1 − R` при `R≈1` раздута вычитанием (1 ulp по `R` = 6e-8 абсолютной ошибки при urgency ≈ 0.009); для urgency осмысленна абсолютная ошибка.

f64-порт (включая 2 разрыва floor):

| выход | max abs | mean abs | p99 abs | max rel | mean rel | f32-exact |
|---|---|---|---|---|---|---|
| value | 1.446 | 3.018e-4 | 1.062e-6 | 4.821e-1 | 1.035e-4 | 1974/5829 |
| urgency | 2.417e-7 | 2.878e-8 | 9.276e-8 | 2.941e-2* | 3.614e-5 | 2198/5829 |
| velocity | 3.578e-2 | 9.440e-5 | 4.883e-4 | 1.0 | 2.814e-2 | 1646/5103 |

f64-порт **без** 3 кейсов с флипом floor (677, 695, 742; n = 5826): value max abs **2.607e-6**, mean abs 1.582e-7, max rel 7.405e-7, mean rel 9.17e-8. Велосити: при `|rust| ≥ 1` (n = 357) max rel 2.07e-4, mean rel 1.9e-6; при `|rust| < 1e-3` (n = 2033) max abs 5.0e-5 (шум сокращения f32).

### 3.3 Худшие 10 кейсов и причины

**f64, по abs-ошибке value** (`node scripts/analyze.ts`):

| id | kind | rust | ts f64 | abs | причина |
|---|---|---|---|---|---|
| 677 | threshold_boundary, Decl., 3 трайала | 3.0 | 1.5537 | 1.446 | **флип floor.** Все оценки `3.9999998`; Rust в f32 округляет `0.8·w+0.2·w` до ровно `4.0`, `weighted ≥ 4.0` истинно → `R=0.75` → `0.75·4.0 = 3.0`. В f64 взвешенное = 3.9999998 < 4.0, floor не применён |
| 742 | threshold_boundary, Proc. | 3.0 | 2.6879 | 0.312 | то же |
| 2061 | mean_reversion (22 трайала) | 3.5203998 | 3.5204024 | 2.607e-6 | накопление f32-ошибки по цепочке стабильность/сложность из ~21 шага (≈11 ulp); f64 здесь ближе к «истине» |
| 2313, 1989, 2049, 1941, 2155, 2025, 2097 | mean_reversion (18–24 трайала) | | | 1.9e-6…2.3e-6 | то же |

Флип floor подтверждён независимо: помощник `floorFlips` в `golden.test.ts` даёт для f64 vs f32 ровно кейсы **677, 695, 742** (у 695 R уже ≥ 0.75, на value не влияет).

**f64, по abs urgency:** все 10 — mean_reversion / random, 1.2e-7…2.4e-7 (шум f32 в стабильности → `R`).

**f64, по rel velocity:** все 10 — rel = 1.0 при |rust| ≈ 1e-8…7e-7, а порт даёт ≈1e-17: у Rust f32 остаточный шум сокращений `n·Σt·s − Σt·Σs` на (почти) константных оценках; f64 даёт почти точный 0. По abs — до 1.5e-8, к планировщику отношения не имеет. Наибольшая abs-ошибка velocity — 3.6e-2 при значениях 5900…27294 (kind `one_second_apart`, rel ≈ 6e-6): у Rust f32 при `t ~ 1e-5` дня.

**Дискретные расхождения f64 (9 кейсов):**

| id | kind | rust value | ts f64 value | что произошло |
|---|---|---|---|---|
| 677, 742 | threshold_boundary | 3.0 | 1.55 / 2.69 | флип floor (см. выше) |
| 724 | threshold_boundary | 2.9999998 | 3.0000000000000004 | ничья на пороге 3.0: Rust f32 даёт значение на 1 ulp ниже |
| 841, 2551, 5347 | threshold_boundary / random | 3.7499998 / 3.7499995 / 3.7499995 | 3.75 / 3.75 / 3.75 | то же, порог 3.75 (`HIGHLY_SCORE` в `review_knocker.rs:25`, границы `MasteryWindow` в `data.rs:1061-1073`) |
| 890 | now_before_newest | 4.9999995 | 5.0 | то же, порог 5.0 |
| 520, 5033 | one_second_apart / random | velocity −0.0096 / −0.0025 | 8.9e-12 / 0 | смена знака velocity на шуме сокращения f32; `|v| < 0.2` не меняется |

Самая важная находка: **константная история оценок даёт в Rust значения на 1 ulp ниже оценки**, и это влияет на «≥ порог» в планировщике. `node scripts/constantScoreProbe.ts` (20 000 случайных константных историй на оценку, LCG): доля историй, где взвешенное среднее < оценки — f64: 3.0 → 1019, 3.5 → 1461, 3.75 → 1664, **4.0 → 0**, 4.5 → 402, 5.0 → 1055; f32: 3.0 → 4765, 3.5 → 1854, 3.75 → 2758, **4.0 → 0**, 4.5 → 2686, 5.0 → 1557. Для 4.0 (степень двойки) масштабирование точное, поэтому `weighted ≥ OLD_GOOD_MIN_SCORE` для «всё четвёрки» устойчиво в обоих режимах; риск флипа — только у почти-4.0 оценок вроде 3.9999998 (на fixture специально сгенерированы; реальные пользовательские оценки — целые).

**f32-эмуляция, худшие 10 по abs value** (все `old_good_floor`, Procedural/Declarative): 4.768e-7 = ровно **1 ulp f32 в диапазоне 4–8**. По urgency — 5.96e-8 = 1 ulp около `R∈[0.5,1)`.

Причина 1 ulp установлена измерением (`node scripts/powfTrace.ts` → `cargo run --release --bin powf_probe`): все **49** кейсов, где value или urgency не побитовы, содержат хотя бы один вызов `powf`, для которого платформенный `f32::powf` ≠ `(x as f64).powf(y as f64) as f32` (49/49; в этих кейсах 55 из 1861 вызовов = 3.0 %). Во всех остальных 5780 кейсах 465 из 170 133 вызовов (0.27 %) тоже различаются, но ошибка гасится последующим округлением. Максимальный зазор — 1 ulp. То есть единственный источник остаточного расхождения f32-режима — `powf` (libm macOS vs V8 `Math.pow` + `fround`); `velocity` не использует `powf` и совпал побитово, включая знак нуля (`Object.is`).

### 3.4 Проверка чувствительности теста (мутации)

`PERFORMANCE_WEIGHT_DECAY: 0.95 → 0.949` валит 5 из 17 golden-тестов (f32: value, порог, ≥99 % bit-exact; f64: value, порог). Т. е. golden ловит реальные ошибки констант.

---

## 4. Порт юнит-тестов `exercise_scorer.rs`

- В Rust **31** `#[test]` (`grep -c '#\[test\]'`). Портировано **31 из 31**, пропущено **0**. Каждый идёт через `describe.each(['f64','f32'])` → **62 прогона, 62 проходят** (`npx vitest run`: 79 tests = 62 юнит + 17 golden, 2 файла).
- Имена сохранены (`estimate_difficulty`, `no_previous_trials`, `score_trials`, `invalid_timestamp`, `extreme_timestamp_gap_does_not_overflow`, `compute_stability`, `compute_stability_spacing_effect`, `bad_score_reduces_stability`, `multiple_lapses_bounded`, `high_stability_does_not_explode`, `compute_retrievability`, `retrievability_at_stability_is_ninety_percent`, `compute_spacing_gain`, `intra_day_damping`, `compute_weighted_avg`, `apply_old_good_retrievability_floor`, `score_bad_recent`, `score_mixed_performance`, `score_unsorted_trials`, `score_old_timestamp`, `score_multiple_good`, `score_multiple_bad`, `score_old_good_trials`, `score_very_good_old_trials`, `urgency_increases_with_elapsed_time`, `velocity_empty_trials`, `velocity_improving_scores`, `velocity_worsening_scores`, `velocity_constant_scores`, `score_with_positive_deltas`, `score_with_negative_deltas`).
- Отступления: `Utc::now()` → фиксированное `NOW` (детерминизм); `i64::MAX/MIN` секунд → ±2^63 с в мс (`extreme_timestamp_gap…`); `unwrap()` → `.velocity!`/`.not.toBeNull`; `assert!(result.is_err())` → `toThrow(TrialsNotSortedError)` + проверка текста; `high_stability_does_not_explode` пересчитывает арифметику через `r`=fround в f32-прогоне (Rust считает в f32).
- Наблюдение по оригиналу: тест `compute_stability` подаёт трайалы **по возрастанию** времени (`[3 дня назад, 2, 1]`), тогда как трейт требует убывания; `compute_stability` порядок не проверяет и клампит отрицательные интервалы в 0 — тест проверяет лишь диапазон. Порт сохранён 1:1 с комментарием.
- **Трудозатраты (тесты):** Rust `mod test` 1223 строки / 1108 кодовых → TS 286 / 228 (0.23× по строкам, 0.21× по коду), при том что TS-файл выполняет каждый тест дважды. Экономия — за счёт помощников `trials(...pairs)` вместо литералов `ExerciseTrial { score, timestamp, ..Default::default() }` (по 5 строк на трайал в Rust).

---

## 5. Наблюдаемые трудозатраты порта

| Часть | Rust (код) | TS (код) | отношение |
|---|---|---|---|
| сам скорер (без тестов) | 280 (499 строк) | 321 (+31 в types.ts) = 352 | 1.15× (1.26× с типами) |
| тесты | 1108 | 228 | 0.21× |
| harness дифф-тестирования | генератор 457 + probe 25 | 56 + 158 + 104 + скрипты ≈ 100 | ≈ 900 строк суммарно ≈ 3× сам порт |

Время по часам не замерялось [НЕ ПОДТВЕРЖДЕНО как метрика]. Наблюдение: все ошибки компиляции Rust-генератора — 3 одинаковых `E0499` (`make_deltas(rng, rng.range(..), ..)` — двойной `&mut` на `rng`); TS-порт прошёл юнит-тесты и golden с первого запуска, единственная правка после — баг в моём анализаторе (NaN velocity считался сменой знака: `Math.sign(NaN) !== Math.sign(NaN)`).

Что было неудобно:
- **f32.** Каждая операция → `r(...)` с точным сохранением порядка/ассоциативности Rust; выражения вида `STABILITY_COEFFICIENT * p * e * spacing_gain * intra_day_damping` превращаются в 4 вложенных `r()`. Читаемость падает; решение — единая реализация с `r` = identity в f64. Отдельно: константы должны округляться (`0.95` как f32 ≠ `0.95` как double), выражения над константами (`1.0 - W`, `GRADE_MAX - GRADE_MIN`) считаются в f32 в рантайме.
- **Числовые касты.** `i64 as f32` + `saturating_sub` (мс/сек, §1), `usize as f32`.
- **Цепочки итераторов.** Встречаются только `.iter().filter().count()`, `.windows(2).any()`, `.iter().rev()`, `.enumerate()`, `Option::map_or` — тривиально разворачиваются в циклы; `previous_timestamp.map_or(0.0, …)` — ветка 0.0 недостижима после проверки `is_none()`.
- **Result/anyhow.** Один `Err`; в TS — типизированный `throw` (важно унифицировать сообщение, т. к. golden сверяет текст). При «домен синхронный» это идиоматично; альтернативой был бы `Result`-объект.
- **Сортировка:** в модуле её нет — только проверка порядка; вопрос стабильности сортировки для этого модуля не возникает (на входе вызывающего кода `practice_stats`/`review_list` — вне области этого порта).
- **Обобщение `TimestampedValue`** (трейт для трайалов и дельт) → callback `valueOf`.
- **Приватность.** Rust-тесты видят приватные методы; в TS их пришлось публиковать.

Где Rust зависит от поведения, отличного в JS:
1. **f32 vs f64** — главное (ничьи на порогах, флип floor, шум OLS-знаменателя, §3).
2. **`powf`** ≠ `Math.pow`+`fround` на 1 ulp (0.27 % вызовов на реальных аргументах); дополнительно C99 `pow(1, NaN) = 1`, JS `NaN` — учтено в `powf`, но недостижимо на fixture.
3. **`f32::max/min` при NaN** возвращают другой операнд, `Math.max/min` — NaN. Реализованы `rustMax/rustMin`, но проверка мутацией (замена на `Math.max/min`) дала **0** расхождений на fixture: в скорере NaN не попадает операндом в `max/min` (NaN-оценки идут через `clamp`, который пропускает NaN в обеих реализациях). Достижимость различия не подтверждена.
4. **i64 ↔ number.** `i64::MAX/MIN` не представимы (округляются до ±2^63); целые > 2^53 в JSON теряют точность при `JSON.parse` (кейсы `extreme_i64_gap`, id 2–8). Секунды·1000 для реальных меток (~1.7e12 мс) безопасны. TS-специфичный риск, которого нет в Rust: `timestamp = NaN/±Infinity` (нужна валидация DTO схемой).
5. **Целочисленное деление** в модуле отсутствует (все деления f32/`len as f32`).
6. **Форматирование float:** `serde_json` печатает f32 ryu-кратчайшим (`0.1`), при чтении в f64 это `0.1`, а не f32-значение `0.10000000149…` → входы f32-режима надо `fround`-ить (`r(t.score)` на границе), выходы Rust хранить как точное расширение. NaN/Inf `serde_json`/`JSON.stringify` пишут `null` → кодирование строками.
7. **Знак нуля:** `Object.is` сравнение velocity дало 5103/5103 — `-0.0` не проявился.
8. Побочное замечание по Trane (прочитано, не исполнялось): `filter.rs:116-117` считает `-velocity.ln_1p()`; при `velocity < -1` это NaN, а velocity в единицах «баллы/день» при повторах в один день достигает −96…−27294 (см. `one_second_apart`). Влияние на планировщик [НЕ ПОДТВЕРЖДЕНО — не запускалось].

---

## 6. Рекомендуемые политики

### 6.1 Допуски для будущих golden-тестов (реализованы в `test/golden.test.ts`, `TOLERANCE`)

Критерий `|got − expected| ≤ atol + rtol·|expected|`; NaN==NaN; Ok/Err и текст ошибки, `None` vs `Some` — **точное совпадение** во всех режимах.

| выход | f32-эмуляция (эталонный двойник) | f64 (продакшен) | обоснование (наблюдалось) |
|---|---|---|---|
| value | atol 1e-6 | atol 1e-5 | f32: max 4.77e-7 = 1 ulp; f64: max 2.6e-6 вне разрывов, ×4 запас |
| urgency | atol 2e-7 | atol 1e-6 | абсолютная (не относительная!): `1−R`; f32 max 6e-8, f64 max 2.4e-7 |
| velocity | atol 1e-9, rtol 1e-6 (фактически бит-точно) | atol 1e-2, rtol 5e-5 | шум сокращения в f32 Rust: до 1e-2 при секундных интервалах; rtol для |v| до 27 000 |
| пороги планировщика | 0 пересечений (assert) | ≤ 10 кейсов, каждый обязан быть «ничьёй» `|value − θ| ≤ 1e-5` | наблюдалось 7 |
| разрывы | — | **не сравнивать** value там, где f64 и f32 расходятся по условию floor (`weighted ≥ 4.0 ∧ days ≥ 50`): разрыв величиной до 0.75·score | кейсы 677/695/742 |

Общие правила: (1) допуск — абсолютный + относительный, никогда чисто относительный (`urgency`, `velocity` около 0); (2) допуск проводится по каждому выходу отдельно; (3) на дискретных решениях (пороги, `Option`, Ok/Err) допуска нет — либо точное равенство (f32-двойник), либо исключение околопороговых входов (`|x − θ| < ε`) из сравнения; (4) генератор должен помечать/не порождать входы на f32-разрывах, если тест идёт против f64-кода; (5) fixture чувствителен к libm: `powf` сгенерирован macOS libm; регенерация на Linux/glibc может изменить ≈0.3 % вызовов на 1 ulp (V8 `Math.pow` детерминирован, поэтому TS-сторона переносима) — допуски f32-режима это покрывают, побитовые проверки velocity (не зависит от `powf`) остаются жёсткими.

### 6.2 f64 или fround-эмуляция в продакшене

Рекомендация: **продакшен — f64; f32-эмуляция — эталонный двойник для дифференциальных тестов**.

Аргументы (факты этого замера):
- f32-эмуляция даёт полный паритет на 5829 Ok-кейсах (velocity 100 % бит-в-бит, value/urgency ≤ 1 ulp, 0 дискретных расхождений), значит golden-подход на f32-двойнике жёстко ловит ошибки порта (мутация константы валит тесты).
- f64 расходится на ≤ 2.6e-6 по value и ≤ 2.4e-7 по urgency; пользователю и планировщику это не видно. Дискретные различия — только ничьи на порогах (7/5829 ≈ 0.12 %) и флип floor на почти-4.0 оценках (3/5829, только искусственные входы `3.9999998`). В ничьих f64 даже «правильнее»: константная оценка 3.0 не становится «ниже 3.0» из-за округления.
- Код f32-режима с `r(...)` на каждой операции нечитаем; в f64-режиме `r` — identity. Стоимость исполнения несущественна (шумные замеры на fixture: 1.2–3.2 мкс на `score` в обоих режимах; `node /tmp/bench.ts`, не сохранён в репозиторий — [НЕ ПОДТВЕРЖДЕНО как стабильная метрика]).
- Оговорка: если требуется **бит-в-бит воспроизвести планирование Trane** на существующих данных пользователей (совпадение решений на порогах `>=`), нужен f32-режим; для целей проекта («заменить `PowerLawScorer` на ts-fsrs») такой необходимости нет. Для остальных модулей (unit scorer, reward propagator, filter/knocker) порог-ориентированной логики много (`MASTERED_SCORE_THRESHOLD 4.0`, 3.75, 4.5) — там использовать тот же приём: одна реализация с переключателем округления и golden против f32-двойника.

Практика: в каждом модуле с f32-арифметикой держать реализацию с `r`-ом только пока идёт стадия сверки; после стабилизации golden оставить двойник как тестовую поддержку (его стоимость — параметр `precision`, 1 ветка в конструкторе), а продакшен создавать без параметра (f64).

---

## 7. Команды воспроизведения

```bash
cd /Users/tinkerbells/projects/lms-platform/engine-ts/spike/powerlaw-port
npm install                                   # vitest 5.0.2, typescript 7.0.2, @types/node 22 (package-lock.json)
npx vitest run                                # 79 tests: 62 unit (31×2 precisions) + 17 golden
npx tsc --noEmit                              # TypeScript 7.0.2, чисто
node scripts/analyze.ts --json results/analysis.json > results/analysis.txt   # таблицы §3 (node ≥ 22.18)

# регенерация fixture (детерминирована, побайтово идентична)
cd golden-rs && CARGO_TARGET_DIR=$PWD/target cargo run --release                # пишет ../test/golden/powerlaw.jsonl
# причина 1-ulp в f32-режиме
cd .. && node scripts/powfTrace.ts > /tmp/powf_args.txt
cd golden-rs && CARGO_TARGET_DIR=$PWD/target cargo run --release --bin powf_probe < /tmp/powf_args.txt
node scripts/constantScoreProbe.ts ; node scripts/branchCoverage.ts             # из корня проекта
```

## 8. Результат и ограничения

- `npx vitest run`: **2 файла, 79 тестов, все проходят**; `tsc --noEmit` без ошибок (TypeScript 7.0.2).
- Не подтверждено / не делалось: сценарий `NaN`/`Infinity` в `timestamp` (в Rust невозможен); достижимость NaN-различия `max/min`; влияние `ln_1p(velocity<-1)` на планировщик; поведение `powf` на glibc (fixture сгенерирован только на macOS arm64); git-коммит fixture не выполнялся (файл оставлен на диске как тестовый актив, `.gitignore` исключает `node_modules/` и `golden-rs/target/`).
- Очистка: `node_modules/` и `golden-rs/target/` удалены; оставлены исходники, `package-lock.json`, `Cargo.lock`, fixture, `results/`, отчёт.
