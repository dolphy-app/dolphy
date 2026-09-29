# REPORT: проверка ts-fsrs 5.4.2 + vitest 5.0.2 (fsrs-check)

Каталог: `engine-ts/spike/fsrs-check/`. Среда: macOS arm64, node v22.22.3, npm 10.9.8. Установлено: `ts-fsrs@5.4.2`, `vitest@5.0.2`, `@vitest/coverage-v8@5.0.2`, `typescript@7.0.2` (`npm view typescript version` = 7.0.2; откат на 5.x **не понадобился**: `tsc --noEmit`, `tsx`, `vitest --typecheck` работают с 7.0.2), `tsx@4.23.15`, `@types/node@22`. Эталон: py-fsrs **6.3.2** (venv `/tmp/venvfsrs`, python3.11). Rust-адаптер (`spike/trane-fsrs/fsrs-scorer`, крейт `fsrs 6.6.2`) **не запускался**: нет готового `target/`, сборка крейта не «быстрая»; сравнение с ним `[НЕ ПОДТВЕРЖДЕНО]`.

> **Путь (2026-09-29):** Rust-адаптер FSRS теперь лежит в `engine-ts/reference/fsrs-scorer/` (упоминавшийся ниже `spike/trane-fsrs/fsrs-scorer`; каталог `spike/trane-fsrs/` удалён). Его 12 тестов проходят против `engine-ts/reference/trane-pristine`.

Ссылки вида `dist/index.mjs:N` — строки в `node_modules/ts-fsrs/dist/index.mjs` (1888 строк) версии 5.4.2.

---

## 1. Публичный API ts-fsrs 5.4.2

**Формат/упаковка** (`npm view ts-fsrs@5.4.2`, `package.json`): `"type":"module"`, `main: dist/index.cjs`, `module: dist/index.mjs`, `exports["."]` = `types dist/index.d.ts` / `import,default dist/index.mjs` / `require dist/index.cjs` / `umd dist/index.umd.js`. Проверено: `require('ts-fsrs')` и `import {fsrs} from 'ts-fsrs'` оба работают под node 22 (`v5.4.2 using FSRS-6.0`). `engines.node >=20.0.0`. **Runtime-зависимостей нет** (`npm ls --all --omit=dev` → только `ts-fsrs@5.4.2`; PRNG для fuzz встроен, alea-подобный, `dist/index.mjs:~480-500`). Размер: tarball 150.3 kB, распакованно 706.4 kB (`npm pack --dry-run`), `dist/` 652K: `index.mjs` 60K, `index.cjs` 64K, `index.umd.js` 72K, `index.d.ts` 594 строк. Лицензия MIT.

**Версия алгоритма:** `FSRSVersion = "v5.4.2 using FSRS-6.0"` (`:514`). `default_w.length === 21` (проверено), `default_w[20] = 0.1542` (`FSRS6_DEFAULT_DECAY`, `:520-541`): `[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]`.

**Экспорты** (`index.d.ts:593-594`): классы `FSRS`, `FSRSAlgorithm`, `AbstractScheduler`, `TypeConvert`; фабрики `fsrs`, `createEmptyCard`, `generatorParameters`; enum `Rating` (Manual=0, Again=1, Hard=2, Good=3, Easy=4), `State` (New=0, Learning=1, Review=2, Relearning=3), `StrategyMode`; функции `forgetting_curve`, `computeDecayFactor`, `checkParameters`, `migrateParameters`, `clipParameters`, `clamp`, `roundTo`, `dateDiffInDays`, `date_diff`, `date_scheduler`, `get_fuzz_range`, `fixDate/fixState/fixRating`, `formatDate`, `show_diff_message`, `ConvertStepUnitToMinutes`, `BasicLearningStepsStrategy`, `DefaultInitSeedStrategy`, `GenSeedStrategyWithCardId`; константы `default_w`, `default_request_retention=0.9`, `default_maximum_interval=36500`, `default_enable_fuzz=false`, `default_enable_short_term=true`, `default_learning_steps`, `default_relearning_steps`, `S_MIN=0.001`, `S_MAX=36500`, `INIT_S_MAX=100`, `FSRS5_DEFAULT_DECAY=0.5`, `FSRS6_DEFAULT_DECAY=0.1542`, `W17_W18_Ceiling=2`, `CLAMP_PARAMETERS`, `Grades`. Типы: `Card`, `CardInput`, `ReviewLog`, `RecordLog(Item)`, `FSRSParameters`, `FSRSState`, `FSRSHistory`, `Grade`, `DateInput = Date|number|string`, `Steps`, `StepUnit` и т.д.

