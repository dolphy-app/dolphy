# vanderbilt-data-science/knowledge-spaces + Knowledge Space Theory (KST)

> Метод: прочитаны README, CLAUDE.md, `scripts/kst_utils.py` (полностью), `schemas/knowledge-graph.schema.json` (полностью), SKILL.md для 6 из 10 навыков полностью (extracting, mapping, building-surmise, constructing, validating, assessing) и частично (decomposing, updating), reference-файлы `query-algorithm-detail.md`, `blim-polim-models.md`, `kst-foundations.md`, `bibliography.md`. **Не читались** (НЕ ПОДТВЕРЖДЕНО их содержимое): `generating-learning-materials`, `planning-adaptive-instruction`, `lattice-theory.md`, `fca-methodology.md`, `validation-criteria.md`, `trace-operations.md`, `cbkst-overview.md`, `ecd-framework.md`, `taxonomy-frameworks.md`, `udl-scaffolding.md`, `differentiation-strategies.md`.

> **Важная поправка к формулировке задачи.** Пайплайн репозитория НЕ содержит: (а) отдельной стадии «pairwise prerequisite verification» отдельными LLM-вызовами с верификатором; (б) transitive reduction (в коде есть только transitive *closure*); (в) «diagnostic pool synthesis» как отдельной стадии (вопросы генерируются LLM на лету во время сессии оценки); (г) Kahn/Tarjan (цикл ищется обычным DFS с раскраской). Подробности ниже; поиск слов `transitive reduction`, `diagnostic` по репозиторию дал совпадения только на строки README, не связанные с этим (grep по GitHub-репозиторию).

---

## 1. Что это

`knowledge-spaces` — набор из **10 «Agent Skills»** (Markdown-промпты `SKILL.md` в `.claude/skills/`, стандарт agentskills.io) для Claude Code плюс один Python-модуль `scripts/kst_utils.py` и один JSON Schema. Реализует «полный KST-пайплайн»: материалы курса → граф знаний → адаптивная оценка (BLIM) → материалы → план занятия. Источник: https://github.com/vanderbilt-data-science/knowledge-spaces

