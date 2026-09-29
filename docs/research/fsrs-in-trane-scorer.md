# REPORT-scorer: FSRS-6 как `ExerciseScorer` для Trane (spike)

> **Статус артефактов (2026-09-29).** Крейт адаптера перенесён в `engine-ts/reference/fsrs-scorer/` (зависимость на `../trane-pristine`, 12 тестов проходят); пути `spike/trane-fsrs/...` ниже устарели. `scripts/validate.py` ищет бинарь относительно своего расположения.

Крейт: `spike/trane-fsrs/fsrs-scorer` (зависимости: `trane` = path `../trane-pristine`, `fsrs = "6.6.2"`, `anyhow`). Файлы: `src/lib.rs` (реализация + 12 unit-тестов), `examples/{validate,trajectories,bench,optimize}.rs`, `scripts/validate.py`. Машина: Apple M5 Pro, macOS arm64, rustc/cargo 1.97. `trane-pristine` и `trane` не менялись (у `trane-pristine` не появилось `target/`).

## 1. Реализация

`pub struct FsrsScorer` (Send + Sync, проверено тестом `send_sync`), `impl ExerciseScorer`.

```rust
FsrsScorer::new(params: Vec<f32>, rating_map: RatingMap, variant: Variant) -> anyhow::Result<Self>
FsrsScorer::with_defaults(rating_map, variant)            // fsrs::DEFAULT_PARAMETERS
.with_s_pass(f32)                                          // pub const S_PASS = 2.0; pub-поле s_pass
enum RatingMap { InverseM0, RunnerMap }
enum Variant  { Hybrid, Pure }
```

- Конструктор: длина != 21 -> `Err`; NaN/inf в параметрах -> `Err`; далее `FSRS::new(&params)` (он клипует параметры).
- `InverseM0`: `round(score)` (зажат в 1..5): 1,2->Again(1); 3->Hard(2); 4->Good(3); 5->Easy(4). `RunnerMap`: 1,2->Again; 3,4->Hard(2); 5->Good(3).
- Replay: trials разворачиваются в возрастающий порядок; первый `delta_t = 0`, далее `floor((ts_i - ts_{i-1})/86400)` в i128 (без переполнения), `>= 0`, обрезка сверху 36 500 дней (100 лет) — чтобы состояние оставалось конечным. Нарушение порядка не даёт `Err` (в отличие от `PowerLawScorer`, который возвращает `Err` на неотсортированных): при необходимости делается отсортированная копия.
- Ретривабельность на `now`: дробные дни `(now - last_ts)/86400` (i128 -> f64 -> f32), `max(0)`, через `fsrs::current_retrievability(state, days, decay)`. **Важно про decay:** функция принимает положительное `decay = w[20]` (внутри `powf(-decay)`), а не `-w[20]`; в коде берётся `params[20]` с клипом в `[0.1, 0.8]` (как у fsrs-rs в `parameter_clipper`). Выход не-finite -> `r = 0`.
- `Hybrid`: `r` как выше; `pl = PowerLawScorer{}.score(type, trials, deltas, last_ts)` (время сдвинуто к последнему trial — собственный фактор забывания PowerLaw = 1, остаётся взвешенная оценка + delta); `value = clamp(r * pl.value, 0, 5)`, `urgency = 1 - r`, `velocity = pl.velocity`. Пустая история -> `(0.0, 1.0, None)`. `previous_deltas` пробрасываются в PowerLaw как есть.
- `Pure`: `value = clamp(5 * r * min(1, S / s_pass), 0, 5)`, `urgency = 1 - r`, `velocity = None`.
- `ExerciseType` FSRS игнорирует (один параметр `w[20]`); в `Hybrid` он только передаётся в `PowerLawScorer` (там влияет на его собственную кривую, которая при сдвиге времени к last_ts вырождается в 1, т.е. практически не влияет на value; `velocity` от типа не зависит).
- Ошибки: NaN/±inf в `score` -> `Err`; конечные вне диапазона (0, 7.5, 1e30) -> зажимаются в 1..5.
- Публичные вспомогательные `memory_state(&trials) -> Option<(MemoryState, last_ts)>`, `retrievability(state, days)`, `rating(score)`.

## 2. Численная валидация против py-fsrs

