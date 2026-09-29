/**
 * Синтетика спайка диагностики (`synth.ts`, `placement.ts`): слоистые DAG,
 * случайные downset-ы, шумные оракулы, метрики и строгий гейт Trane.
 */
import type { TopicGraph } from '../../src/placement/index.ts';
import { buildTopicGraph } from '../../src/placement/index.ts';
import { createMulberry32 } from '../../src/planning/index.ts';

/** mulberry32-поток спайка: `next` — [0, 1), `int(n)` — целое из [0, n). */
export interface SpikeRng {
  next(): number;
  int(n: number): number;
}

export const mulberry32 = (seed: number): SpikeRng => {
  const next = createMulberry32(seed);
  return { next, int: (n) => Math.floor(next() * n) };
};

/**
 * Слоистый DAG: `width` тем в слое; тема слоя L ≥ 1 получает 1..3
 * пререквизита, ~70% из слоя L−1, остальные — из L−2..L−5. Избыточные
 * (транзитивно выводимые) рёбра возникают естественно.
 */
export const layeredDag = (
  size: number,
  width: number,
  rng: SpikeRng,
): TopicGraph => {
  const prerequisites: string[][] = [];
  for (let i = 0; i < size; i++) {
    const layer = Math.floor(i / width);
    if (layer === 0) {
      prerequisites.push([]);
      continue;
    }
    const want = 1 + rng.int(3);
    const chosen = new Set<number>();
    for (let g = 0; g < want * 6 && chosen.size < want; g++) {
      const back = rng.next() < 0.7 ? 1 : 2 + rng.int(4);
      const lo = Math.max(0, layer - back) * width;
      const hi = Math.min(size, lo + width);
      chosen.add(lo + rng.int(hi - lo));
    }
    prerequisites.push([...chosen].sort((a, b) => a - b).map((t) => `t${t}`));
  }
  const ids = Array.from({ length: size }, (_, i) => `t${i}`);
  return buildTopicGraph(ids, (id) => prerequisites[Number(id.slice(1))]);
};

const upOf = (graph: TopicGraph, topic: number) =>
  graph.upTargets.subarray(graph.upOffsets[topic], graph.upOffsets[topic + 1]);

const downOf = (graph: TopicGraph, topic: number) =>
  graph.downTargets.subarray(
    graph.downOffsets[topic],
    graph.downOffsets[topic + 1],
  );

/**
 * Случайный downset (известное замкнуто по прямым пререквизитам): целевой
 * размер ~ U[0, N], затем `mix` шагов случайного блуждания по downset-ам.
 */
export const randomDownset = (
  graph: TopicGraph,
  rng: SpikeRng,
  mix: number = graph.size,
): Uint8Array => {
  const n = graph.size;
  const inSet = new Uint8Array(n);
  const missing = new Int32Array(n);
  const dependentsIn = new Int32Array(n);
  for (let u = 0; u < n; u++) missing[u] = upOf(graph, u).length;
  const add = (u: number) => {
    inSet[u] = 1;
    for (const d of downOf(graph, u)) (missing[d] as number)--;
    for (const p of upOf(graph, u)) (dependentsIn[p] as number)++;
  };
  const remove = (u: number) => {
    inSet[u] = 0;
    for (const d of downOf(graph, u)) (missing[d] as number)++;
    for (const p of upOf(graph, u)) (dependentsIn[p] as number)--;
  };
  const pick = (predicate: (u: number) => boolean) => {
    const candidates: number[] = [];
    for (let u = 0; u < n; u++) if (predicate(u)) candidates.push(u);
    return candidates.length === 0
      ? -1
      : (candidates[rng.int(candidates.length)] as number);
  };
  const addable = (v: number) => inSet[v] === 0 && missing[v] === 0;
  const target = Math.floor(rng.next() * (n + 1));
  for (let size = 0; size < target; size++) {
    const u = pick(addable);
    if (u < 0) break;
    add(u);
  }
  for (let step = 0; step < mix; step++) {
    if (rng.next() < 0.5) {
      const u = pick(addable);
      if (u >= 0) add(u);
    } else {
      const u = pick((v) => inSet[v] === 1 && dependentsIn[v] === 0);
      if (u >= 0) remove(u);
    }
  }
  return inSet;
};

