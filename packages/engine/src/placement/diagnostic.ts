import { createSeededRng } from '../planning/seeded-random.ts';
import type { TopicGraph } from './topic-graph.ts';

/** Числовые классы темы: массивы классов плотные (`Uint8Array`), имена — для DTO. */
export const CLASS_UNKNOWN = 0;
export const CLASS_KNOWN = 1;
export const CLASS_UNCERTAIN = 2;

export type TopicClass = 'known' | 'unknown' | 'uncertain';

const CLASS_NAMES: readonly TopicClass[] = ['unknown', 'known', 'uncertain'];

export const topicClassName = (topicClass: number): TopicClass =>
  CLASS_NAMES[topicClass] as TopicClass;

/** Параметры диагностики (report-diagnostic.md §1; в продукции — только V3 с жёстким замыканием). */
export interface DiagnosticConfig {
  /** Максимум проб. */
  readonly budget: number;
  /** uint32: тай-брейки выбора пробы; при равных (seed, ответы) пробы равны. */
  readonly seed: number;
  /** Допущенные оценщиком вероятности угадывания и ошибки (не истинный шум ученика). */
  readonly guess?: number;
  readonly slip?: number;
  /** Тема решена, если `p ≤ lo` (unknown) или `p ≥ hi` (known). */
  readonly lo?: number;
  readonly hi?: number;
  /** `known` только после стольких независимых проходов (0 — выключено; 2 — проверки с угадыванием). */
  readonly minPass?: number;
}

export const DIAGNOSTIC_DEFAULTS = {
  guess: 0.05,
  slip: 0.05,
  lo: 0.15,
  hi: 0.85,
  minPass: 0,
} as const;

/** Логиты ограничены, чтобы накопление по замыканию оставалось конечным. */
const LOGIT_CAP = 30;

/**
 * Автомат диагностики над графом тем. Состояние — логиты `z = logit p` на тему.
 * Проход по теме `u` даёт `z_u += log((1 − slip)/guess)` и то же всем её
 * предкам (жёсткое замыкание, λ = 1, K = ∞); провал — `z += log(slip/(1 −
 * guess))` теме и всем её потомкам. Проба — середина самой длинной цепочки
 * нерешённых тем (V3), тай-брейки берутся из `seed`. Чистый синхронный код:
 * последовательность проб определяется (seed, ответы).
 */
export interface DiagnosticSession {
  readonly graph: TopicGraph;
  readonly budget: number;
  /** Темы, на которые уже отвечено, в порядке ответов. */
  readonly probes: readonly number[];
  readonly answers: readonly boolean[];
  /** Число тем с `p` между порогами (равно числу `uncertain`). */
  readonly unresolvedCount: number;
  probability(topic: number): number;
  classOf(topic: number): number;
  classes(): Uint8Array;
  /**
   * Следующая тема для пробы или `null` (всё решено, бюджет исчерпан, кандидатов
   * нет). До ответа возвращает ту же тему и не расходует поток случайных чисел.
   */
  nextProbe(): number | null;
  /** Исход пробы; повторный ответ по теме — `Error`, неизвестная тема — `RangeError`. */
  answer(topic: number, pass: boolean): void;
}

