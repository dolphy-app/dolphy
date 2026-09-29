/**
 * Замыкание графа курсов и уроков на битовых множествах для проверок
 * `E_ENC_NOT_ANCESTOR`, `E_KEYPREREQ_NOT_ANCESTOR` и `W_REDUNDANT_EDGE`.
 * Источник: spike/compiler/src/checks.ts (`buildClosure`, `redundantEdges`).
 */
import {
  buildIndexedGraph,
  findCycle,
  topoOrder,
  transitiveReduction,
} from '../domain/graph-algorithms.ts';
import type { IndexedGraph } from '../domain/graph-algorithms.ts';
import type { Index } from './checks.ts';

export interface Closure {
  readonly ids: readonly string[];
  readonly position: ReadonlyMap<string, number>;
  readonly words: number;
  /**
   * Предки по расширенному графу: зависимости урока плюс зависимости его
   * курса (курс их наследует), а зависимость от курса — это все его уроки.
   * Строка `v` — биты достижимых из `v` узлов.
   */
  readonly ancestors: Uint32Array;
  /** Объявленные зависимости (без повторов, порядок манифеста) без замыкающих рёбер циклов. */
  readonly declared: IndexedGraph;
  /** Топологический порядок расширенного графа: годится и для `declared`. */
  readonly order: Int32Array;
  /**
   * Первый цикл, возникший только из-за вложенности (урок зависит от курса,
   * который его содержит); `null`, если такого нет.
   */
  readonly containmentCycle: string[] | null;
}

/**
 * Отбрасывает замыкающее ребро каждого цикла, пока граф не станет ацикличным
 * (остальные проверки идут на приближённом замыкании). Возвращает первый
 * найденный цикл.
 */
const dropCycles = (
  adjacency: number[][],
  ids: readonly string[],
  position: ReadonlyMap<string, number>,
): string[] | null => {
  const neighbors = (id: string) =>
    (adjacency[position.get(id) as number] as number[]).map(
      (target) => ids[target] as string,
    );
  let first: string[] | null = null;
  for (;;) {
    const cycle = findCycle(ids, neighbors);
    if (cycle === null) return first;
    first ??= cycle;
    const from = position.get(cycle[cycle.length - 2] as string) as number;
    const to = position.get(cycle[cycle.length - 1] as string) as number;
    adjacency[from] = (adjacency[from] as number[]).filter((x) => x !== to);
  }
};

const unique = (values: Iterable<number>) => [...new Set(values)];

/** Никогда не бросает: при циклах замыкание приближённое (см. `dropCycles`). */
export const buildClosure = (index: Index): Closure => {
  const units = index.graphUnits;
  const ids = units.map(({ manifest }) => manifest.id);
  const position = new Map<string, number>();
  ids.forEach((id, i) => position.set(id, i));
  const declaredEdges = units.map(({ manifest }, i) =>
    unique(
      manifest.dependencies
        .map((dependency) => position.get(dependency))
        .filter(
          (target): target is number => target !== undefined && target !== i,
        ),
    ),
  );
  dropCycles(declaredEdges, ids, position);

  // зависимость от курса — зависимость и от всех его уроков
  const lessonsOf = (target: number) =>
    (index.lessonsOfCourse.get(ids[target] as string) ?? []).map(
      (lesson) => position.get(lesson) as number,
    );
  const expanded = declaredEdges.map((edges) =>
    unique(edges.flatMap((target) => [target, ...lessonsOf(target)])),
  );
  // урок наследует зависимости своего курса вместе с их раскрытием
  const augmented = units.map((unit, i) => {
    const course =
      'parentCourseId' in unit ? position.get(unit.parentCourseId) : undefined;
    const inherited =
      course === undefined ? [] : (expanded[course] as number[]);
    return unique([...(expanded[i] as number[]), ...inherited]);
  });
  const containmentCycle = dropCycles(augmented, ids, position);

  const augmentedGraph = buildIndexedGraph(ids, (id) =>
    (augmented[position.get(id) as number] as number[]).map(
      (t) => ids[t] as string,
    ),
  );
  const order = topoOrder(augmentedGraph);
  if (order === null)
    throw new Error('closure: cycle remains after dropCycles');
  const declared = buildIndexedGraph(ids, (id) =>
    (declaredEdges[position.get(id) as number] as number[]).map(
      (t) => ids[t] as string,
    ),
  );

  const words = (ids.length + 31) >>> 5;
  const ancestors = new Uint32Array(ids.length * words);
  const { offsets, targets } = augmentedGraph;
  for (const unit of order) {
    const base = unit * words;
    for (
      let e = offsets[unit] as number;
      e < (offsets[unit + 1] as number);
      e++
    ) {
      const target = targets[e] as number;
      const word = base + (target >>> 5);
      ancestors[word] = (ancestors[word] as number) | (1 << (target & 31));
      const targetBase = target * words;
      for (let w = 0; w < words; w++) {
        ancestors[base + w] =
          (ancestors[base + w] as number) |
          (ancestors[targetBase + w] as number);
      }
    }
  }
  return { ids, position, words, ancestors, declared, order, containmentCycle };
};

/** `to` — предок `from` по расширенному графу. */
export const hasAncestor = (
  closure: Closure,
  from: string,
  to: string,
): boolean => {
  const i = closure.position.get(from);
  const j = closure.position.get(to);
  if (i === undefined || j === undefined) return false;
  const word = closure.ancestors[i * closure.words + (j >>> 5)] as number;
  return (word & (1 << (j & 31))) !== 0;
};

/** Есть ли путь `from → to` по объявленным зависимостям. */
const reaches = (graph: IndexedGraph, from: number, to: number): boolean => {
  const visited = new Uint8Array(graph.size);
  const stack = [from];
  visited[from] = 1;
  while (stack.length > 0) {
    const unit = stack.pop() as number;
    if (unit === to) return true;
    for (
      let e = graph.offsets[unit] as number;
      e < (graph.offsets[unit + 1] as number);
      e++
    ) {
      const target = graph.targets[e] as number;
      if (visited[target] === 1) continue;
      visited[target] = 1;
      stack.push(target);
    }
  }
  return false;
};

/**
 * Транзитивно избыточные рёбра объявленных зависимостей: `[юнит, зависимость,
 * обходной пререквизит]`. Обходной — первая другая зависимость юнита (в порядке
 * манифеста), из которой достижима избыточная.
 */
export const redundantEdges = (
  closure: Closure,
): Array<readonly [unit: string, dependency: string, via: string]> => {
  const { declared, order, ids } = closure;
  const { keep } = transitiveReduction(declared, order);
  const { offsets, targets } = declared;
  const removed: Array<readonly [string, string, string]> = [];
  for (let unit = 0; unit < declared.size; unit++) {
    const start = offsets[unit] as number;
    const end = offsets[unit + 1] as number;
    for (let e = start; e < end; e++) {
      if (keep[e] === 1) continue;
      const dependency = targets[e] as number;
      for (let other = start; other < end; other++) {
        const via = targets[other] as number;
        if (via === dependency || !reaches(declared, via, dependency)) continue;
        removed.push([
          ids[unit] as string,
          ids[dependency] as string,
          ids[via] as string,
        ]);
        break;
      }
    }
  }
  return removed;
};