**`Card`** (`index.d.ts:43-57`): `due: Date; stability: number; difficulty: number; elapsed_days: number (@deprecated, удалят в 6.0.0); scheduled_days: number; learning_steps: number; reps: number; lapses: number; state: State; last_review?: Date`. `CardInput` — то же, но `state: StateType|State`, `due: DateInput`, `last_review?: DateInput|null` (принимает ms-число и ISO-строку — проверено). `structuredClone(card)` работает (Date клонируется).

**Конфигурация** (`FSRSParameters`, `index.d.ts:88-99`; `generatorParameters`, `dist/index.mjs:~640-660`):
| поле | по умолчанию | замечание |
|---|---|---|
| `request_retention` | 0.9 | `props?.request_retention \|\| 0.9` → 0 превращается в 0.9; значение вне (0,1] → `generatorParameters` пропускает 1.5, а `fsrs({request_retention:1.5})` **бросает** `FSRSValidationError: Requested retention rate should be in the range (0,1]` (`calculate_interval_modifier`, `:714-723`) |
| `maximum_interval` | 36500 | `\|\|` → 0 тоже превращается в 36500 |
| `w` | `default_w` (21) | через `migrateParameters` + `clipParameters` (клип по `CLAMP_PARAMETERS`, `w[8]=99` → 4.5 проверено) |
| `enable_fuzz` | false | PRNG зависит от seed-стратегии (`DefaultInitSeedStrategy`: `` `${time}_${reps}_${d*s}` ``, `:318-323`) |
| `enable_short_term` | true | **выбирает планировщик**: `true` → `BasicScheduler`, `false` → `LongTermScheduler` (`:1473`); также убирает ветку short-term stability и меняет клип w[19] (min 0.01 vs 0) |
| `learning_steps` | `['1m','10m']` | `Steps = StepUnit[]`, формат `${n}${m|h|d}` |
| `relearning_steps` | `['10m']` | |

`fsrs(params)` возвращает `FSRS extends FSRSAlgorithm`; `f.parameters` — Proxy: присваивание `w` / `request_retention` / `enable_short_term` пересчитывает интервал/планировщик (`:1476-1500`).

**Хелперы валидации/миграции**: `checkParameters(w)` — бросает при NaN/∞ и если длина ∉ {17,19,21} (`Invalid parameter length: 5. Must be 17, 19 or 21…`); `migrateParameters(w?, numRelearningSteps, enableShortTerm)` — 21 → клип; 19 → +`[0, 0.5]`; 17 → пересчёт w4/w5/w6 (FSRS-4.5→5) + `[0,0,0,0.5]`; иная длина → `console.warn` + `default_w` (проверено: длина 5 → 21 по умолчанию, тихо, только warn); `clipParameters` (клип по диапазонам, при `numRelearningSteps>1` пересчёт потолка w17/w18). Сообщения `console.debug/warn` в migrate — шум в логах движка.

**`repeat` vs `next`**: `repeat(card, now)` → `IPreview` с четырьмя вариантами Again/Hard/Good/Easy (`RecordLogItem = {card, log}`), итерируемый; `next(card, now, grade)` → один `RecordLogItem` (`:1584`, `:1643`). Разница в стоимости: для New/Learning `next` считает только один грейд, но **для Review-карточки `reviewState` всегда считает все четыре** (`:1098-1128`: 4× `next_ds`, интервалы, даты) и берёт нужный — то есть `next` на Review ≈ `repeat`. Оба возвращают новую карточку, входную не мутируют (проверено).

**`get_retrievability(card, now?, format=true)`** (`:1659-1665`): 
```
t = state !== New ? max(date_diff(now, last_review, 'days'), 0) : 0      // date_diff: Math.floor(diffMs/86400000), :120-128
r = state !== New ? forgetting_curve(t, +stability.toFixed(8)) : 0
return format ? `${(r*100).toFixed(2)}%` : r
```
— **целые дни через floor от 24-часовых интервалов, не дробные**; по умолчанию `format=true` возвращает *строку* (`'0.00%'`), для числа надо `format=false`. Для **New-карточки возвращает 0** (не 1; проверено). `now` раньше `last_review` → R=1 (clamp 0); Review-карта без `last_review` → `FSRSValidationError: Invalid date`; невалидная `Date` → `NaN` (без исключения). Наблюдение: при +0.99 дня R=1.0; при +1.0 → 0.9468475 (ступенька).