Версия: `pip install fsrs` -> **fsrs 6.3.2** (py-fsrs, FSRS-6, 21 параметр = те же `DEFAULT_PARAMETERS`), Python 3.11; Rust: `fsrs 6.6.2`. venv создавался во `/tmp` и удалён после прогона.
Данные: 600 случайных историй (seed 12345, 1–60 обзоров; 40 % промежутков — 1 мин–20 ч, 60 % — 1–400 дней; рейтинги 15/5/70/10 %), 3 момента запроса на историю (смесь 0–2 дней и 1–400 дней после последнего обзора) = 1800 запросов.
Rust сторона гоняет **реальный код крейта** (`FsrsScorer::memory_state` + `retrievability`, рейтинги -> score 1/3/4/5 -> `InverseM0`), Python — `Scheduler(learning_steps=(), relearning_steps=(), enable_fuzzing=False, maximum_interval=36500)`.

Команды (из каталога крейта):
```
python3.11 -m venv /tmp/fsrs-venv && /tmp/fsrs-venv/bin/pip install fsrs
cargo build --release --examples
/tmp/fsrs-venv/bin/python scripts/validate.py     # пишет /tmp/hist.txt, вызывает target/release/examples/validate
```
Результат:

| Метрика | max | mean |
|---|---|---|
| Stability, относительная ошибка \|Rust-Py\|/Py | 1.82e-06 | 4.0e-07 |
| Difficulty, абсолютная | 4.96e-06 | 5.7e-07 |
| R: Rust (дробные дни, f32) vs формула Python с теми же дробными днями (f64) | 2.25e-07 | 2.4e-08 |
| R: Rust (дробные дни) vs `get_card_retrievability` py-fsrs (целые дни) | **0.298** | 3.6e-03 |

Интерпретация:
- S и D совпадают до float32 (~1e-6 отн.), в т.ч. на первом обзоре и на same-day обзорах: py-fsrs ветвится по `(dt).days < 1` -> short-term stability, fsrs-rs по `delta_t == 0` — эквивалентно, так как я тоже считаю `delta_t` как целые дни от разности timestamp'ов.
- Единственное систематическое расхождение: `Scheduler.get_card_retrievability` использует `max(0, (now - last_review).days)` — **целые дни** (floor), а мы используем дробные. Ошибка одностороння: py-fsrs занижает возраст (R завышен) на долю суток; максимум 0.298 приходится на запрос ~ < 1 день после обзора с малой S (у py-fsrs при `days=0` R = 1.0 ровно). Это не ошибка Rust, а осознанная разница семантики; при сравнении с той же формулой на дробных днях ошибка 2e-7 (float32 vs float64).
- Ошибок float32 vs float64 в накопленном состоянии (до 60 шагов) достаточно мало (<2e-6 отн.), заметного дрейфа нет. Худший случай S: 48.7670 vs 48.7671 (45 обзоров).

## 3. Траектории

Генерация: `cargo run --release --example trajectories` (вывод CSV; свёрнут в таблицы). Значения f32, округлены до 3 знаков. Колонки: `PL-Proc`/`PL-Decl` — реальный `PowerLawScorer`; `H-M0`/`P-M0` — Hybrid/Pure c `InverseM0`; `H-Run`/`P-Run` — то же с `RunnerMap` (`S_PASS = 2.0`, параметры по умолчанию). Окна Trane: new [0,0.1), target [0.1,2.5), current [2.5,3.75), easy [3.75,4.5), mastered [4.5,5]. Ячейка: value / urgency / velocity, окно. Кейс (g): «f, затем One через 60 дней после последней (20-й) оценки» = день 80; запросы отсчитываются от этого последнего trial. Оба маппинга приведены для всех кейсов (требовалось минимум a, c, e, g).

**a [Four]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 4.000 / 0.000 / None, easy | 4.000 / 0.000 / None, easy | 4.000 / 0.000 / None, easy | 5.000 / 0.000 / None, mastered | 4.000 / 0.000 / None, easy | 3.233 / 0.000 / None, current |
| 1 | 3.600 / 0.100 / None, current | 3.600 / 0.100 / None, current | 3.787 / 0.053 / None, easy | 4.734 / 0.053 / None, mastered | 3.667 / 0.083 / None, current | 2.963 / 0.083 / None, current |
| 3 | 3.194 / 0.201 / None, current | 3.092 / 0.227 / None, current | 3.524 / 0.119 / None, current | 4.405 / 0.119 / None, easy | 3.331 / 0.167 / None, current | 2.692 / 0.167 / None, current |
| 7 | 2.809 / 0.298 / None, current | 2.541 / 0.365 / None, current | 3.233 / 0.192 / None, current | 4.042 / 0.192 / None, easy | 3.011 / 0.247 / None, current | 2.434 / 0.247 / None, target |
| 30 | 2.159 / 0.460 / None, target | 1.590 / 0.603 / None, target | 2.670 / 0.332 / None, current | 3.338 / 0.332 / None, current | 2.454 / 0.386 / None, target | 1.984 / 0.386 / None, target |
| 90 | 1.744 / 0.564 / None, target | 1.053 / 0.737 / None, target | 2.271 / 0.432 / None, target | 2.839 / 0.432 / None, current | 2.081 / 0.480 / None, target | 1.682 / 0.480 / None, target |

