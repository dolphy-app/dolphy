# Math Academy (mathacademy.com) — исследование

Легенда источников: **[ОФИЦ-сайт]** — страницы mathacademy.com; **[ОФИЦ-Skycak]** — тексты Justin Skycak (Director of Analytics, автор FIRe) на justinmath.com / рабочий черновик книги *The Math Academy Way* (© Math Academy, LLC) — считаем официальной позицией компании, но это не рецензируемые публикации; **[3rd-party]** — сторонние интерпретации (отмечены явно). Всё, что не удалось проверить, помечено `[НЕ ПОДТВЕРЖДЕНО]`.

## 1. Что это

Math Academy — закрытая коммерческая подписочная платформа автоматизированного обучения математике: от 4-го класса до университетского уровня (Linear Algebra, Multivariable Calculus, Methods of Proof, Mathematics for ML и т.д.). Сайт называет себя «AI-powered, fully-automated», при этом «AI» — это expert system, эмулирующая решения опытного тьютора, а не LLM ([how-our-ai-works](https://www.mathacademy.com/how-our-ai-works); [how-it-works](https://www.mathacademy.com/how-it-works)).

- **Лицензия / открытость:** проприетарная. Книга: «All rights reserved», © 2023-present Math Academy, LLC ([the-math-academy-way.pdf](https://www.justinmath.com/files/the-math-academy-way.pdf)). Skycak прямо пишет: «While the specific implementation is proprietary, I can talk about the high-level ideas» ([FIRe-статья](https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/)). Исходного кода, схем данных и API нет. Учебные тексты Skycak (учебники, блог) свободно доступны, но это не контент курсов платформы.
- **Люди:** основатели Jason Roberts (технологии; по собственному описанию — HFT-системы, ранние real-time технологии Uber) и Sandy Durell Roberts (операции); Justin Skycak — Chief Quant & Director of Analytics, автор FIRe; в книге также названы Alexander Smith, Yurii Leshchenko ([about-us](https://www.mathacademy.com/about-us); [justinmath.com](https://www.justinmath.com/); PDF книги).
- **История:** возникла из школьной программы в Pasadena USD; после COVID из системы домашних заданий превратилась в автономную платформу (внутреннее название «automator-inator») ([about-us](https://www.mathacademy.com/about-us)).
- **Статус:** сайт до сих пор пишет «Beta», «JOIN BETA», «core team is extremely small». Аккредитация WASC; зарегистрирована в UC Directory of Online Publishers ([about-us](https://www.mathacademy.com/about-us); [FAQ](https://www.mathacademy.com/faq)). Книга: рабочий черновик, обновлён 13 August 2026 (по титулу PDF). Пост о FIRe опубликован 2023-10-05, в 2026 переименован в «HSRS».

## 2. Архитектура и стек

**Стек, хранилище, формат данных, деплой — НЕ опубликованы** `[НЕ ПОДТВЕРЖДЕНО]`. Есть только логическая архитектура из [how-our-ai-works](https://www.mathacademy.com/how-our-ai-works): четыре компонента.

| Компонент | Что делает (официально) |
|---|---|
| Knowledge graph | Хранит всё, что знает тьютор о структуре математики: темы, лёгкие/сложные вариации задач, необходимые знания, «key prerequisites» для точечной ремедиации |
| Student model | Накладывает историю ответов на граф → «knowledge profile» (что и насколько хорошо известно); основа — spaced repetition |
| Diagnostic algorithm | Минимизирует число вопросов для оценки профиля; ищет «knowledge frontier» |
| Task-selection algorithm | Выбирает уроки/ревью, максимизируя «learning per unit of time» |

- Деплой: веб-приложение, SaaS (Stripe для платежей — [FAQ](https://www.mathacademy.com/faq)). Мобильные/офлайн-клиенты не упоминаются.
- Контент: «All of our content and exercises are created in-house» (книга, FAQ «Where do the exercises...»). Есть аналитика на всех уровнях: тема → knowledge point → отдельный вопрос (книга, ch.21 «Content Remediation»).
- Масштаб графа: «multiple thousands of interlinked topics»; в статье 2024-11 — «~2500 topics», у каждой 3–4 knowledge points ([KG creation](https://justinmath.com/how-math-academy-creates-its-knowledge-graph)); курс ≈ 300 тем (AP Calculus BC ≈ 6000 XP, ~20 мин/тему — [FIRe-статья](https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/)).

## 3. Модель знаний и зависимостей

Иерархия сущностей **[ОФИЦ-Skycak]** (книга, ch.4; [KG creation](https://justinmath.com/how-math-academy-creates-its-knowledge-graph)):

```
Knowledge graph (граф тем, курс = подмножество графа)
 └─ Topic (≈2500; тема = один урок)
     └─ Knowledge point (3–4 на тему; ступени возрастающей сложности)
         ├─ worked example + вопросы «как в примере»
         └─ ≥1 key prerequisite (ссылка на тему, максимально используемую в этом KP)
Рёбра:
  prerequisite  (topic → topic): «что можно учить дальше»
  key prerequisite (knowledge point → topic): для таргетной ремедиации
  encompassing + weight ∈ [0,1]: «сколько простой темы практикуется при решении сложной»
```

Ключевые факты:

1. **Prerequisite ≠ encompassing.** Prerequisite-граф — «forwards graph» (что готов учить), encompassing-граф — «backwards graph» (куда «стекает» кредит). «Encompassed topics are usually prerequisites, but prerequisites are often not fully encompassed» ([how-our-ai-works](https://www.mathacademy.com/how-our-ai-works); FIRe-статья). Skycak: если запускать FIRe на prerequisite-графе, «you're going to get a lot of incorrect repetition credit trickling down» (FIRe-статья, «Follow-Up»).
2. **Веса.** Вес encompassing трактуется как «вероятность, что случайная задача сложной темы охватывает случайную задачу простой». Веса ставит эксперт; не нужна полная матрица (десятки миллионов ячеек) — достаточно рёбер, где вес нетривиален, не выводится потоком повторений и расстояние в prerequisite-графе мало; это ≈ direct и key prerequisite edges, число которых растёт линейно. Допустим вес 0 на prerequisite-ребре ([FIRe-статья](https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/); книга ch.29).
3. **Non-ancestor encompassings и mastery floors:** эквивалентные темы в разных курсах (напр. алгебраическая и матанализ-статистика) связываются полным encompassing без prerequisite-пути; «mastery floor» курса — темы нижних курсов, автоматически считающиеся освоенными (книга ch.29).
4. **Создание графа — вручную.** «The answer: We handcraft it.» Skycak: ~250 часов (1500 тем × 5 prereq × 2 мин) на первичную расстановку encompassing весов, «pre-ChatGPT»; curriculum director ведёт prerequisite-граф, Skycak — encompassing-граф, оба обновляются при каждом новом/изменённом топике ([KG creation](https://justinmath.com/how-math-academy-creates-its-knowledge-graph); FIRe-статья). Инструменты «облегчают нагрузку», но автоматической генерации графа нет.
5. Конкретных файловых форматов/схем (JSON, SQL) нет `[НЕ ПОДТВЕРЖДЕНО]`. Единственный публично доступный пример узлов — иллюстрации: *Adding Fractions With Unlike Denominators* ← {*…Using Models*, *Adding Fractions and Whole Numbers*} ← *Adding Fractions and Whole Numbers Using Models*.
6. Гранулярность: «~10× более мелкое scaffolding, чем в учебнике»: калькулюс — ~300 тем × ~3 KP ≈ 1000 «ступенек» vs ~100 секций учебника ([pedagogy](https://www.mathacademy.com/pedagogy)).

## 4. Алгоритм обучения/повторения

### 4.1 Петля урока **[ОФИЦ-сайт]** ([how-it-works](https://www.mathacademy.com/how-it-works))
Урок = knowledge points; каждый начинается с worked example; далее до 5 практических задач; 2 правильных подряд → следующий KP, иначе доп. задачи. Чем выше точность, тем меньше вопросов; при ошибках число вопросов растёт; при слишком многих ошибках урок **останавливается** ([how-our-ai-works](https://www.mathacademy.com/how-our-ai-works)). Первый урок ≈ 10 вопросов, ревью — 3–5 вопросов (FIRe-статья, «Follow-Up»).

### 4.2 Knowledge frontier и выбор новых тем
- Frontier = граница между известным/неизвестным; новые уроки всегда берутся с frontier (книга ch.4).
- **Layering:** ученик сразу переходит к новым темам, когда освоены prerequisites; «not held back» ради повторения сверх необходимого ([how-our-ai-works](https://www.mathacademy.com/how-our-ai-works)).
- **Non-interference:** одновременно учатся непохожие темы, близкие разносятся по времени ([pedagogy](https://www.mathacademy.com/pedagogy)).
- Порядок на dashboard — по «importance»: сколько ревью «выбивает» имплицитно, сколько дальнейшего контента зависит от урока «и др. факторы»; dashboard — «ever-changing menu at a math buffet», а не очередь (книга, FAQ Task Dashboard). Выбранная задача обычно остаётся на dashboard (психологические причины).
- Жёсткое правило: в среднем ученик должен иметь возможность делать урок ≥ ~25% времени (книга ch.22, «Progress vs XP»).
- Ученик **не может** выбирать произвольные темы и править knowledge profile: «Learners... massively overestimate self-reported knowledge» (книга, FAQ «Features that Do Not Exist for a Good Reason»).

### 4.3 FIRe / Spaced Repetition Compression **[ОФИЦ-Skycak]**
- **Проблема:** классический SRS рассчитан на независимые flashcards; в математике повторение сложной темы «trickle down» к простым. Кредит идёт только по **encompassing**, а не prerequisite; он дисконтируется (часто слишком рано для полного зачёта); encompassings дробные.
- **Поток кредита:** успешное ревью → кредит вниз по encompassing-графу («like lightning bolts»), на много слоёв; **провал** → штраф вверх к темам, для которых упавшая тема — компонента («like growing trees»). Частичные encompassings: кредит затухает по ветвям, по «стволу» полных encompassings идёт без потерь.
- **Repetition Compression:** при наличии due-ревью система подбирает минимальный набор задач (в т.ч. новых уроков), имплицитно покрывающих все due; затем заглядывает вперёд, «отбивая» будущие ревью и равномерно поднимаясь по графу, чтобы сохранить выбор. Пример: due на *Multiplying One-Digit Numbers*, *Adding One-Digit to Two-Digit*, *Multiplying Two-Digit by One-Digit* → достаточно одного ревью на последнюю ([how-our-ai-works](https://www.mathacademy.com/how-our-ai-works)). Аналогия «dominoes». Если due-ревью не удаётся выбить имплицитно, выдаётся явное ревью — забывание «в ожидании» не допускается (FIRe-статья, «Theoretical Safeguard»).
- **Теоретические границы эффективности:** max — цепочка полных encompassings (явные ревью нужны только при застревании); min — независимые карточки; «considerable minority of encompassings goes a long way» (FIRe-статья; график в книге ch.31).
- **Student-topic learning speed:** отношение «ускорения от способности ученика» к «замедлению от сложности темы». Ability — точность ответов с большим весом недавним, плюс распространение правильных ответов вниз и неправильных вверх; стартовое значение — предсказание по «local neighborhood» (direct/key prerequisites, encompassings, same-module topics); difficulty — точность серьёзных студентов на assessments по всем инстансам темы (книга ch.29). Speed 2× → ревью = 2 repetitions, 0.5× → 0.5 repetition (FIRe-статья).
- **Если speed < 1** — весь входящий имплицитный кредит отбрасывается, ревью принудительно явные («preventative remediation», книга ch.21).
- **Высокоуровневая модель** и формулы — см. 4.4.
- **Back-of-envelope Skycak в защиту компрессии:** 3 новые темы/день × 4 вопроса ревью, суммирование по интервалам → ~60 ревью-вопросов/день, «tsunami of review» без FIRe (FIRe-статья, «Follow-Up»).
- Реализация — не опубликована: конкретный вид `interval(repNum)`, функция `rawDelta`, `decay`, `speed`, порог «due» `[НЕ ПОДТВЕРЖДЕНО]`.

### 4.4 Проверка формул из исходного тезиса

Проверяемое утверждение:

```
repNum <- max(0, repNum + speed * decay^failed * rawDelta)
memory <- max(0, memory + rawDelta) * 0.5^(days/interval)
```

**Статус: ВЕРИФИЦИРОВАНО (по структуре) — обе формулы присутствуют в официальном источнике.**

- Источник 1: [Skycak, «Hierarchical Spaced Repetition (HSRS): Spaced Repetition Compression and Fractional Implicit Repetition (FIRe)»](https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/), раздел «High-Level Structure of Spaced Repetition Model». Опубликованный LaTeX:
  `repNum → max(0, repNum + speed · decay^failed · rawDelta)`
  `memory → max(0, memory + rawDelta) · (0.5)^(days / interval)`
- Источник 2: книга *The Math Academy Way*, ch.29, «High-Level Structure» — те же определения переменных (в текстовой выгрузке PDF сами формулы не извлеклись, извлечены только определения; формулы видны в блоге).
- Определения (официальные):
  - `repNum` — число успешных раундов spaced repetition по теме; `days` — дней с предыдущего повторения; `interval` — идеальное число дней между repNum и repNum+1;
  - `memory` — ожидаемая сохранность сейчас; убывает со временем, ревью «due», когда memory достаточно низка; используется и для дисконта слишком раннего повторения;
  - `speed` — student-topic learning speed; `failed` = 1 при провале, 0 при успехе;
  - `rawDelta` — сырой кредит (>0 при успехе, <0 при провале), величина зависит от качества работы и дисконтируется при раннем ревью; включает имплицитный кредит вниз/штраф вверх по encompassing;
  - `decay` ≥ 1, начинается с 1 и растёт по мере просрочки (модель «summer slide»).
- Что **не** подтверждено: числовые значения `decay`, `speed`-функции, вид `interval` от `repNum`, порог due по `memory`, формулы `rawDelta`; то, что `0.5` означает именно полураспад за `interval` — следует из формулы, но явно так не названо. Автор оговаривает: конкретная реализация проприетарна, это «high-level structure».
- Оговорка: это описание модели, а не исходный код; «формулу реализуй как есть» недостаточно — не хватает калибровочных функций. Сравнение с FSRS в официальных источниках не приводится `[НЕ ПОДТВЕРЖДЕНО]`.

## 5. Верификация мастерства

Только **детерминированная проверка ответов** (правильно/неправильно + время), LLM-оценщика нет — и это осознанная позиция: «Dialogue isn't even necessary. We simply hardcode explanations into bite-size pieces» (книга, FAQ «Why doesn't Math Academy use LLMs»).

- **Уроки:** нужно набрать достаточно верных ответов на каждом KP; неудача → остановка, повтор позже с **другими вопросами** и задержкой.
- **Диагностика:** измеряет mastery и automaticity (время ответа учитывается) — [how-it-works](https://www.mathacademy.com/how-it-works); [FAQ](https://www.mathacademy.com/faq).
- **Quizzes:** таймированные, каждые ~150 XP, без доступа к материалам, случайные темы из ранее изученного (приоритет — курс ученика, исключаются темы, уже квизившиеся или охваченные другими квизуемыми); сложность адаптируется под ожидаемые ~80% (выше 80% → чуть сложнее вариации, ниже → проще); любая ошибка → немедленный remedial review; опциональный ретейк (новые вопросы) за доп. XP ([how-our-ai-works](https://www.mathacademy.com/how-our-ai-works); [how-it-works](https://www.mathacademy.com/how-it-works)). Медленный ответ считается как недостаточный automaticity; время настраивается в Accommodations.
- Для кредитных курсов — midterms и final ([FAQ](https://www.mathacademy.com/faq)).
- **Формат вопросов:** в статье и FAQ — вопросы с вариантами (в FAQ книги упомянут вопрос «answer choice letter... came up more frequently»), а также multistep-задачи `[ЧАСТИЧНО: детали форматов ввода не опубликованы]`. CAS/sandbox-верификация не описана `[НЕ ПОДТВЕРЖДЕНО]`.
- Anti-cheating: банк вопросов на каждую тему; индивидуализированные randomized-оценки; нет кнопки «I don't know» на квизах (её злоупотребляли) (книга ch.22 и FAQ).
- **Question generators:** официально «large bank of questions for each topic» (книга); Skycak: «The questions are different every time» (FIRe-статья, «Follow-Up»). Все вопросы и решения «handcrafted» (KG creation). Процедурные генераторы **не** упомянуты `[НЕ ПОДТВЕРЖДЕНО]`.

## 6. Синхронизация, офлайн, приватность, экспорт/импорт

- **Local-first: нет.** Состояние — на сервере компании (сервер-центричная модель); офлайн-режим, синхронизация между устройствами, экспорт/импорт knowledge profile — нигде не описаны `[НЕ ПОДТВЕРЖДЕНО]`.
- Приватность: политика не анализировалась; сведений о хранении данных в прочитанных страницах нет `[НЕ ПОДТВЕРЖДЕНО]`.
- Перерыв: приостановка подписки 30–90 дней; оверсайт-аккаунт (родитель/учитель/тьютор) может делиться прогрессом ([FAQ](https://www.mathacademy.com/faq)). После долгого перерыва рекомендуют **повторную диагностику** — «peels back» knowledge frontier (FIRe-статья). Есть «supplemental diagnostics» — мини-диагностики для актуализации профиля при изменении графа (книга ch.30).
- Аккаунты: оплата картами через Stripe; PayPal и prepaid не принимаются (FAQ).

## 7. Авторинг контента

- Весь контент, метаданные, упражнения — «created in-house by a team of math experts» ([KG creation](https://justinmath.com/how-math-academy-creates-its-knowledge-graph); книга). Никакого пользовательского/open-контента.
- Трудозатраты (официально, Skycak): узкое место — экспертная ручная разметка графа; графы и encompassings обновляются при каждом новом топике; ~250 ч только на первичные encompassing-веса.
- **AI/LLM в авторинге:** утверждение «pre-ChatGPT... не было инструментов» относится к первичной разметке; современное использование LLM в авторинге не описано `[НЕ ПОДТВЕРЖДЕНО]`. Использование LLM в обучении отвергнуто.
- **Content remediation:** если тема вызывает трудности у «более чем небольшого процента» студентов — правится контент (не понижается планка, а добавляется scaffolding, промежуточный KP или тема делится) — книга ch.21. Pass rate: на сайте FAQ — 93% с первой попытки / 98% со второй; в книге (более новой) — 95% / 99% (расхождение источников).
- Curriculum comparisons с учебниками для полноты (книга).

## 8. Монетизация / рынок / аудитория

- **Цена (официально):** «Only $49/mo per student» на [главной](https://www.mathacademy.com/); в книге (ch.1 и FAQ): «$499/year (26× cheaper)» относительно репетитора $50/час ≈ $13 000/год. Страница /pricing вернула 404. Бесплатного trial нет; 30-дневный полный возврат; далее возвратов нет; пауза 30–90 дней; скидок/PPP нет (пока «Beta») ([FAQ](https://www.mathacademy.com/faq)). Charter-школы: закупки по PO у ряда сетей (Cottonwood, Sky Mountain, Suncoast Preparatory).
- **[3rd-party]:** обсуждение цены $49/мес и $500/год (snippet [biggo.com](https://biggo.com/news/202508150714_Math_Academy_Price_Debate), полностью не читалось) `[НЕ ПОДТВЕРЖДЕНО в деталях]`.
- **Аудитория (официально):** одарённые школьники, homeschool, взрослые (серия Mathematical Foundations I–III: «за год до университетских курсов при ~1 ч/день, 5 дней/нед»). Позиционирование — «serious learners», «не edutainment»; для студентов без энергии/мотивации — «not part of our target market» (книга FAQ).
- **Заявленные результаты:**
  - «4× быстрее традиционного класса» — расчёт: AP Calculus BC ≈ 6000 XP против ≈17 600 мин школы (+тесты, подготовка → ≈24 000 мин) ([FAQ](https://www.mathacademy.com/faq); книга ch.2). Это расчёт длительности, а не рандомизированное исследование.
  - Skycak: «We don't have any official academic studies out at the moment»; косвенные свидетельства — школа в Pasadena (AP Calculus BC в 8 классе; в год перехода на автоматическую систему большинство сдали, большинство сдавших — на 5; из 4 внешних учеников трое 5 и один 4) — FIRe-статья. Ссылка [mathacademy.us/press](https://www.mathacademy.us/press) не открывалась в этой сессии `[НЕ ПОДТВЕРЖДЕНО]`.
  - Отзывы на главной и цитаты рецензентов книги — маркетинговые/анекдотические. Цитата opened.co «180 classroom hours → 20–40 hours» — стороннее утверждение на главной ([opened.co](https://opened.co/blog/ai-tutors-homeschool), не читалась) `[НЕ ПОДТВЕРЖДЕНО]`.
- Каталог курсов: основной трек — 4th Grade → AP Calculus BC → университетские курсы; часть курсов «under development» (на главной).

## 9. Сильные и слабые стороны

**Сильные (с опорой на источники)**
- Чёткое различение prerequisite и encompassing; модель «дробного кредита» интерпретируема и даёт снижение объёма ревью (аргументация FIRe-статьи).
- Точечная ремедиация через key prerequisites (KP → тема), а не «пересдай весь курс».
- Диагностика ~20–60 вопросов вместо 500+ за счёт сжатия графа и корреляционного вывода; учёт времени ответа и «conditional completion» (книга ch.30).
- Продуманная система анти-абьюза XP (штрафы, лиги, отсутствие «I don't know»); измерения эффекта штрафов: pass rate у «XP hackers» с <50% до >90% (книга ch.22).
- Полностью детерминированная проверка, отсутствие LLM-в-петле; открытая методологическая книга.
- Метрика прогресса отделена от XP (progress растёт только при завершении урока) — защита от парадоксов.

**Слабые / риски**
- Закрытость: формулы `interval`, `rawDelta`, `decay`, `speed` не опубликованы; воспроизводимость и независимая валидация невозможны.
- Нет рецензируемых исследований эффективности; «4×» — арифметика длительности; Skycak это признаёт.
- Масштабируемость авторинга: граф и веса — ручной труд «на грани человеческого масштаба»; при добавлении темы нужно править encompassing-граф вручную; зависит от одного-двух экспертов (по описанию Skycak).
- Применимость: Skycak сам говорит, что стратегия работает при «serious density of encompassings»; для доменов без таковых лимит на имплицитное «выбивание» ревью; перенос на другие области — гипотеза `[НЕ ПОДТВЕРЖДЕНО]`.
- Нет свободы выбора траектории (ограничено осознанно); жёсткая «gym-модель» отсеивает менее мотивированных.
- Проприетарность, серверная модель, нет экспорта, офлайна, local-first; статус «Beta» годами.
- Расхождения в собственных цифрах (pass rate 93/98 vs 95/99; диагностика «30–45 минут» на сайте vs «20–60 вопросов» в книге) — вероятно, разные даты; книга свежее.

## 10. Что заимствовать / чего избегать

1. **Заимствовать: два разных графа.** Хранить `prerequisite` (что можно учить) и `encompasses` (с весом 0..1, «сколько простого практикуется при сложном») как отдельные рёбра. Валидатор графа должен проверять оба (ацикличность prerequisite, транзитивная редукция; для encompassing — вес ∈ [0,1], encompassed ⊆ обычно ancestor, либо явный флаг non-ancestor).
2. **Заимствовать: `key_prerequisites` на уровне knowledge point**, а не темы — прямой механизм таргетной ремедиации (fail дважды на одном KP → ревью key prereq). Хорошо ложится на Markdown-фронтматтер: `knowledge_points[].key_prereqs`.
3. **Заимствовать: FIRe-логику как отдельный слой над FSRS.** Стандартный FSRS-state (stability/difficulty) на тему + пропагация «fractional credit» вниз по encompassing и «penalty» вверх; `speed` как модификатор. Из опубликованного взять структуру: `rawDelta` (качество), дисконт раннего повторения, `decay` при сильной просрочке, отсечение имплицитного кредита при `speed < 1`. **Калибровочные функции придётся придумывать и проверять самим** — они не опубликованы.
4. **Заимствовать: Repetition Compression как задачу выбора** (покрыть максимум due-тем минимумом задач, в том числе новых уроков; затем отбить будущие). Реализуема как жадный set-cover над encompassing-весами; UI — «меню задач», а не очередь. Прямой ответ на риск «remediation burnout / лавина ревью».
5. **Заимствовать: диагностику на сжатом графе** (покрытие: у темы есть предок и потомок в сжатом графе ≤ 3 рёбер) + plus-minus balance с весом ответа, уменьшаемым при медленном ответе; conditional completion + «падение назад» при провале. Для локальной платформы — детерминированно, без LLM.
6. **Заимствовать: политику «остановить урок при провале, вернуть позже с другими вопросами; при повторном застревании — ремедиация prerequisite»** как антивыгорание; плюс правило «≥ ~25% времени — новые уроки» и начало курса с тем, не зависящих от недостающих основ (momentum).
7. **Заимствовать: банк вопросов на тему + детерминированная проверка + метрики качества контента по вопросу/KP** (pass rate, время) для «content remediation» в open-репозиториях; автоматические сигналы для ревьюеров вместо доверия автору.
8. **Избегать: ручной расстановки всех encompassing-весов одним экспертом.** У MA это ~250 ч на 1500 тем. Для open-модели: LLM предлагает веса → валидатор проверяет ограничения (в т.ч. что ребро уже prerequisite или явный non-ancestor) → веса калибруются по реальным данным (совместные успехи/провалы) `[идея наша, не из источников]`.
9. **Избегать: закрытой модели, серверного состояния и запрета управления профилем.** Наши требования (SQLite local-first, sync вне Git, экспорт) противоположны MA; при этом обоснование «нельзя править профиль» разумно — оставить самоотчёт как подсказку, но не как источник истины; поддерживать «повторную диагностику» после перерыва вместо ручного редактирования.
10. **Избегать: XP-геймификации по умолчанию как ядра.** У MA XP/лиги — рычаг против «XP hackers» в школьной среде и опциональны (opt-out); для инженеров/PKM-аудитории оставить XP-time как опцию, а honest-signal обеспечивать самим механизмом (таймированные quiz без подсказок, различные вопросы при ретрае).
11. **Осторожно:** доменное ограничение — эффективность FIRe зависит от плотности encompassings; для нематематических курсов (программирование — вероятно, плотность высокая, SQL/CAS — низкая) `[гипотеза]` замерять долю encompassing-рёбер до внедрения и не обещать «4×».

## 11. Источники (фактически прочитаны)

- https://www.mathacademy.com/ (главная: цена $49/mo, аудитория, аккредитация)
- https://www.mathacademy.com/how-it-works
- https://www.mathacademy.com/pedagogy
- https://www.mathacademy.com/how-our-ai-works
- https://www.mathacademy.com/faq (строки 1–335 целиком)
- https://www.mathacademy.com/about-us
- https://www.mathacademy.com/pricing — HTTP 404
- https://www.justinmath.com/individualized-spaced-repetition-in-hierarchical-knowledge-structures/ (FIRe/HSRS, формулы, Follow-Up)
- https://justinmath.com/how-math-academy-creates-its-knowledge-graph
- https://www.justinmath.com/books/ (оглавление *The Math Academy Way*, *Advice on Upskilling*)
- https://www.justinmath.com/files/the-math-academy-way.pdf — прочитаны фрагменты: оглавление; ch.1–2, ch.4, ch.21 (remediation), ch.22 (gamification), ch.29–30 (HSRS, диагностика), FAQ (Task Dashboard, «Features that Do Not Exist», LLM, происхождение контента, Beta-цены)
- Поиск (только сниппеты, страницы не читались): https://biggo.com/news/202508150714_Math_Academy_Price_Debate, https://beginnersinai.org/mathacademy-explained, https://opened.co/blog/ai-tutors-homeschool
- Не прочитаны: главы книги 3, 5–20, 23–28, 31–32 и большая часть FAQ книги (напр. вопросы про интервалы ревью, interleaving, диагностику); /press, /courses, /testimonials `[НЕ ПОДТВЕРЖДЕНО]`