- Лицензия: **MIT** (GitHub API: «MIT License»; README badge).
- Авторы: Vanderbilt Data Science Institute (README: «Built at the Vanderbilt Data Science Institute»); все 3 коммита от `jessespencersmith` (https://api.github.com/repos/vanderbilt-data-science/knowledge-spaces/commits).
- Статус/зрелость: 3 коммита за 2 дня — 2026-02-12 (initial release, рефактор в Agent Skills) и 2026-02-13 (правки имён навыков). Звёзд 28, форков 4, issues 2 (на момент чтения). Коммиты содержат `Co-Authored-By: Claude Opus 4.6` → значительная часть репозитория, вероятно, сгенерирована LLM `[ВЫВОД]`. В README «Empirical validation — testing the pipeline against real student data» перечислена как *желаемый вклад* (раздел Contributing) → эмпирической валидации нет. Каталог `graphs/` содержит только `.gitkeep` — **ни одного примера готового графа**, ни тестов в репозитории нет. Вывод: ранний research-prototype, не production.

## 2. Архитектура и стек

- **Нет сервера, БД, UI.** Всё — промпты + CLI-скрипт. «Состояние» = один JSON-файл `graphs/{domain-slug}-knowledge-graph.json`; CLAUDE.md: «Skills always read/write the graph file — never hold state in conversation only».
- Python 3.9+ stdlib (`json`, `itertools`, `collections`, `datetime`), без pip. Заявленное 3.9+ **не согласуется с кодом**: в `select_assessment_item` аннотация `-> str | None` без `from __future__ import annotations` вычисляется при определении функции и в 3.9 вызовет `TypeError` (синтаксис PEP 604 — 3.10+) `[ВЫВОД из чтения исходника, не запускалось]`.
- Развёртывание: `git clone`, запуск `claude` в каталоге репо; навыки можно копировать в другой проект (`.claude/skills/`, `scripts/`, `schemas/`) или вставлять как system prompt в Claude.ai/API (README «On Other Platforms»).
- Параллелизм: README/CLAUDE.md предлагают Claude Cowork (мульти-агент): Phase 1 параллельно, Phase 2 строго последовательно, Phase 3 параллельно по студентам. Слияние результатов параллельных агентов в один JSON — «will be merged» без описанного механизма (конфликты записи в один файл не обсуждаются).
- CLI `kst_utils.py`: `validate | closure [--apply] | enumerate [--max N] [--save] | paths | analytics | cycles | stats`.

## 3. Модель знаний и зависимостей

Единый формат — JSON Schema draft 2020-12 (`schemas/knowledge-graph.schema.json`, `required: [metadata, items, surmise_relations]`).

Ключевые элементы (выдержки из схемы):

```jsonc
"metadata": { "domain_name", "version" /* ^\d+\.\d+\.\d+$ */, "created_at", "updated_at",
  "provenance": { "source_materials": [..], "methodology": "..", "skills_applied": [..],
                  "change_log": [{ "timestamp","skill","description",
                                   "items_added","items_removed","relations_added","relations_removed" }] } }
"items[]": {   // required: id,label,description; minItems:1
  "id": "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
  "bloom_level": "remember|understand|apply|analyze|evaluate|create",
  "knowledge_type": "factual|conceptual|procedural|metacognitive",
  "dok_level": 1..4,                       // Webb DOK
  "solo_level": "pre-structural|uni-structural|multi-structural|relational|extended-abstract",
  "source_objectives": [..], "assessment_criteria": "string",
  "required_competences": [ "comp-id" | ["comp-a","comp-b"] ],  // conj. по умолчанию; массив массивов = дизъюнкция
  "tags": [..] }
"surmise_relations[]": { // required: prerequisite,target
  "prerequisite","target","confidence": 0..1,"rationale",
  "relation_type": "prerequisite-of|is-a|part-of|co-requisite|related-to",
  "source": "query-algorithm|concept-map|expert-input|transitive-closure|iita|expert-and-iita" }
"competences[]": { id,label,description,"competence_type": "cognitive|procedural|metacognitive|dispositional" }
"competence_relations[]": { prerequisite,target,confidence,rationale }
"knowledge_states[]": { id, items[], inner_fringe[], outer_fringe[] }
"learning_paths[]": { id,label,sequence[],description }
"student_states": { "<student-id>": { current_state (state-id | [item ids]), inner_fringe, outer_fringe,
     competence_state, history[{timestamp,state,trigger}],
     assessment_log[{timestamp,item_id,response: correct|incorrect|partial|skipped,question,details}] } }
```

Наблюдения:
- **Смысл ребра:** `(prerequisite=a, target=b)` ⇒ «мастерство b подразумевает (surmise) мастерство a». Схема не запрещает `is-a`/`related-to`/`co-requisite` в `surmise_relations`, но `build_adjacency` в коде **не фильтрует по `relation_type`** — все записи, включая `related-to`, становятся жёсткими пререквизитами при enumerate `[ВЫВОД из кода]`. Это потенциальный источник ложных зависимостей.
- **Граф хранится транзитивно замкнутым**: `validate` даёт WARN, если замыкание не материализовано; `closure --apply` дописывает производные рёбра с `source:"transitive-closure"`, `confidence:1.0` (ставится безусловно, даже если исходные confidence были 0.5). Это противоположно транзитивной редукции (Hasse-diagram хранить минимальным) — для нашего DAG-редактора неудобно: рёбра растут O(n²), diff'ы в Git шумные.
- **Прогресс студентов внутри того же файла, что и контент** (`student_states`) — смешение курса и learner state (см. п. 6).
- Соответствие ID: паттерн запрещает односимвольные ID и подчёркивания (регэксп требует ≥2 символов).
- Онтология: item = «assessable unit» («testable with a single assessment question»); competences (CbKST) — латентные навыки, ≥2 item на competence.

**Файловая раскладка, которую пишут навыки:** `graphs/intro-statistics-knowledge-graph.json` (пример из README; фактического файла в репо нет).

## 4. Алгоритм обучения/повторения

**Spaced repetition в репозитории отсутствует.** Нет ни FSRS/SM-2, ни модели забывания в коде. В bibliography перечислены «Learning & Forgetting Models» (de Chiusole et al. 2022; Stefanutti et al. 2021 — bivariate Markov), README заявляет их использование в «Planning Instruction, Updating Domain», но в прочитанных файлах и в `kst_utils.py` реализации нет (`generating`/`planning` не читались — `[НЕ ПОДТВЕРЖДЕНО]`).

Адаптивность = **выбор следующего элемента по внешней границе (outer fringe) текущего состояния** + генерация материалов LLM под этот элемент. `learning_paths`: три жадные стратегии в коде (`generate_learning_paths`): `breadth-first` (обратная частота тегов), `depth-first` (пересечение тегов с последним item), `max-unlock` (число новых доступных item). Все — эвристики по `tags`.

Определения (реализованы в `kst_utils.py`):
- Состояние = downset квазипорядка; `enumerate_downsets`: BFS от ∅, на каждом шаге добавляется любой item, все пререквизиты которого ∈ текущего состояния; множество состояний в `set[frozenset]`; лимит по умолчанию **10 000** (`--max`), при превышении — warning в stderr и **частичный** результат. Очередь — `list.pop(0)` (O(n)).
- `compute_fringes`: inner = {x ∈ K : K∖{x} ∈ states}; outer = {x ∉ K : K∪{x} ∈ states} — прямой перебор с проверкой принадлежности семейству.
- Ограничение масштаба: по первичному источнику ALEKS (см. §12) арифметика имеет 57 147 состояний, Beginning Algebra ≈60 000; т.е. реальный размер домена выходит за дефолтный лимит скрипта, а skill сам советует Implicit/Sampled/Basis/Fringe-only стратегии при >25 items (constructing SKILL.md) — но в коде эти стратегии **не реализованы**, только полное перечисление.

Метрики структуры (validating SKILL.md, вычисляются LLM, не скриптом): discrimination index `|K|/2^|Q|`, bottleneck score, fringe compactness и др.

## 5. Верификация мастерства

- **Кто оценивает ответ:** в `assessing-knowledge-state` LLM (Claude) сам *генерирует вопрос*, *получает ответ студента* и *оценивает его* (`correct/incorrect/partial`), оценивая также g и s для конкретного формата вопроса («Estimated g and s for this specific question format»). Никаких детерминированных проверяющих (тесты, CAS, SQL) нет. То есть верификация — **LLM-as-judge**; это ровно тот компонент, который наша платформа должна заменить детерминированными проверками.
- Поле `assessment_criteria` (строка свободного текста) в item — единственная формализация «как проверять».
- Типы вопросов по Bloom-уровням — таблица в SKILL.md (MC/fill-in для Remember, worked problem для Apply и т.д.).
- Вероятностная часть (детерминированный код): BLIM.

### 5.1 BLIM в коде (`kst_utils.py`)

```python
def blim_update(state_probs, states, item_id, response_correct, lucky_guess=0.1, careless_error=0.1):
    for sid, prob in state_probs.items():
        in_state = item_id in states[sid]
        if response_correct: lik = (1 - careless_error) if in_state else lucky_guess
        else:                lik = careless_error       if in_state else (1 - lucky_guess)
        updated[sid] = prob * lik
    # нормализация на сумму
def select_assessment_item(...):  # выбирает item с P(mastered), ближайшей к 0.5
def entropy(probs): -sum(p*log2 p)
```
- Формула: `P(K|R) ∝ P(R|K)·P(K)`, локальная независимость (reference `blim-polim-models.md`). Параметры именуются `beta_q` (careless) / `eta_q` (lucky guess); в SKILL.md — `s_q`/`g_q`; в коде дефолт 0.1/0.1 глобально (не на item).
- **Расхождения SKILL.md ↔ код:** SKILL.md описывает «fringe preference», «Bloom's diversity», «topic coverage», «recency avoidance» при выборе вопроса, а `select_assessment_item` реализует **только** эвристику 50/50 (`abs(P−0.5)` минимум). Критерии остановки (entropy < 1.0 бит, P(top)>0.8, сумма top-3 >0.95, max 15–25 вопросов) в скрипте **отсутствуют** — их должен проверять LLM по инструкции. Точной информационной выгоды (IG) нет; reference сам называет 50/50 «аппроксимацией» IG с ценой O(|Q|·|K|).
- Выбор item — O(|Q|·|K|) за шаг; на 10⁴–10⁵ состояний в чистом Python это медленно `[ВЫВОД]`.
- Апостериор по состояниям — только по перечисленным `knowledge_states`; при `--max`-обрезке пространство неполно → оценка смещена.

### 5.2 Количество вопросов (что заявлено, и что подтверждено)

- README: «Repeat until entropy drops below threshold (~20-30 questions for moderate domains)».
- SKILL.md: max questions «typically 15-25»; entropy < 1.0 bit.
- reference: «ALEKS … typically converges in 15-25 items for domains of 200-500 items (Cosyn et al., 2021)» — ссылка на Cosyn et al. 2021 я **не проверял** по первоисточнику (`[НЕ ПОДТВЕРЖДЕНО]`). Проверенный первичный факт: в статье Falmagne, Cosyn, Doignon, Thiéry (ALEKS) один показанный assessment по Arithmetic занял **24 вопроса** (57 147 состояний, начальная энтропия 10.20 бит, максимум 10.96); ALEKS останавливается, когда (1) энтропия достигла критически низкого уровня и (2) нет больше полезных вопросов (все item с очень высокой/низкой вероятностью правильного ответа). Заявление репо «15–20 % сокращение длины от RNN-остановки (Matayoshi & Cosyn 2021)» — `[НЕ ПОДТВЕРЖДЕНО]` (источник в репо — собственный пересказ в reference, статью не читал).
- Важное отличие от ALEKS: ALEKS использует **только открытые ответы** («no multiple choice», lucky guess пренебрежимо мал) и кнопку «I don't know»; репо допускает MC (eta≈1/k, 0.25 для 4 вариантов) и даёт lucky guess по умолчанию 0.1, что сильно снижает информативность каждого ответа.

### 5.3 Расширения (только в документации, без кода)
PoLIM (политомные ответы, Stefanutti et al. 2020), MOCLIM (Anselmi et al. 2025), procedural KST/Markov solution processes, RNN-stopping — описаны в `blim-polim-models.md`, реализации в `kst_utils.py` нет. Параметры BLIM по данным: EM / MDML, R-пакет `pks` — упомянуты, не интегрированы.

## 6. Синхронизация, офлайн, приватность, экспорт/импорт

- **Синхронизации нет.** Локальный JSON, однопользовательский/однокомпьютерный режим; полностью офлайн в части скрипта, но каждый навык вызывает облачный LLM (Claude), т.е. **текст курса и ответы студентов отправляются провайдеру LLM** — политика приватности в репо не описана `[НЕ ПОДТВЕРЖДЕНО]`.
- Хранение студентов: `student_states` внутри общего файла с ключом student-id (в примерах — `student-alice`). Для класса это один файл, переписываемый разными агентами → риск гонок/конфликтов Git (репо не обсуждает) — именно наш заявленный риск «merge conflicts on progress state».
- Экспорт/импорт: только JSON + Mermaid-диаграммы (Hasse, concept map) как вывод LLM. Форматов KST-экосистемы (kstIO, R `kst`) нет, хотя пакеты перечислены в библиографии. Импорт: PDF/syllabus читает сам Claude Code.

## 7. Авторинг контента

Фактический рабочий процесс (README «Your First Knowledge Graph» и SKILL.md):
1. `/extracting-knowledge-items <syllabus.pdf>` → `items[]` + кандидаты `competences[]`.
2. (опц.) `/decomposing-learning-objectives` — раскладка целей по 5 таксономиям.
3. `/mapping-concepts-and-competences` → concept map, `competences`, `required_competences`, предварительные `surmise_relations` (`source:"concept-map"`).
4. `/building-surmise-relations` → «QUERY с AI как экспертом», `closure --apply`, `cycles`.
5. `/constructing-knowledge-space` → `enumerate --save`, `paths`.
6. `/validating-knowledge-structure` → `validate` + LLM-проверки.

Трение: 6 ручных вызовов; масштаб указан «~30–50 items» на курс «Intro Statistics» (README-пример, не реальный файл). Вход — только то, что читает Claude Code. Человек-эксперт участвует лишь как ревьюер флагов (`confidence < 0.6` → «flag for human review»); механизма ревью/принятия правок нет (правка JSON руками). Интеграция с LMS (Canvas/Moodle) — в списке «нужна помощь» (Contributing).

## 8. Монетизация / рынок / аудитория

Открытый MIT-проект, без цен и коммерции. Заявленная аудитория (README «Who Is This For?»): преподаватели, instructional designers, EdTech-разработчики, исследователи KST/EDM, пользователи Claude Code. Публикуемых данных об использовании нет (кроме 28 звёзд).

## 9. Сильные и слабые стороны

Сильные:
- Чёткая схема JSON Schema с provenance/change_log и confidence+rationale на каждом ребре — хороший образец аудируемости LLM-выводов.
- Детерминированный слой мал, но правильный: referential integrity, дубликаты, циклы, замыкание, самопетли, уникальность ID, union-closure (если состояния перечислены), Bloom-инверсии, >7 прямых пререквизитов, orphans, все в `validate` с кодом возврата 1 при FAIL.
- Семантика fringes (inner/outer) как «навигация» — компактный вывод для UX; проверено первоисточником (§12).
- Двойная таксономия Bloom × Webb DOK на уровне item + Hess CRM как проверка гранулярности («каждый item в одной клетке»).
- Явные confidence-пороги: <0.4 не включать, 0.4–0.5 флаг, 0.6–0.7 «вероятно», 0.8–0.9, 1.0 логически необходимо.
- Разделение «expert (QUERY)» / «data (IITA: DAKS, learning_spaces)» / «FCA» источников рёбер с полем `source` и протоколом слияния (agree/expert-only/IITA-only/conflict).

Слабые:
- **Оценка мастерства = LLM-as-judge**, генерация вопросов на лету → невоспроизводимо, нет детерминированных тестов; g/s назначаются LLM оценочно.
- «QUERY» — метафора: оригинальный QUERY (Koppen & Doignon 1990) — интерактивная процедура с экспертом с оптимальным порядком запросов; здесь LLM по своему усмотрению проходит пары («Efficiency strategy»: seed из concept-map, топологические уровни, независимость кластеров) без гарантий полноты и без логирования всех запросов («detailed logs for non-obvious decisions and summarize obvious ones in batch»). Заявленные оценки `O(n log n)` — из собственного reference, не проверены.
- Нет транзитивной редукции; граф хранится замкнутым; `relation_type` игнорируется при расчёте состояний.
- Нет проверки JSON Schema скриптом (в `validate_graph` нет jsonschema; skill просит «JSON schema validation» как пункт чек-листа, но делает это LLM). Нет проверок «executable tests» для item.
- DFS `detect_cycles` возвращает циклы, но не гарантирует все элементарные циклы (стандартный DFS раскраски); не Kahn/Tarjan SCC.
- Перечисление состояний экспоненциально; лимит 10 000 < реальных размеров ALEKS-доменов; альтернативы описаны только текстом.
- Нет SRS/забывания; состояние — бинарное «освоено», без времени → нет повторений и распада.
- Нет тестов, нет примера графа, 3 коммита; одна кодовая база, сгенерированная LLM; нет эмпирической валидации.
- Совместимость только с LLM-агентами (Claude Code/Agent Skills); каждый шаг — токены и недетерминизм.
- Конфликты параллельной записи одного JSON не решены.

## 10. Что заимствовать / чего избегать

Заимствовать:
1. **Схему узла**: `bloom_level` + `dok_level` + `knowledge_type` + `assessment_criteria` (заменить строку на исполняемый тест/ссылку на checker) — ловить слишком крупные item по Hess CRM.
2. **Рёбра с `confidence`, `rationale`, `source`**, порог «<0.4 не добавлять, <0.6 — на человеческий ревью»; в нашей платформе — обязательный ревью-статус в Git-diff.
3. **Детерминированный validator** как набор именованных проверок с PASS/WARN/FAIL и exit code (referential integrity, дубли, циклы, orphans, >7 prereq, Bloom-инверсии) — но реализовать циклы через Kahn/Tarjan SCC с выводом полного компонента.
4. **Fringes** (outer = «готов к изучению», inner = «недавно освоено/куда откатываться при трудностях») как базовый UX-примитив очередей; для больших графов считать fringe **напрямую по DAG** (item доступен, если все прямые prereq освоены), без перечисления состояний.
5. **BLIM-подобный байесовский апдейт** — как опциональный слой диагностики (вход-тест) со стартовым 50/50-выбором, но с per-item g/s, честными критериями остановки в коде и только детерминированно проверяемыми ответами (тогда g≈0 для open-response, как в ALEKS).
6. **Протокол слияния expert vs data-derived** (IITA/DAKS) как будущий loop: после накопления ответов пересматривать рёбра по нарушениям `a→b` и помечать расхождения.
7. Competence-слой (CbKST, `required_competences` с AND/OR-вложением) — использовать как необязательный слой тегов/навыков, не как обязательное поле.

Избегать:
8. Хранить транзитивное замыкание в исходных файлах курса — хранить **минимальные** рёбра (transitive reduction), замыкание вычислять при загрузке; иначе шумные diff'ы и O(n²) рёбер.
9. Смешивать контент и `student_states` в одном JSON (у нас — SQLite для learner state).
10. Полагаться на LLM для генерации вопросов и оценки ответа на лету; не игнорировать `relation_type`; не публиковать «QUERY» как гарантию — это LLM-эвристика.

## 11. Источники (фактически прочитаны)

- https://github.com/vanderbilt-data-science/knowledge-spaces (README, метаданные)
- https://raw.githubusercontent.com/vanderbilt-data-science/knowledge-spaces/main/scripts/kst_utils.py
- https://raw.githubusercontent.com/vanderbilt-data-science/knowledge-spaces/main/schemas/knowledge-graph.schema.json
- …/main/CLAUDE.md
- …/main/.claude/skills/{extracting-knowledge-items, mapping-concepts-and-competences, building-surmise-relations, constructing-knowledge-space, validating-knowledge-structure, assessing-knowledge-state}/SKILL.md
- …/main/.claude/skills/decomposing-learning-objectives/SKILL.md (строки 1-80), …/updating-knowledge-domain/SKILL.md (1-70)
- …/main/.claude/skills/building-surmise-relations/references/query-algorithm-detail.md (первые 300 из 331 строк)
- …/main/.claude/skills/assessing-knowledge-state/references/blim-polim-models.md (первые 300 из 314)
- …/main/.claude/skills/shared-references/kst-foundations.md (1-60)
- …/main/references/bibliography.md
- https://api.github.com/repos/vanderbilt-data-science/knowledge-spaces/commits
- https://en.wikipedia.org/wiki/Knowledge_space
- https://arxiv.org/abs/1511.06757 (Doignon & Falmagne, «Knowledge Spaces and Learning Spaces», abstract)
- https://www.aleks.com/about_aleks/Science_Behind_ALEKS.pdf (Falmagne, Cosyn, Doignon, Thiéry, «The Assessment of Knowledge, in Theory and in Practice»)

Про LLM-литературу по извлечению пререквизитов: репозиторий в прочитанных файлах ссылается лишь на «LLM-empowered knowledge extraction» (фраза в extracting SKILL.md) без цитаты; Huang et al. 2025 и Li et al. 2024 (FCA/CbKST) в bibliography — это математика FCA, не LLM. Отдельной библиографии по LLM-prerequisite extraction в репо **нет**. Я такие статьи не искал/не читал → `[НЕ ПОДТВЕРЖДЕНО]`.

---

## 12. Подраздел: KST / ALEKS — что удалось проверить

Из Falmagne et al. (ALEKS PDF) и Wikipedia/arXiv:
- KST введена Doignon & Falmagne в **1985** (Wikipedia; ALEKS PDF: «first paper … published in 1985»). Монография: Doignon & Falmagne, *Knowledge Spaces*, Springer 1999.
- **Knowledge state** — множество задач, которые человек способен решить; **knowledge structure** — выделенное семейство состояний. Пример: precedence diagram → состояния; для 6 типов задач из примера ровно 10 состояний и 6 learning paths.
- **Масштабы:** Beginning Algebra — диаграмма из **88 вершин**, ≈**60 000** состояний (из 2⁸⁸ подмножеств) и «billions» путей; Arithmetic — **57 147** состояний (домен до 108 типов задач в карте правдоподобия); комбинированная диаграмма Arithmetic→Pre-Calculus — **397** типов задач.
- **Fringes:** outer fringe = задачи p, добавление которых даёт состояние («what the student is ready to learn»); inner fringe — удаление даёт состояние («what the student can do»). Для «наиболее полезных» структур две fringe однозначно определяют состояние; в среднем **11** задач вместе; пример реального студента: **9** задач в fringes задают состояние из **80** задач (совпадает с утверждением README «80 items → ~9 fringe items»).
- **Построение:** эксперт отвечает на запросы типа Q1 («если студент не может решить p, может ли он решить p′?») — по ним точно восстанавливается precedence-структура; Q2 («не освоив p₁…pₙ, сможет ли решить p′?») — для общих knowledge spaces. Эксперту нужно ответить на «a few thousand» вопросов для типичной структуры; несколько экспертов + данные студентов для уточнения (удаление редких состояний, проверка предсказания ответа на дополнительную задачу p*: корреляция предсказанного/наблюдаемого **0.7–0.8** для Beginning Algebra). Крупные диаграммы собираются склейкой диаграмм по областям экспертным суждением.
- **Оценка (assessment):** априорные вероятности состояний (равные, если нет данных); первый вопрос выбирается так, чтобы сумма вероятностей состояний, содержащих задачу, была ближе к 0.5; апдейт повышает/понижает вероятности; кнопка «I don't know» резко снижает вероятность состояний с задачей; остановка — низкая энтропия **и** отсутствие полезных вопросов; итоговое состояние — самое вероятное (ответ с ошибкой в задаче состояния трактуется как careless error). В примере: 24 вопроса → одно из 57 147 состояний; начальная энтропия 10.20 бит (макс. 10.96). Ответы открытые, без multiple choice.
- ALEKS включает обучающий компонент: обучение «always on target, in the outer fringe» (ALEKS PDF); использовалось «several hundred colleges and school districts» (на момент написания статьи); финансирование NSF с 1983.
- arXiv:1511.06757 (Doignon, Falmagne 2015): «millions of students»; описывает вероятностную часть (Markov-процессы) и learning spaces как частный случай.
- Wikipedia: «defunct RATH» — второе приложение; пространства знаний при разумных допущениях образуют antimatroid; методы построения: опрос экспертов, item tree analysis по данным, анализ процессов решения.
- **Не проверено по первоисточнику:** Koppen & Doignon 1990 (QUERY) — только по пересказу в репо и Wikipedia (перечислена как метод), Heller & Stefanutti 2024 (CbKST), Cosyn et al. 2021 (числа «15–25 вопросов для 200–500 items» и «80 items → 9 fringe»: последнее подтверждено ALEKS-PDF, первое — нет), Matayoshi & Cosyn 2021 (RNN-остановка), BLIM (Doignon & Falmagne 1999, Ch. 7) — только через reference репо; формулы BLIM в репозитории соответствуют стандартной постановке (careless error / lucky guess, локальная независимость), но сверка с первоисточником не проводилась.