**b [Five]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / None, mastered |
| 1 | 4.500 / 0.100 / None, mastered | 4.500 / 0.100 / None, mastered | 4.915 / 0.017 / None, mastered | 4.915 / 0.017 / None, mastered | 4.734 / 0.053 / None, mastered | 4.734 / 0.053 / None, mastered |
| 3 | 3.993 / 0.201 / None, easy | 3.865 / 0.227 / None, easy | 4.771 / 0.046 / None, mastered | 4.771 / 0.046 / None, mastered | 4.405 / 0.119 / None, easy | 4.405 / 0.119 / None, easy |
| 7 | 3.511 / 0.298 / None, current | 3.176 / 0.365 / None, current | 4.556 / 0.089 / None, mastered | 4.556 / 0.089 / None, mastered | 4.042 / 0.192 / None, easy | 4.042 / 0.192 / None, easy |
| 30 | 2.699 / 0.460 / None, current | 1.987 / 0.603 / None, target | 3.959 / 0.208 / None, easy | 3.959 / 0.208 / None, easy | 3.338 / 0.332 / None, current | 3.338 / 0.332 / None, current |
| 90 | 2.180 / 0.564 / None, target | 1.316 / 0.737 / None, target | 3.425 / 0.315 / None, current | 3.425 / 0.315 / None, current | 2.839 / 0.432 / None, current | 2.839 / 0.432 / None, current |

**c [One]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 1.000 / 0.000 / None, target | 1.000 / 0.000 / None, target | 1.000 / 0.000 / None, target | 0.530 / 0.000 / None, target | 1.000 / 0.000 / None, target | 0.530 / 0.000 / None, target |
| 1 | 0.900 / 0.100 / None, target | 0.900 / 0.100 / None, target | 0.766 / 0.234 / None, target | 0.406 / 0.234 / None, target | 0.766 / 0.234 / None, target | 0.406 / 0.234 / None, target |
| 3 | 0.799 / 0.201 / None, target | 0.773 / 0.227 / None, target | 0.660 / 0.340 / None, target | 0.350 / 0.340 / None, target | 0.660 / 0.340 / None, target | 0.350 / 0.340 / None, target |
| 7 | 0.702 / 0.298 / None, target | 0.635 / 0.365 / None, target | 0.582 / 0.418 / None, target | 0.309 / 0.418 / None, target | 0.582 / 0.418 / None, target | 0.309 / 0.418 / None, target |
| 30 | 0.540 / 0.460 / None, target | 0.397 / 0.603 / None, target | 0.467 / 0.533 / None, target | 0.247 / 0.533 / None, target | 0.467 / 0.533 / None, target | 0.247 / 0.533 / None, target |
| 90 | 0.436 / 0.564 / None, target | 0.263 / 0.737 / None, target | 0.394 / 0.606 / None, target | 0.209 / 0.606 / None, target | 0.394 / 0.606 / None, target | 0.209 / 0.606 / None, target |