export const isDownset = (graph: TopicGraph, known: Uint8Array): boolean => {
  for (let u = 0; u < graph.size; u++) {
    if (known[u] !== 1) continue;
    for (const p of upOf(graph, u)) if (known[p] !== 1) return false;
  }
  return true;
};

/** Шумная проверка: known — проход с вероятностью 1−slip, unknown — guess. */
export const noisyOracle =
  (known: Uint8Array, slip: number, guess: number, rng: SpikeRng) =>
  (topic: number) =>
    known[topic] === 1 ? rng.next() >= slip : rng.next() < guess;

/** Оракул с заранее вытянутым шумом на тему (общие случайные числа). */
export const fixedNoiseOracle =
  (known: Uint8Array, slip: number, guess: number, draws: Float64Array) =>
  (topic: number) =>
    known[topic] === 1
      ? (draws[topic] as number) >= slip
      : (draws[topic] as number) < guess;

/** Истинный фронтир: не known, все прямые пререквизиты known. */
export const trueFrontier = (graph: TopicGraph, known: Uint8Array) => {
  const frontier: number[] = [];
  for (let u = 0; u < graph.size; u++) {
    if (known[u] === 1) continue;
    if (upOf(graph, u).every((p) => known[p] === 1)) frontier.push(u);
  }
  return frontier;
};

export interface Metrics {
  /** (верные known + верные unknown) / N; uncertain считается ошибкой. */
  accuracy: number;
  uncertain: number;
  falseKnown: number;
  falseUnknown: number;
  /** Доля ложных known среди предсказанных known (0, если known нет). */
  fkShareOfKnown: number;
}

export const metrics = (
  size: number,
  truth: Uint8Array,
  classes: ArrayLike<number>,
): Metrics => {
  let knownKnown = 0;
  let unknownUnknown = 0;
  let uncertain = 0;
  let falseKnown = 0;
  let falseUnknown = 0;
  for (let u = 0; u < size; u++) {
    const c = classes[u];
    if (c === 2) uncertain++;
    else if (truth[u] === 1) {
      if (c === 1) knownKnown++;
      else falseUnknown++;
    } else if (c === 1) falseKnown++;
    else unknownUnknown++;
  }
  const predictedKnown = knownKnown + falseKnown;
  return {
    accuracy: (knownKnown + unknownUnknown) / size,
    uncertain: uncertain / size,
    falseKnown: falseKnown / size,
    falseUnknown: falseUnknown / size,
    fkShareOfKnown: predictedKnown === 0 ? 0 : falseKnown / predictedKnown,
  };
};

export interface LessonInfo {
  id: string;
  exercises: readonly string[];
}

export interface GateAttempt {
  exerciseId: string;
  lessonId: string;
  grade: number;
  at: number;
}

const MIN_SCORE = 3.0;
const MIN_AVG_TRIALS = 1.8;

/**
 * Гейт урока как `passes_threshold` Trane v0.34.1, строгий режим: оценка
 * урока — среднее последних оценок упражнений (без попыток — 0), среднее
 * число попыток — по упражнениям с попытками; нет данных — закрыт.
 */
export const lessonPasses = (
  lesson: LessonInfo,
  attempts: readonly GateAttempt[],
): boolean => {
  if (lesson.exercises.length === 0) return false;
  let scoreSum = 0;
  let tried = 0;
  let trials = 0;
  for (const exercise of lesson.exercises) {
    const own = attempts.filter(
      (a) => a.lessonId === lesson.id && a.exerciseId === exercise,
    );
    if (own.length === 0) continue;
    tried++;
    trials += own.length;
    scoreSum += own.reduce((best, x) => (x.at >= best.at ? x : best)).grade;
  }
  if (tried === 0) return false;
  return (
    scoreSum / lesson.exercises.length >= MIN_SCORE &&
    trials / tried >= MIN_AVG_TRIALS
  );
};

/** Уроки с открытым гейтом зависимостей, которые сами не пройдены. */
export const openFrontier = (
  graph: TopicGraph,
  lessons: readonly LessonInfo[],
  attempts: readonly GateAttempt[],
): number[] => {
  const passes = lessons.map((l) => lessonPasses(l, attempts));
  const frontier: number[] = [];
  for (let u = 0; u < graph.size; u++) {
    if (passes[u] === true) continue;
    if (upOf(graph, u).every((p) => passes[p] === true)) frontier.push(u);
  }
  return frontier;
};