**`forgetting_curve`** (`:685-688`): `R = roundTo((1 + factor*t/S)^decay, 8)`, где `decay = -w[20]`, `factor = roundTo(exp(ln(0.9)/decay) - 1, 8)` (`computeDecayFactor`, `:679-684`). Сигнатуры: `forgetting_curve(decay: number, t, S)` и `forgetting_curve(w[], t, S)`; метод `f.forgetting_curve(t, S)` привязан к текущим `w` (нет пересчёта decay на вызов). `t` может быть дробным (проверено: `f.forgetting_curve(0.5, S)=0.97072289`). R(0)=1; R(t=S)=0.9 (проверено: `forgetting_curve(0.1542, 5, 5)=0.9`).

---

## 2. Только модель памяти

### Два способа
1. **Чистая математика: `f.next_state(state|null, t, grade, r?)`** (`FSRSAlgorithm.next_state`, `:944-990`) — аналог fsrs-rs `next_states`/py-fsrs без планировщика. Не требует Card/Date, не создаёт планировщик. Здесь `t` — *любое неотрицательное число* (дробное допустимо). Это рекомендуемый путь.
2. **`fsrs({enable_short_term:true, learning_steps:[], relearning_steps:[], enable_fuzz:false, maximum_interval:36500}).next(card, now, grade)`** — эквивалент py-fsrs `Scheduler(learning_steps=(), relearning_steps=())`. Память считается одинаково при любых `learning_steps` (config C = config A побитно в тесте ниже): шаги влияют только на `state`/`due`/`scheduled_days`.

### Ветвление `next_state` (`:944-990`), константы дословно
- `t < 0` → `FSRSValidationError('Invalid delta_t "-1"')`; `g<0||g>4` → throw.
- `d===0 && s===0` (state=null): `{difficulty: clamp(init_difficulty(g),1,10), stability: init_stability(g)}`; `init_stability(g) = Math.max(w[g-1], 0.1)` (`:791`), `init_difficulty(g) = roundTo(w[4] - exp((g-1)*w[5]) + 1, 8)`.
- `g===0` (Manual) → возвращает вход; **но при `state=null` и `g=0` вернёт `stability: NaN`/null** (`init_stability(0)` читает `w[-1]`; проверено: `{"difficulty":6.9787,"stability":null}`) — не передавать 0.
- `d<1 || s<S_MIN(0.001)` → throw `Invalid memory state`.
- `r = r ?? forgetting_curve(t, s)`
- `t===0 && enable_short_term` → `next_short_term_stability(s,g) = roundTo(clamp(s * (g>=2 ? max(sinc,1) : sinc), 0.001, 36500), 8)`, `sinc = s^-w[19] * exp(w[17]*(g-3+w[18]))` (`:921`).
- иначе `g===1` → `new_s = clamp(roundTo(s/exp(w17*w18), 8), S_MIN, next_forget_stability)` (при `enable_short_term=false` w17=w18=0 → потолок `s`), где `next_forget_stability = roundTo(clamp(w[11]*d^-w[12]*((s+1)^w[13]-1)*exp((1-r)*w[14]), 0.001, 36500), 8)`.
- иначе `next_recall_stability = roundTo(clamp(s*(1+exp(w[8])*(11-d)*s^-w[9]*(exp((1-r)*w[10])-1)*hard_penalty(w[15])*easy_bonus(w[16])), 0.001, 36500), 8)`.
- `next_difficulty = clamp(mean_reversion(init_difficulty(4), d + linear_damping(-w[6]*(g-3), d)), 1, 10)`, `linear_damping = roundTo(Δ*(10-d)/9, 8)`, `mean_reversion = roundTo(w[7]*init + (1-w[7])*cur, 8)`.

**Округление:** *каждый* шаг округляется до 8 знаков (`roundTo(x, 8)` = `Math.round(x*1e8)/1e8`), stability зажата в `[0.001, 36500]`, difficulty в `[1, 10]`. py-fsrs не округляет и не имеет верхнего клипа S=36500. Итог расхождения на накопленных 60 шагах: относительная ошибка S ≤ 1.4e-7 (см. §3, конфиг D).

### Первый обзор (`enable_short_term=true`, `steps=[]`; `src/probe.ts`)
| grade | stability | difficulty | state | scheduled_days |
|---|---|---|---|---|
| Again | 0.212 | 6.4133 | Review | 1 |
| Hard | 1.2931 | 5.11217071 | Review | 1 |
| Good | 2.3065 | 2.11810397 | Review | 2 |
| Easy | 8.2956 | 1 | Review | 8 |