**d [Three]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 3.000 / 0.000 / None, current | 3.000 / 0.000 / None, current | 3.000 / 0.000 / None, current | 3.233 / 0.000 / None, current | 3.000 / 0.000 / None, current | 3.233 / 0.000 / None, current |
| 1 | 2.700 / 0.100 / None, current | 2.700 / 0.100 / None, current | 2.750 / 0.083 / None, current | 2.963 / 0.083 / None, current | 2.750 / 0.083 / None, current | 2.963 / 0.083 / None, current |
| 3 | 2.396 / 0.201 / None, target | 2.319 / 0.227 / None, target | 2.499 / 0.167 / None, target | 2.692 / 0.167 / None, current | 2.499 / 0.167 / None, target | 2.692 / 0.167 / None, current |
| 7 | 2.107 / 0.298 / None, target | 1.906 / 0.365 / None, target | 2.258 / 0.247 / None, target | 2.434 / 0.247 / None, target | 2.258 / 0.247 / None, target | 2.434 / 0.247 / None, target |
| 30 | 1.620 / 0.460 / None, target | 1.192 / 0.603 / None, target | 1.841 / 0.386 / None, target | 1.984 / 0.386 / None, target | 1.841 / 0.386 / None, target | 1.984 / 0.386 / None, target |
| 90 | 1.308 / 0.564 / None, target | 0.790 / 0.737 / None, target | 1.561 / 0.480 / None, target | 1.682 / 0.480 / None, target | 1.561 / 0.480 / None, target | 1.682 / 0.480 / None, target |

**e [Four@0; Four@3d]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 4.000 / 0.000 / 0.000, easy | 4.000 / 0.000 / 0.000, easy | 4.000 / 0.000 / 0.000, easy | 5.000 / 0.000 / None, mastered | 4.000 / 0.000 / 0.000, easy | 5.000 / 0.000 / None, mastered |
| 1 | 3.803 / 0.049 / 0.000, easy | 3.818 / 0.046 / 0.000, easy | 3.958 / 0.011 / 0.000, easy | 4.947 / 0.011 / None, mastered | 3.898 / 0.026 / 0.000, easy | 4.872 / 0.026 / None, mastered |
| 3 | 3.532 / 0.117 / 0.000, current | 3.525 / 0.119 / 0.000, current | 3.883 / 0.029 / 0.000, easy | 4.853 / 0.029 / None, mastered | 3.739 / 0.065 / 0.000, current | 4.674 / 0.065 / None, mastered |
| 7 | 3.209 / 0.198 / 0.000, current | 3.116 / 0.221 / 0.000, current | 3.759 / 0.060 / 0.000, easy | 4.699 / 0.060 / None, mastered | 3.522 / 0.119 / 0.000, current | 4.403 / 0.119 / None, easy |
| 30 | 2.543 / 0.364 / 0.000, current | 2.151 / 0.462 / 0.000, target | 3.355 / 0.161 / 0.000, current | 4.194 / 0.161 / None, easy | 2.998 / 0.251 / 0.000, current | 3.747 / 0.251 / None, current |
| 90 | 3.000 / 0.482 / 0.000, current | 3.000 / 0.632 / 0.000, current | 2.939 / 0.265 / 0.000, current | 3.674 / 0.265 / None, current | 2.573 / 0.357 / 0.000, current | 3.216 / 0.357 / None, current |

**f [Five@0;1;3;8;20d]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / None, mastered |
| 1 | 4.995 / 0.001 / 0.000, mastered | 4.996 / 0.001 / 0.000, mastered | 4.995 / 0.001 / 0.000, mastered | 4.995 / 0.001 / None, mastered | 4.990 / 0.002 / 0.000, mastered | 4.990 / 0.002 / None, mastered |
| 3 | 4.986 / 0.003 / 0.000, mastered | 4.987 / 0.003 / 0.000, mastered | 4.985 / 0.003 / 0.000, mastered | 4.985 / 0.003 / None, mastered | 4.970 / 0.006 / 0.000, mastered | 4.970 / 0.006 / None, mastered |
| 7 | 4.967 / 0.007 / 0.000, mastered | 4.971 / 0.006 / 0.000, mastered | 4.966 / 0.007 / 0.000, mastered | 4.966 / 0.007 / None, mastered | 4.933 / 0.013 / 0.000, mastered | 4.933 / 0.013 / None, mastered |
| 30 | 4.866 / 0.027 / 0.000, mastered | 4.878 / 0.024 / 0.000, mastered | 4.866 / 0.027 / 0.000, mastered | 4.866 / 0.027 / None, mastered | 4.751 / 0.050 / 0.000, mastered | 4.751 / 0.050 / None, mastered |
| 90 | 4.650 / 0.070 / 0.000, mastered | 4.663 / 0.067 / 0.000, mastered | 4.660 / 0.068 / 0.000, mastered | 4.660 / 0.068 / None, mastered | 4.434 / 0.113 / 0.000, easy | 4.434 / 0.113 / None, easy |

