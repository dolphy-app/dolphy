import type { PlanGraph } from './plan-graph.ts';

/** Параметры неявного кредита (`SchedulerOptionsDto.implicitCredit`, без `enabled`). */
export interface CreditParams {
  /** Затухание на шаг охвата, `0 < λ ≤ 1`. */
  readonly lambda: number;
  /** Кредит ниже порога отбрасывается. */
  readonly minCredit: number;
  /** Множитель на итоговый кредит (не измерен, по умолчанию 1); итог зажат в 1. */
  readonly kappa: number;
}

export interface CreditEntry {
  readonly lesson: number;
  readonly weight: number;
}

/**
 * Кредит урока-источника всем достижимым по охвату урокам:
 * `w_u = max по путям (∏ весов рёбер · λ^глубина)`, обрез при `w < minCredit`
 * (граничное равенство остаётся); затем `min(1, κ·w)`. Дейкстра по максимуму,
 * кэш по уроку.
 */
export interface CreditModel {
  readonly graph: PlanGraph;
  readonly params: CreditParams;
  /** Кредиты урока `source` другим урокам, по возрастанию индекса урока. */
  of(source: number): readonly CreditEntry[];
}

const EPS = 1e-12;

interface HeapEntry {
  readonly weight: number;
  readonly lesson: number;
}

/** Двоичная куча по убыванию веса. */
const createMaxHeap = () => {
  const items: HeapEntry[] = [];
  const push = (entry: HeapEntry) => {
    let i = items.length;
    items.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((items[parent] as HeapEntry).weight >= entry.weight) break;
      items[i] = items[parent] as HeapEntry;
      i = parent;
    }
    items[i] = entry;
  };
  const pop = (): HeapEntry => {
    const top = items[0] as HeapEntry;
    const last = items.pop() as HeapEntry;
    const size = items.length;
    if (size > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= size) break;
        if (
          child + 1 < size &&
          (items[child + 1] as HeapEntry).weight >
            (items[child] as HeapEntry).weight
        ) {
          child++;
        }
        if ((items[child] as HeapEntry).weight <= last.weight) break;
        items[i] = items[child] as HeapEntry;
        i = child;
      }
      items[i] = last;
    }
    return top;
  };
  return { push, pop, size: () => items.length };
};

export const createCreditModel = (
  graph: PlanGraph,
  params: CreditParams,
): CreditModel => {
  const { lambda, minCredit, kappa } = params;
  if (!(lambda > 0 && lambda <= 1))
    throw new RangeError('lambda must be in (0, 1]');
  if (!(Number.isFinite(kappa) && kappa > 0)) {
    throw new RangeError('kappa must be positive');
  }
  const cache = new Array<readonly CreditEntry[] | undefined>(
    graph.lessonCount,
  );

  const compute = (source: number): CreditEntry[] => {
    const best = new Map<number, number>();
    const settled = new Set<number>();
    const heap = createMaxHeap();
    const relax = (from: number, base: number) => {
      const targets = graph.encompassTargets[from] as Int32Array;
      const weights = graph.encompassWeights[from] as Float64Array;
      for (let k = 0; k < targets.length; k++) {
        const target = targets[k] as number;
        if (target === source) continue;
        const weight = base * (weights[k] as number) * lambda;
        if (weight < minCredit - EPS || !(weight > 0)) continue;
        if (weight > (best.get(target) ?? 0)) {
          best.set(target, weight);
          heap.push({ weight, lesson: target });
        }
      }
    };
    relax(source, 1);
    while (heap.size() > 0) {
      const { weight, lesson } = heap.pop();
      if (settled.has(lesson) || weight < (best.get(lesson) ?? 0)) continue;
      settled.add(lesson);
      relax(lesson, weight);
    }
    return [...best.entries()]
      .map(([lesson, weight]) => ({
        lesson,
        weight: Math.min(1, kappa * weight),
      }))
      .sort((a, b) => a.lesson - b.lesson);
  };

  const of = (source: number) => {
    const hit = cache[source];
    if (hit !== undefined) return hit;
    const entries = compute(source);
    cache[source] = entries;
    return entries;
  };

  return { graph, params, of };
};