(S = `w[0..3]`; D₀ зажат в [1,10].) С дефолтными шагами первый Good даёт `state=Learning, learning_steps=1, scheduled_days=0`, но те же S/D.

### Same-day (elapsed < 1 дня)
Ключевая находка: **`next()` определяет `elapsed_days` не по 24-часовым интервалам, а по разнице *календарных UTC-дат*** — `dateDiffInDays(last_review, now)` (`:227-241`, использует `Date.UTC(getUTCFullYear/Month/Date)`), вызывается в `AbstractScheduler.init()` (`:365`). Следствие (наблюдение из probe):
- 10:00→12:00 того же дня: t=0 → short-term ветка; Good: S не меняется (2.3065, `max(sinc,1)`), Again: S 2.3065→0.77508398.
- 10:00→23:59 того же дня: t=0.
- 10:00→00:10 следующего дня (14 ч 10 мин): **t=1**, обычная ветка: S 2.3065→7.3153 (на same-day Good было бы 2.3065).
- Идентичный timestamp: не бросает, t=0.
- `now` раньше на 2 ч в тот же день: не бросает (t=0, `last_review` перезаписывается «в прошлое»). `now` раньше на ≥1 календарный день: **бросает** `FSRSValidationError: Invalid delta_t "-5"` (из `next_state`). Раньше на минуты через полночь → t=-1 → тоже бросает.
- Невалидная `Date(NaN)` → `RangeError: Invalid time value` (не `FSRSValidationError`).
- `grade=0` → `Cannot review a manual rating`; `grade=5` → `Invalid grade "5",expected 1-4`.
- Ms-число и ISO-строка в качестве `now` принимаются (`TypeConvert.time`, `:69`).
- Прямой `next_state` при `t=0`: Good → S=5 (не меняется), Again → 1.596818; при `t=0.5` (дробное): Good → 6.71 (t≠0 ⇒ обычная ветка!) — т.е. short-term включается только при **ровно 0**; в py-fsrs — при `days < 1` (floor). Поэтому при вызове `next_state` вручную нужно самому целочисленно делить время.
- `enable_short_term=false` (`LongTermScheduler`): same-day идёт по recall/forget-формулам с R≈1 (Good t=0 → S=5, Again → 0.8086 против 1.5968).

### Что переносить между вызовами `next`
Минимум, чтобы результат `next` был побитно равен: `state` (=Review для не-новой карты), `stability`, `difficulty`, `last_review`. Проверено: карточка, пересобранная как `{...createEmptyCard(), state: Review, stability, difficulty, last_review, reps}`, даёт те же S/D, что и полная (`same S/D after next: true true`). `reps`, `lapses`, `learning_steps`, `due`, `scheduled_days`, `elapsed_days` на память не влияют. Тихие ловушки: карточка `state=Review` **без** `last_review` не бросает в `next` (elapsed=0), но бросает в `get_retrievability`; `state=New` с заполненными S/D **игнорирует** предыдущее состояние (интервал 0, идёт по ветке s≠0/t=0 — то есть трактует как short-term), поэтому не вставлять `New` вместе с S/D. Для `next_state` переносить только `{stability, difficulty}` + собственный «день/время последнего обзора».

---

## 3. Численная эквивалентность

Код: `fixtures/gen_reference.py` (генерация 600 историй и эталона py-fsrs 6.3.2, seed 20260929), `src/equiv.ts` (сравнение). Запуск: `/tmp/venvfsrs/bin/python fixtures/gen_reference.py && npx tsx src/equiv.ts`. Вывод сохранён в `fixtures/equiv-output.txt`, `fixtures/equiv-results.json`; эталон — `fixtures/reference.json` (1.1 MB).

Генератор: 600 историй, 1–60 обзоров (всего 18 564 обзора; 17 964 промежутка), старт — случайная секунда 2025 г. (случайное время суток), промежутки: 40% — 60 с…20 ч, 60% — 1…400 суток (с секундной точностью), оценки 15/5/70/10 % Again/Hard/Good/Easy, 3 запроса на историю: `U(0,2)` дн., `U(1,400)` дн., и случайно один из двух диапазонов. Эталон: `Scheduler(learning_steps=(), relearning_steps=(), enable_fuzzing=False, maximum_interval=36500)`; R эталона — `get_card_retrievability` (целые дни floor, `scheduler.py:232-234`) и та же формула `(1+FACTOR*t/S)^DECAY` с дробными днями (`r_frac`).

**Ключевая цифра:** промежутки, где «календарная UTC-разница дат» ≠ `floor(Δ/24ч)`: **8416 из 17964** (47%), затронуты **584 из 600** историй.