**g f+[One@80d]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 4.033 / 0.000 / -0.051, easy | 4.033 / 0.000 / -0.051, easy | 4.033 / 0.000 / -0.051, easy | 5.000 / 0.000 / None, mastered | 4.033 / 0.000 / -0.051, easy | 5.000 / 0.000 / None, mastered |
| 1 | 3.389 / 0.160 / -0.051, current | 3.339 / 0.172 / -0.051, current | 3.910 / 0.030 / -0.051, easy | 4.848 / 0.030 / None, mastered | 3.881 / 0.038 / -0.051, easy | 4.811 / 0.038 / None, mastered |
| 3 | 2.904 / 0.280 / -0.051, current | 2.668 / 0.338 / -0.051, current | 3.728 / 0.075 / -0.051, current | 4.623 / 0.075 / None, mastered | 3.668 / 0.090 / -0.051, current | 4.548 / 0.090 / None, mastered |
| 7 | 2.510 / 0.378 / -0.051, current | 2.082 / 0.484 / -0.051, target | 3.491 / 0.134 / -0.051, current | 4.329 / 0.134 / None, easy | 3.407 / 0.155 / -0.051, current | 4.225 / 0.155 / None, easy |
| 30 | 1.904 / 0.528 / -0.051, target | 1.240 / 0.693 / -0.051, target | 2.948 / 0.269 / -0.051, current | 3.655 / 0.269 / None, current | 2.850 / 0.293 / -0.051, current | 3.534 / 0.293 / None, current |
| 90 | 3.025 / 0.620 / -0.051, current | 3.025 / 0.799 / -0.051, current | 2.524 / 0.374 / -0.051, current | 3.129 / 0.374 / None, current | 2.433 / 0.397 / -0.051, target | 3.017 / 0.397 / None, current |

**h [Five x3 same day]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / None, mastered | 5.000 / 0.000 / 0.000, mastered | 5.000 / 0.000 / None, mastered |
| 1 | 4.500 / 0.100 / 0.000, mastered | 4.500 / 0.100 / 0.000, mastered | 4.963 / 0.007 / 0.000, mastered | 4.963 / 0.007 / None, mastered | 4.734 / 0.053 / 0.000, mastered | 4.734 / 0.053 / None, mastered |
| 3 | 3.993 / 0.201 / 0.000, easy | 3.865 / 0.227 / 0.000, easy | 4.895 / 0.021 / 0.000, mastered | 4.895 / 0.021 / None, mastered | 4.405 / 0.119 / 0.000, easy | 4.405 / 0.119 / None, easy |
| 7 | 3.511 / 0.298 / 0.000, current | 3.176 / 0.365 / 0.000, current | 4.777 / 0.045 / 0.000, mastered | 4.777 / 0.045 / None, mastered | 4.042 / 0.192 / 0.000, easy | 4.042 / 0.192 / None, easy |
| 30 | 2.699 / 0.460 / 0.000, current | 1.987 / 0.603 / 0.000, target | 4.347 / 0.131 / 0.000, easy | 4.347 / 0.131 / None, easy | 3.338 / 0.332 / 0.000, current | 3.338 / 0.332 / None, current |
| 90 | 3.750 / 0.564 / 0.000, easy | 3.750 / 0.737 / 0.000, easy | 3.852 / 0.230 / 0.000, easy | 3.852 / 0.230 / None, easy | 2.839 / 0.432 / 0.000, current | 2.839 / 0.432 / None, current |

**i [One; Four same day]** (ячейка: value / urgency / velocity, окно)

| +дни | PL-Proc | PL-Decl | H-M0 | P-M0 | H-Run | P-Run |
|---|---|---|---|---|---|---|
| 0 | 2.508 / 0.000 / 0.000, current | 2.508 / 0.000 / 0.000, current | 2.508 / 0.000 / 0.000, current | 0.617 / 0.000 / None, target | 2.508 / 0.000 / 0.000, current | 0.530 / 0.000 / None, target |
| 1 | 2.257 / 0.100 / 0.000, target | 2.257 / 0.100 / 0.000, target | 1.958 / 0.219 / 0.000, target | 0.482 / 0.219 / None, target | 1.921 / 0.234 / 0.000, target | 0.406 / 0.234 / None, target |
| 3 | 2.002 / 0.201 / 0.000, target | 1.938 / 0.227 / 0.000, target | 1.690 / 0.326 / 0.000, target | 0.416 / 0.326 / None, target | 1.654 / 0.340 / 0.000, target | 0.350 / 0.340 / None, target |
| 7 | 1.761 / 0.298 / 0.000, target | 1.593 / 0.365 / 0.000, target | 1.493 / 0.404 / 0.000, target | 0.367 / 0.404 / None, target | 1.460 / 0.418 / 0.000, target | 0.309 / 0.418 / None, target |
| 30 | 1.354 / 0.460 / 0.000, target | 0.997 / 0.603 / 0.000, target | 1.198 / 0.522 / 0.000, target | 0.295 / 0.522 / None, target | 1.171 / 0.533 / 0.000, target | 0.247 / 0.533 / None, target |
| 90 | 1.094 / 0.564 / 0.000, target | 0.660 / 0.737 / 0.000, target | 1.012 / 0.596 / 0.000, target | 0.249 / 0.596 / None, target | 0.989 / 0.606 / 0.000, target | 0.209 / 0.606 / None, target |