export const createDiagnosticSession = (
  graph: TopicGraph,
  config: DiagnosticConfig,
): DiagnosticSession => {
  const guess = config.guess ?? DIAGNOSTIC_DEFAULTS.guess;
  const slip = config.slip ?? DIAGNOSTIC_DEFAULTS.slip;
  const lo = config.lo ?? DIAGNOSTIC_DEFAULTS.lo;
  const hi = config.hi ?? DIAGNOSTIC_DEFAULTS.hi;
  const minPass = config.minPass ?? DIAGNOSTIC_DEFAULTS.minPass;
  if (!(guess > 0 && guess < 1 && slip > 0 && slip < 1)) {
    throw new RangeError('guess and slip must be in (0, 1)');
  }
  const { size, order, upOffsets, upTargets, downOffsets, downTargets } = graph;
  const rng = createSeededRng(config.seed);
  const weightPass = Math.log((1 - slip) / guess);
  const weightFail = Math.log(slip / (1 - guess)); // отрицательный

  const z = new Float64Array(size);
  const passEvents = new Uint16Array(size);
  const probed = new Uint8Array(size);
  const resolvedFlag = new Uint8Array(size);
  const stamp = new Int32Array(size);
  const chainLength = new Int32Array(size);
  const chainPrev = new Int32Array(size);
  const probes: number[] = [];
  const answers: boolean[] = [];
  let unresolved = 0;
  let pending: number | null = null;
  let visit = 0;

  const probability = (topic: number) =>
    1 / (1 + Math.exp(-(z[topic] as number)));

  const classOf = (topic: number) => {
    const p = probability(topic);
    if (p <= lo) return CLASS_UNKNOWN;
    if (p >= hi && (passEvents[topic] as number) >= minPass) return CLASS_KNOWN;
    return CLASS_UNCERTAIN;
  };

  const isResolved = (topic: number) => classOf(topic) !== CLASS_UNCERTAIN;

  for (let topic = 0; topic < size; topic++) {
    resolvedFlag[topic] = isResolved(topic) ? 1 : 0;
    if (resolvedFlag[topic] === 0) unresolved++;
  }

  const touch = (topic: number) => {
    const value = z[topic] as number;
    if (value > LOGIT_CAP) z[topic] = LOGIT_CAP;
    else if (value < -LOGIT_CAP) z[topic] = -LOGIT_CAP;
    const resolved = isResolved(topic) ? 1 : 0;
    if (resolved !== resolvedFlag[topic]) {
      unresolved += resolved === 1 ? -1 : 1;
      resolvedFlag[topic] = resolved;
    }
  };

  /** Обход замыкания без предвычисленных списков: O(размер замыкания), память O(N). */
  const closure = (
    start: number,
    offsets: Int32Array,
    targets: Int32Array,
    apply: (topic: number) => void,
  ) => {
    visit++;
    stamp[start] = visit;
    const stack = [start];
    while (stack.length > 0) {
      const unit = stack.pop() as number;
      for (
        let e = offsets[unit] as number;
        e < (offsets[unit + 1] as number);
        e++
      ) {
        const next = targets[e] as number;
        if (stamp[next] === visit) continue;
        stamp[next] = visit;
        apply(next);
        stack.push(next);
      }
    }
  };

  const answer = (topic: number, pass: boolean) => {
    if (!Number.isInteger(topic) || topic < 0 || topic >= size) {
      throw new RangeError('unknown topic');
    }
    if (probed[topic] === 1) throw new Error(`topic ${topic} already probed`);
    probed[topic] = 1;
    probes.push(topic);
    answers.push(pass);
    pending = null;
    if (pass) {
      (z[topic] as number) += weightPass;
      (passEvents[topic] as number)++;
      touch(topic);
      closure(topic, upOffsets, upTargets, (ancestor) => {
        (z[ancestor] as number) += weightPass;
        (passEvents[ancestor] as number)++;
        touch(ancestor);
      });
    } else {
      (z[topic] as number) += weightFail;
      touch(topic);
      closure(topic, downOffsets, downTargets, (descendant) => {
        (z[descendant] as number) += weightFail;
        touch(descendant);
      });
    }
  };

  const isCandidate = (topic: number) =>
    probed[topic] === 0 && resolvedFlag[topic] === 0;

  /** Самая неопределённая нерешённая тема; тай-брейк — `rng`. */
  const pickMostUncertain = (): number | null => {
    let best = -Infinity;
    const ties: number[] = [];
    for (let topic = 0; topic < size; topic++) {
      if (!isCandidate(topic)) continue;
      const score = 1 - Math.abs(2 * probability(topic) - 1);
      if (score > best + 1e-12) {
        best = score;
        ties.length = 0;
        ties.push(topic);
      } else if (score >= best - 1e-12) {
        ties.push(topic);
      }
    }
    return ties.length === 0
      ? null
      : (ties[rng.range(0, ties.length)] as number);
  };

  /** V3: бинарный поиск по самой длинной цепочке нерешённых тем. */
  const pickV3 = (): number | null => {
    let longest = 0;
    const ends: number[] = [];
    for (let k = 0; k < size; k++) {
      const topic = order[k] as number;
      if (resolvedFlag[topic] === 1) continue;
      let length = 1;
      let prev = -1;
      let tied = 0;
      for (
        let e = upOffsets[topic] as number;
        e < (upOffsets[topic + 1] as number);
        e++
      ) {
        const prerequisite = upTargets[e] as number;
        if (resolvedFlag[prerequisite] === 1) continue;
        const candidate = (chainLength[prerequisite] as number) + 1;
        if (candidate > length) {
          length = candidate;
          prev = prerequisite;
          tied = 1;
        } else if (candidate === length && prev >= 0) {
          tied++;
          if (rng.range(0, tied) === 0) prev = prerequisite;
        }
      }
      chainLength[topic] = length;
      chainPrev[topic] = prev;
      if (length > longest) {
        longest = length;
        ends.length = 0;
        ends.push(topic);
      } else if (length === longest) {
        ends.push(topic);
      }
    }
    if (ends.length === 0) return null;
    const chain: number[] = [];
    let end = ends[rng.range(0, ends.length)] as number;
    while (end >= 0) {
      chain.push(end);
      end = chainPrev[end] as number;
    }
    chain.reverse();
    const middle = chain.length >> 1;
    for (let offset = 0; offset < chain.length; offset++) {
      const positions =
        offset === 0 ? [middle] : [middle - offset, middle + offset];
      for (const position of positions) {
        const topic = chain[position];
        if (topic !== undefined && probed[topic] === 0) return topic;
      }
    }
    return pickMostUncertain();
  };

  const nextProbe = () => {
    if (pending !== null) return pending;
    if (probes.length >= config.budget || unresolved === 0) return null;
    pending = pickV3();
    return pending;
  };

  return {
    graph,
    budget: config.budget,
    probes,
    answers,
    get unresolvedCount() {
      return unresolved;
    },
    probability,
    classOf,
    classes: () => {
      const classes = new Uint8Array(size);
      for (let topic = 0; topic < size; topic++)
        classes[topic] = classOf(topic);
      return classes;
    },
    nextProbe,
    answer,
  };
};

/** Темы, которые не `known`, а все прямые (редуцированные) пререквизиты `known`. */
export const frontierOf = (
  graph: TopicGraph,
  classes: ArrayLike<number>,
): number[] => {
  const { size, upOffsets, upTargets } = graph;
  const frontier: number[] = [];
  for (let topic = 0; topic < size; topic++) {
    if (classes[topic] === CLASS_KNOWN) continue;
    let open = true;
    for (
      let e = upOffsets[topic] as number;
      e < (upOffsets[topic + 1] as number);
      e++
    ) {
      if (classes[upTargets[e] as number] !== CLASS_KNOWN) {
        open = false;
        break;
      }
    }
    if (open) frontier.push(topic);
  }
  return frontier;
};

/** Прогон целиком по оракулу ответов (тесты и симуляции). */
export const runDiagnostic = (
  session: DiagnosticSession,
  oracle: (topic: number) => boolean,
): Uint8Array => {
  for (let topic = session.nextProbe(); topic !== null;) {
    session.answer(topic, oracle(topic));
    topic = session.nextProbe();
  }
  return session.classes();
};