Сводка по всем 600 историям (`S_rel` = |S−S_ref|/S_ref; `D_abs`; `R_get` — `f.get_retrievability(card, now, false)` против R py-fsrs (floor); `R_frac` — `forgetting_curve(w, дробные дни, S)` против формулы py-fsrs с теми же дробными днями и S py-fsrs):

| конфигурация ts-fsrs | S_rel max / mean | D_abs max / mean | R_get vs py(floor) max / mean | R_frac vs py(frac) max / mean | историй с S_rel>1e-6 |
|---|---|---|---|---|---|
| **A** `short_term=true, steps=[], relearn=[]`, через `next()` | 2.17 / 0.161 | 7.4e-8 / 6.8e-9 | 0.332 / 0.0120 | 0.332 / 0.0127 | 584 |
| **B** `short_term=false` (LongTermScheduler), `next()` | 2.17 / 0.284 | 7.4e-8 / 6.8e-9 | 0.339 / 0.0236 | 0.339 / 0.0249 | 586 |
| **C** `short_term=true`, дефолтные шаги, `next()` | 2.17 / 0.161 | 7.4e-8 / 6.8e-9 | 0.332 / 0.0120 | 0.332 / 0.0127 | 584 |
| **D** `next_state()` с `t=floor(Δ/24ч)`, short_term=true | **1.4e-7 / 1.1e-8** | 7.4e-8 / 6.8e-9 | **6.9e-9 / 1.9e-9** | **7.2e-9 / 2.5e-9** | **0** |
| **E** `next_state()` с `t=разница календарных UTC-дат` | 2.17 / 0.161 | 7.4e-8 / 6.8e-9 | 0.332 / 0.0120 | 0.332 / 0.0127 | 584 |

Подмножество без единого расхождения calendar/floor (16 историй): A, C, E: S_rel max 1.3e-8, R_get max 5.3e-9, R_frac max 4.6e-9 (совпадение до округления 8 знаков); B: даже здесь S_rel max 0.93 (2 истории).

**Лучший:** D — `FSRSAlgorithm.next_state` с целочисленным `t = floor((now − prev)/86 400 000)` (по 24-часовому окну, как py-fsrs). Среди конфигураций через `next()` лучшая — A/C (память одинакова, шаги не влияют), но она расходится из-за календарных дней.

### Систематические расхождения (объяснения подкреплены измерениями)
1. **Календарные дни в `next()` (`dateDiffInDays`)**: A ≡ E побитно (одинаковые числа в строках A и E) — то есть вся разница A vs py-fsrs объясняется тем, что `next` берёт разницу UTC-дат, а py-fsrs — `timedelta.days` (floor 24 ч). Например 14-часовой интервал через полночь: ts t=1, py t=0 (short-term ветка). На 16 историях без несовпадений A=py с точностью округления. **Не зависит от часового пояса** (UTC), но зависит от времени суток обзора.
2. **Разница в `enable_short_term=false` (B)**: LongTermScheduler не использует short-term ветку при t=0 (идёт по recall/forget с R≈1: Good S не растёт, Again → потолок `s`, а не `s/exp(w17*w18)`), в py-fsrs же при `<1 дня` всегда short-term. Именно поэтому B хуже A даже на подмножестве без календарных расхождений (2 истории).
3. **Learning-steps**: не влияют на S/D (A ≡ C); влияют лишь на `state`/`due`. Т.е. для «только память» шаги можно оставлять пустыми, но они не нужны и с дефолтными.
4. **Округление 8 знаков на каждом шаге + клип S≤36500** (D vs py): S_rel ≤ 1.4e-7, D_abs ≤ 7.4e-8. Это «шум округления», разница в R ≤ 7e-9.
5. **Целые дни (floor) в `get_retrievability`**: R_get — ступенчатая функция; для эталона py-fsrs собственное расхождение R(floor) vs R(дробные дни) на наших запросах: max **0.230**, mean 2.97e-3 (1800 запросов; `src/equiv.ts`). Поэтому для «плавного» R (например для ранжирования упражнений) брать `forgetting_curve` с дробными днями.
6. **Дробный R подтверждён:** в конфигурации D `R_frac` (ts `forgetting_curve(w, (query−last)/86400, S)`) против формулы py-fsrs `(1+FACTOR*days/S)^DECAY` с теми же дробными днями: max 7.15e-9, mean 2.52e-9 (следствие округления `roundTo(...,8)` в `forgetting_curve` и в `factor`); сравнение идёт при S, посчитанном самим ts-fsrs (в D S_rel≤1.4e-7), поэтому разница — округление, а не различие формул.
7. Difficulty от `t` не зависит, поэтому D_abs одинаков (max 7.4e-8) во всех конфигурациях — накопленный шум округления.