### Качественные наблюдения (все числа — из таблиц выше)

1. **Провал сразу после неудачи.** После `[One]` (c) H и P держат упражнение в окне *target* при +0…+90 дней (H: 1.000 → 0.394, P: 0.530 → 0.209); после `One; Four` в один день (i) H даёт 2.508 на +0 — как и PowerLaw (одинаково, потому что в H value = r·pl.value и r=1), P — 0.617 (окно *target*). После неудачи в конце длинной успешной серии (g) H на +0: 4.033 (*easy*), т.е. **H не отправляет упражнение в target сразу после провала** — так же ведёт себя PowerLaw (4.033), так как это взвешенное среднее с 20-обзорной памятью; P на +0 выдаёт 5.000 (*mastered*) — при R=1 и S после Again, судя по значению 5.000, не меньше `S_PASS` (сам S в этом прогоне не печатался — `[НЕ ПОДТВЕРЖДЕНО]`): **P не понижает value сразу после единственного провала, если S остаётся большим**. `velocity` в g одинаков у H и PowerLaw (-0.051), у P velocity нет, поэтому в планировщике пропадёт штраф/бонус по стагнации.
2. **Различает ли H Four и Five?** Да, но слабо-монотонно: (a) vs (b) при +0: 4.000 vs 5.000, +7 дн: 3.233 vs 4.556, +30: 2.670 vs 3.959 (H-M0). Различие идёт через `pl.value` (среднее оценок) и через S (Good: 2.31 дн, Easy: 8.30 дн). Для `RunnerMap` в H они тоже различаются (pl.value 4 vs 5); в P различие идёт только через S: Four -> Hard (S=1.29, `S/S_PASS = 0.65`, value 3.233 на +0), Five -> Good (S=2.31, value 5.0).
3. **P после единственного Four (`InverseM0`)** сразу *mastered* (5.000): S(Good)=2.31 >= `S_PASS`=2 -> потолок 5, R=1. Т.е. один успешный trial проходит порог `avg value >= 3.0` и попадает в окно mastered. Для `RunnerMap` тот же trial (Hard, S=1.29) даёт 3.233 (*current*). Это главный риск P: value не несёт информации о качестве исполнения, только о S и R. Также `S_PASS` — свободная константа без обоснования.
4. **Скорость затухания.** Для [Five] через 30 дней: PL-Proc 2.699, PL-Decl 1.987, H/P-M0 3.959 (R=0.792), H/P-Run 3.338. Через 90 дней: 2.180 / 1.316 / 3.425 / 2.839. То есть FSRS с дефолтными параметрами забывает **медленнее** PowerLaw после одиночного успеха: urgency через 30 дн для Five 0.208 (H/P-M0) против 0.460/0.603 (PL-Proc/Decl); для Four 0.332 против 0.460/0.603; для Three 0.386 против 0.460/0.603. После одиночного провала (One) urgency FSRS (0.533 на +30) между PL-Proc (0.460) и PL-Decl (0.603). При зрелой серии (f) все скореры близки (value через 90 дн: 4.650 PL-Proc / 4.663 PL-Decl / 4.660 H-M0).
5. **Артефакты PowerLaw, которых нет у FSRS.** У PL на +90 дней value **растёт** скачком из-за `apply_old_good_retrievability_floor`: (e) +30 2.543 -> +90 3.000; (g) +30 1.904 -> +90 3.025; (h) +30 2.699 -> +90 3.750. У H/P value монотонно убывает во времени (проверено по всем 9 кейсам × 6 запросам).
6. **Same-day серии (h).** Три Five в один день: H/P-M0 +1 дн 4.963, +30: 4.347; т.е. short-term S даёт заметно больший S, чем одиночный Five (4.915 / 3.959); PL считает как одиночный Five (4.500 / 2.699). Здесь FSRS-варианты выше PL, что при интенсивном same-day повторении может завысить mastery.
7. **Velocity.** P не даёт velocity (по спецификации); H копирует PowerLaw.

## 4. Надёжность и скорость

`cargo test` в крейте: **12 passed, 0 failed** (`send_sync`, `wrong_param_length_errors`, `rating_maps`, `empty_history`, `equal_and_out_of_order_timestamps`, `now_before_last_trial`, `invalid_timestamp` (trial 1e10 дней назад), `extreme_timestamp_gap_does_not_overflow` (i64::MAX/i64::MIN, `now` в {обычный, MAX, MIN}), `bad_scores_do_not_panic` (NaN/inf -> `Err`, out-of-range -> конечный результат), `long_histories_stay_finite` (200 trials), `failure_lowers_value_and_time_lowers_value`, `matches_fsrs_reference_for_simple_history`). Все 4 комбинации (variant × map) проверяются в каждом тесте, value ∈ [0,5], urgency ∈ [0,1] всегда конечны.

Микробенчмарк (`cargo run --release --example bench`, `black_box`, 1000 прогревочных вызовов, `InverseM0`, Apple M5 Pro), ns на вызов `score()`:

| trials | PowerLaw | FSRS Pure | FSRS Hybrid |
|---|---|---|---|
| 3 | 37 | 96 | 128 |
| 20 | 403 | 758 | 1168 |
| 200 | 4322 | 7668 | 12076 |

Т.е. ~1.9× (Pure) и ~2.9× (Hybrid) от PowerLaw при 20 trials (Trane читает максимум 20): 0.8 / 1.2 мкс на упражнение. Есть лишние аллокации (`Vec<FSRSReview>` на каждый вызов; `Box<dyn Iterator>`) — не оптимизировались. `[НЕ ПОДТВЕРЖДЕНО]` влияние на общее время планировщика (не измерялось).

## 5. Метрики сборки

- Холодный `cargo build --release` крейта (`rm -rf target` первым, кэш реестра прогрет): **17.97 s** wall (user 92 s), включая сборку `trane` и всех зависимостей. Два крошечных бинарных крейта в /tmp (чистые target-каталоги, кэш реестра прогрет): trane only 21.7 s, trane+fsrs-scorer 25.6 s (`cargo build --release`, чистые target dir, /tmp).
- Крейтов в дереве (`cargo tree -e normal --prefix none | sort -u`): trane only **126** строк, с fsrs-scorer **142**. Новые крейты: `fsrs`, `fsrs-scorer`, `itertools 0.15.0`, `ndarray 0.17.2`, `matrixmultiply 0.3.11`, `num-complex 0.4.6`, `num-integer 0.1.47`, `priority-queue 2.7.0` (в fsrs пин `=2.7.0`), `rawpointer 0.2.1`, `snafu 0.9.2` + `snafu-derive` (proc-macro). Итого 10 новых внешних крейтов (+ сам `fsrs-scorer`); разница 126→142 строк включает ещё 5 повторных `(*)`-строк дерева.
- **Дубли основных зависимостей нет:** `rand 0.10.3`, `rayon 1.12.0`, `strum 0.28.0`, `serde 1.0.229`, `indexmap 2.14.2`, `num-traits 0.2.19` — те же версии, что уже использует `trane`, единственные версии в дереве. `cargo tree -d` показывает только `syn 2.0.119` и `syn 3.0.6` (оба уже были в trane: 2.x — derive_builder/rust-embed, 3.x — clap/serde; fsrs добавляет через `snafu-derive` ещё одного потребителя syn 2) и `libc` (метка features, не дубль версий). `burn` не подтягивается (dev-dependency).
- Размер release-бинарника (tiny `main`, дефолтный профиль, без LTO/strip): trane only **538 352 B**, trane + fsrs-scorer (использует и PowerLaw, и Hybrid) **573 552 B** => **+35 200 B (+6.5 %)**; после `strip`: 428 472 -> 446 888 B (**+18 416 B, +4.3 %**). `[НЕ ПОДТВЕРЖДЕНО]` для реального бинарника `trane-cli`: измерялся только миниатюрный бинарь, в котором trane линкуется лишь частично.
- Лицензии: fsrs BSD-3-Clause совместим с AGPL-3.0-or-later.