---

## 4. Производительность

Код: `src/perf.ts`; запуск `node --expose-gc --min-semi-space-size=256 --max-semi-space-size=256 --import tsx src/perf.ts`. node v22.22.3, один поток, разогрев 6000 вызовов на конфигурацию, затем 400/100/60 повторов × 200 историй для n=3/20/50 (`process.hrtime.bigint`). Конфиг ts-fsrs: `enable_short_term=true, steps=[]`. Время — мкс на «упражнение» (воспроизведение n обзоров + R):

| вариант | n=3 | n=20 | n=50 |
|---|---|---|---|
| `next()` с Card+Date, `new Date` на каждый шаг + `get_retrievability` | 3.47 | 28.08 | 77.80 |
| `next()` с числом ms в `now` + `get_retrievability` (число) | 3.11 | 25.98 | 70.17 |
| `next_state()` чистые числа, t=календарные дни, R=`f.forgetting_curve` | **0.50** | **3.84** | **9.86** |
| `next_state()` + автономная `forgetting_curve(w,…)` | 0.48 | 3.91 | 9.83 |

Экстраполяция холодного прохода (линейно):
| | 4 500 упр. (n=20) | 15 000 упр. (n=3) | 15 000 (n=20) | 15 000 (n=50) |
|---|---|---|---|---|
| `next()` (Card+Date) | 126 мс | 52 мс | 421 мс | 1 167 мс |
| `next()` (числа) | 117 мс | 47 мс | 390 мс | 1 053 мс |
| `next_state()` | 17 мс | 8 мс | 58 мс | 148 мс |

**Аллокации** (оценка через `process.memoryUsage().heapUsed` до/после 1000 упражнений при `--min/max-semi-space-size=256`, то есть без сборок мусора в интервале — сама «отсутствие GC» не проверялась через `--trace-gc`, `[НЕ ПОДТВЕРЖДЕНО]`): `next()` ≈ 68.6 KB на упражнение n=20 (≈ 3.4 KB на шаг), с числовым `now` ≈ 73.3 KB (шум измерения), `next_state()` ≈ 2.7 KB (≈ 135 B на шаг: объект-результат).

**Что доминирует в `next()`** (CPU-профиль `--cpu-prof`, 60 000×20 шагов, `src/prof-summary.mjs`, самое время в %): `next_state` 15.8, `TypeConvert.card` (клонирование Card + Date) 9.8, `reviewState` 7.8, `mean_reversion` 6.3, `date_scheduler` 5.8, `dateDiffInDays` 5.0, `next_forget_stability` 4.7, `next_recall_stability` 4.4, GC 4.1, `TypeConvert.time` 3.9, `next_ds` 3.2, `roundTo` 3.0. То есть цена — не Date как таковой, а то, что для Review-карточки планировщик считает **сразу 4 грейда** (4× `next_state`/`next_difficulty`, 4 клона карточки, 4 `next_interval`+`date_scheduler`), плюс `new Map`, лог, seed-строка и клонирование в конструкторе (`TypeConvert.card` ×2). Отсюда ×7 против `next_state`.

**Что можно кэшировать (без реализации):** (а) использовать `next_state` вместо `next()` (×7 быстрее и в разы меньше аллокаций); (б) хранить на упражнение только `{stability, difficulty, lastReviewMs}` и реплеить лишь «хвост» новых испытаний (инкрементально), полный replay — только при смене `w`/кэша; (в) кэшировать R по `(stability, lastReviewMs)` и считать `forgetting_curve` лишь при смене «сегодня» (при дробных днях — раз за проход); (г) один экземпляр `fsrs()` на движок (стоимость создания не измерялась); (д) не создавать `Date` на каждый шаг — но выигрыш всего ≈ 10% (см. строки 1 vs 2).

---

## 5. Vitest 5.0.2

Установлено и проверено в каталоге. Файлы: `package.json` (версии закреплены точно: `ts-fsrs 5.4.2`, `vitest 5.0.2`, `@vitest/coverage-v8 5.0.2`, `typescript 7.0.2`; `engines.node ">=22.12"`), `tsconfig.json`, `vitest.config.ts`, `test/memory.test.ts`, `test/memory.bench.ts`, `test/types.test-d.ts`, `src/memory.ts`.