## 6. Smoke-тест оптимизатора

`cargo run --release --example optimize` (симулятор в примере, xorshift RNG seed константа): 1 учащийся, **300 карт × 10 обзоров = 3000 обзоров**, параметры симуляции = `DEFAULT_PARAMETERS`, интервалы `round(S · U(0.5..2))` >= 1 дн., исход = Again с вероятностью `1-R`, иначе Hard/Good/Easy 15/75/10 %; 351 из 3000 = Again. Обучающая выборка: 2700 `FSRSItem` с `long_term_review_cnt() > 0` (префиксы историй, как в `examples/optimize.rs` fsrs-rs).

- `compute_parameters` вернул **`Ok`, 21 конечный параметр**. Время: **3.5 / 5.0 / 4.2 / 4.0 мс** (4 запуска release, одна нить по умолчанию). Оптимизатор аналитический, без burn.
- Расстояние до истинных (default): mean |Δ| = 0.094, max |Δ| = 0.844 (w[2], начальная S для Good: 1.46 против 2.31; w[1] (Hard): 0.60 против 1.29 — всего ~15 первых Hard-обзоров, т.е. шум). Остальные параметры w[3..16], w[20]: |Δ| <= 0.09 (например w[20]=0.1296 vs 0.1542; w[12]=0.034 vs 0.061). w[17..19] совпали с дефолтом точно (в симуляции нет same-day обзоров -> нет градиента).
- `[НЕ ПОДТВЕРЖДЕНО]`: качество на реальных данных Trane (нет логов); стабильность на других seed'ах; поведение при <64 элементах (по исходникам возвращает только инициализацию начальных стабильностей, для <8 — дефолты, не запускалось).

## Что вызвало трение (API / семантика)

1. **`current_retrievability` принимает положительный decay** (`w[20]`), хотя внутренняя `power_forgetting_curve` использует `-w[20]`; в доке крейта это не написано — легко передать знак наоборот. Сам `power_forgetting_curve`/`init_stability`/`step` — `pub(crate)`, публично доступен только `memory_state` целиком и `current_retrievability`.
2. **`delta_t: u32` в целых днях**: same-day обзоры сжимаются в `delta_t = 0` (короткая стабильность), разрешение внутри дня теряется; в Trane до 20 trials, а same-day ретраи типичны (кейсы h, i) — поведение FSRS здесь отличается от «Again → S падает по failure-формуле».
3. **Порядок и целостность входа**: Trane требует убывающий порядок, `PowerLawScorer` возвращает `Err` на нарушении; FSRS-scorer вынужден сортировать сам (либо тоже `Err`). `FSRS::new` молча клипует параметры (w[20] в [0.1, 0.8]) — пришлось дублировать клип для decay. `memory_state` возвращает `Err` только на не-finite, а не на некорректные рейтинги (рейтинг 0 = «пропуск»).
4. **Шкала оценок**: у Trane 5 оценок (1..5), у FSRS 4 — любое отображение теряет информацию (`InverseM0`: 1 и 2 сливаются; `RunnerMap`: 3 и 4 сливаются, 5→Good, а Easy недостижим).
5. **`Pure` не даёт velocity и зависит от произвольной `S_PASS`**; один Four (`InverseM0`) сразу *mastered*. `Hybrid` наследует артефакты PowerLaw (delta, performance) и домножает на r, так что value никогда не превышает pl.value.
6. **`previous_deltas` (Trane): семантика delta по отношению к FSRS неясна** — delta вычисляется как разность predicted/actual относительно value самого PowerLaw; в H передаётся как есть, `[НЕ ПОДТВЕРЖДЕНО]` как это взаимодействует с r из FSRS в петле планировщика (интеграция не запускалась).
7. **Без state**: FSRS по природе рекуррентен, а Trane пересчитывает по последним ≤20 trials; усечение истории (старше 20) влияет на S/D — исследование отдельное (`FsrsTruncationStudy`), здесь `[НЕ ПОДТВЕРЖДЕНО]`.
8. Пин `priority-queue = "=2.7.0"` в `fsrs` — потенциальный конфликт версий в большом workspace.
9. Прочее: `cargo tree` для дерева через `--target-dir` не работает (не флаг tree) — не проблема кода. Крейт `fsrs` использует edition 2024 (rustc ≥ 1.85).