- **Node**: `vitest@5.0.2` `engines.node: ^22.12.0 || ^24.0.0 || >=26.0.0` (`node_modules/vitest/package.json:109-111`); Node 20 больше не поддерживается (vitest 2/3 работали на 18/20).
- **`vitest.config.ts`** (рабочий, минимальный):
  ```ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({ test: {
    pool: 'forks', environment: 'node', include: ['test/**/*.test.ts'],
    benchmark: { include: ['test/**/*.bench.ts'] },
    typecheck: { enabled: false, include: ['test/**/*.test-d.ts'] },
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/perf.ts','src/equiv.ts','src/probe.ts'], reporter: ['text'] },
  } });
  ```
- **Тесты**: `npx vitest run` → `Test Files 1 passed, Tests 3 passed`, ~70 мс.
- **TypeScript 7.0.2**: `tsc --noEmit` = 0 ошибок (модуль `NodeNext`, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`); `tsx` (esbuild) и vitest транспиляция работают с TS 7 — откат на 5.x не потребовался.
- **`vitest --typecheck`**: работает: `npx vitest run --typecheck` → `Type Errors no errors`, и `--typecheck.only` запускает только `*.test-d.ts`. Проверено, что он реально ловит ошибки (временная подмена `toEqualTypeOf<string>()` → `FAIL`, exit≠0). Печатает «experimental feature» (`Testing types with tsc and vue-tsc is an experimental feature`). Файлы `*.test-d.ts` в `include` для `run` не попадают, если не указан `typecheck.include`.
- **Покрытие v8**: `@vitest/coverage-v8@5.0.2`: собственно пакет 60K; вместе с транзитивными (`ast-v8-to-istanbul`, `magicast`, `@bcoe/v8-coverage`, `@vitest/istanbul-lib-*`, `obug`, `std-env`) ≈ **1.0 MB**. Работает: `npx vitest run --coverage` → таблица (`memory.ts 100% stmts / 75% branch`) — v8 без инструментирования; пакет обязан совпадать по версии с `vitest`.
- **Весь `node_modules`**: 84 МБ; крупнее всего платформенные бинарники: `@typescript/typescript-darwin-arm64` 26 МБ (нативный TS 7), `@rolldown/binding-darwin-arm64` 16 МБ, `@esbuild/darwin-arm64` 10 МБ, `lightningcss-darwin-arm64` 8.2 МБ; сам `vitest` 3.0 МБ, `ts-fsrs` 0.7 МБ.
- **`vitest bench` (новое API)**: см. «трение» п.1: **экспорта `bench` нет**; `bench` — фикстура контекста теста: `test('…', async ({ bench }) => { const r = await bench.compare(bench('a', fn), bench('b', fn)); r.get('a').latency.mean … })` (типы `Bench`, `BenchCompare`, `BenchRegistration.run()`, `bench.from()` — `dist/chunks/config.d.*.d.ts:1946-2062`). Запуск: `npx vitest bench --run --reporter=verbose` — таблица печатается **только с verbose-репортёром** (при дефолтном репортёре вывода нет). Замер из `test/memory.bench.ts`: `replay 20 trials` 340 531 оп/с (mean 0.0030 мс, 334 624 семпла); `replay 50 trials` 120 622 оп/с (mean 0.0084 мс) — это 2.9 и 8.3 мкс на вызов `replay` (только `next_state`, без расчёта R); сопоставимо с §4 (3.84/9.86 мкс с R и другим набором историй). `tinybench ^6.1.4` — зависимость vitest.
- Дополнительно: `benchmark.provider` (экспериментально), `writeResult`, `perProject` в опциях `bench`.

---

## Что вызвало трение
1. **Vitest 5: `import { bench } from 'vitest'` больше не существует** — на `vitest bench` получаем `TypeError: bench is not a function`; tsc: `'"vitest"' has no exported member named 'bench'`. `bench` теперь фикстура теста (`test(…, async ({bench}) => …)`); вывод в таблицу — только `--reporter=verbose`.
2. **`get_retrievability` по умолчанию возвращает *строку*** (`'97.07%'`) — надо `format=false`; для New-карточки возвращает 0, не 1; целые дни (floor).
3. **`next()` считает `elapsed_days` по разнице календарных UTC-дат**, а `get_retrievability` — по `floor(Δ/24ч)`: два разных «дня» в одной библиотеке; из-за первого py-fsrs/fsrs-rs-эквивалентность через `next()` теряется на 47% промежутков (§3).
4. **`exactOptionalPropertyTypes: true`** ломает передачу `last_review: undefined` в `Card|CardInput` (TS2379) — нужен `null` (в `CardInput`) или отсутствие ключа; `CardInput.last_review?: DateInput|null`, `Card.last_review?: Date`.
5. `generatorParameters`/`fsrs` используют `||`: `request_retention:0` и `maximum_interval:0` молча превращаются в 0.9 / 36500; `request_retention>1` бросает только в `fsrs()`, не в `generatorParameters`.
6. `migrateParameters` при неверной длине `w` молча (только `console.warn`) подставляет `default_w`; при 17/19 пишет `console.debug`. Для движка — валидировать `w` самим через `checkParameters`.
7. `next_state(null, 0, 0)` даёт `stability: NaN`; `next()` с невалидной `Date` — `RangeError`, не `FSRSValidationError`; `next()` не проверяет `now < last_review` в пределах суток.
8. Карточка `Review` без `last_review` в `next()` тихо даёт elapsed=0, в `get_retrievability` — throw; `New` с заполненными S/D обрабатывается как short-term-повтор.
9. `enable_short_term` — не «просто флаг»: переключает класс планировщика и потолок forget-стабильности (`s/exp(w17*w18)` vs `s`), и клип w[19].
10. `fsrs()` — `Proxy` над параметрами; присваивание `f.parameters.w` пересоздаёт привязку `forgetting_curve` и `intervalModifier` (`:1476-1500`); стоимость не измерялась `[НЕ ПОДТВЕРЖДЕНО]`.
11. Поля `Card.elapsed_days` / `ReviewLog.elapsed_days` помечены `@deprecated` (удалят в 6.0.0) — не использовать в DTO движка.

## Рекомендуемый рецепт для движка (реплей последних N испытаний упражнения)

```ts
import { fsrs, type FSRSState, type Grade } from 'ts-fsrs';

const DAY_MS = 86_400_000;
// один экземпляр на движок; w — либо default_w, либо оптимизированные (валидировать checkParameters)
const alg = fsrs({ enable_short_term: true, learning_steps: [], relearning_steps: [],
                   enable_fuzz: false, maximum_interval: 36500, request_retention: 0.9 });

interface Trial { at: number /* epoch ms */; grade: Grade /* 1..4 */ }

/** Состояние памяти после реплея хронологически отсортированных испытаний (последние N). */
export function replay(trials: readonly Trial[]): FSRSState | null {
  let st: FSRSState | null = null; let prev = 0;
  for (const [i, tr] of trials.entries()) {
    const t = i === 0 ? 0 : Math.floor((tr.at - trials[i - 1]!.at) / DAY_MS);   // 24-ч окно, как py-fsrs
    st = alg.next_state(st, Math.max(0, t), tr.grade);
  }
  return st;
}
/** R с дробными днями; 0 для неизученного (в py-fsrs/ts-fsrs New → 0). */
export function retrievability(st: FSRSState | null, lastAt: number, now: number): number {
  return st ? alg.forgetting_curve(Math.max(0, now - lastAt) / DAY_MS, st.stability) : 0;
}
```
Причины: (1) `next_state` вместо `next()` — совпадает с py-fsrs (`S_rel≤1.4e-7`, `R≤7e-9`) и в ~7 раз быстрее (3.8 мкс vs 26–28 мкс на 20 обзоров); (2) `t` целое по 24-ч окну — иначе ts-fsrs `next()` сдвигает t по календарной границе UTC; (3) `t=0` внутри одного 24-ч окна включает short-term-ветку (как py-fsrs `days<1`); (4) без `Date`/`Card` — DTO-совместимо и без клонирований; (5) реплей при N последних испытаний даёт точное состояние только если хронологический порядок гарантирован (отрицательное `t` — throw; отсортировать и `Math.max(0,…)`), а если у упражнения есть более старая история, «обрезанный» реплей с новой первой точкой `init_stability/init_difficulty` даёт другое S/D — это модельное решение движка `[НЕ ПОДТВЕРЖДЕНО]` (не измерялось). Если понадобятся `due`/`state`/шаги, использовать `next()` с `now` как числом ms; хранить/пересобирать карточку только из `{state: Review, stability, difficulty, last_review}`.

## Файлы
`fsrs-check/`: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `src/{equiv,probe,perf,memory}.ts`, `src/prof-summary.mjs`, `test/{memory.test.ts,memory.bench.ts,types.test-d.ts}`, `fixtures/{gen_reference.py,reference.json,equiv-results.json,equiv-output.txt,probe-output.txt}`. `node_modules/` удалён после работы.
