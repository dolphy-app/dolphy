/**
 * Алгоритмы над графом зависимостей: поиск цикла, топологический порядок,
 * транзитивная редукция. Источник: spike/loader-bench/src/algo.ts.
 */

/**
 * Итеративный трёхцветный DFS (линейное время). Возвращает цикл как
 * `[a, b, c, a]` или `null`; порядок обхода — порядок `nodes` и `neighbors`.
 */
export const findCycle = (
  nodes: Iterable<string>,
  neighbors: (id: string) => Iterable<string>,
): string[] | null => {
  const state = new Map<string, 1 | 2>(); // 1 — на текущем пути, 2 — закончен
  const path: string[] = [];
  const iterators: Iterator<string>[] = [];
  for (const root of nodes) {
    if (state.has(root)) continue;
    state.set(root, 1);
    path.push(root);
    iterators.push(neighbors(root)[Symbol.iterator]());
    while (iterators.length > 0) {
      const iterator = iterators[iterators.length - 1] as Iterator<string>;
      const next = iterator.next();
      if (next.done) {
        state.set(path.pop() as string, 2);
        iterators.pop();
        continue;
      }
      const id = next.value;
      const mark = state.get(id);
      if (mark === 1) return [...path.slice(path.indexOf(id)), id];
      if (mark === undefined) {
        state.set(id, 1);
        path.push(id);
        iterators.push(neighbors(id)[Symbol.iterator]());
      }
    }
  }
  return null;
};

/** CSR зависимостей (ребро «юнит → его зависимость») над списком `ids`. */
export interface IndexedGraph {
  readonly size: number;
  readonly ids: readonly string[];
  readonly offsets: Int32Array;
  readonly targets: Int32Array;
  readonly edgeCount: number;
}

/**
 * Строит CSR; зависимости вне `ids` отбрасываются. `dependenciesOf`
 * вызывается по разу на юнит, порядок рёбер — порядок итерации.
 */
export const buildIndexedGraph = (
  ids: readonly string[],
  dependenciesOf: (id: string) => Iterable<string> | undefined,
): IndexedGraph => {
  const index = new Map<string, number>();
  ids.forEach((id, position) => index.set(id, position));
  const offsets = new Int32Array(ids.length + 1);
  const targets: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const dependencies = dependenciesOf(ids[i] as string);
    if (dependencies !== undefined) {
      for (const dependency of dependencies) {
        const target = index.get(dependency);
        if (target !== undefined) targets.push(target);
      }
    }
    offsets[i + 1] = targets.length;
  }
  return {
    size: ids.length,
    ids,
    offsets,
    targets: Int32Array.from(targets),
    edgeCount: targets.length,
  };
};

/** Порядок Кана, зависимости раньше зависимых; `null`, если есть цикл. */
export const topoOrder = (graph: IndexedGraph): Int32Array | null => {
  const { size, offsets, targets, edgeCount } = graph;
  const indegree = new Int32Array(size);
  const starts = new Int32Array(size + 1);
  for (let i = 0; i < size; i++) {
    indegree[i] = (offsets[i + 1] as number) - (offsets[i] as number);
    for (let e = offsets[i] as number; e < (offsets[i + 1] as number); e++) {
      (starts[(targets[e] as number) + 1] as number)++;
    }
  }
  for (let i = 0; i < size; i++) {
    starts[i + 1] = (starts[i + 1] as number) + (starts[i] as number);
  }
  const fill = starts.slice(0, size);
  const reversed = new Int32Array(edgeCount);
  for (let i = 0; i < size; i++) {
    for (let e = offsets[i] as number; e < (offsets[i + 1] as number); e++) {
      const target = targets[e] as number;
      reversed[fill[target] as number] = i;
      (fill[target] as number)++;
    }
  }
  const order = new Int32Array(size);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < size; i++) if (indegree[i] === 0) order[tail++] = i;
  while (head < tail) {
    const unit = order[head++] as number;
    for (
      let e = starts[unit] as number;
      e < (starts[unit + 1] as number);
      e++
    ) {
      const dependent = reversed[e] as number;
      indegree[dependent] = (indegree[dependent] as number) - 1;
      if (indegree[dependent] === 0) order[tail++] = dependent;
    }
  }
  return tail === size ? order : null;
};

export interface Reduction {
  /** `keep[e] === 1`, если ребро `e` (позиция в `targets`) необходимо. */
  keep: Uint8Array;
  kept: number;
  removed: number;
}

/**
 * Транзитивная редукция DAG на битовых множествах достижимости:
 * O(kept·n/32) времени, n²/8 байт. Зависимости юнита просматриваются от
 * ближайшей к дальней; уже достижимая через ближнюю — избыточна.
 */
export const transitiveReduction = (
  graph: IndexedGraph,
  order: Int32Array,
): Reduction => {
  const { size, offsets, targets, edgeCount } = graph;
  const words = (size + 31) >>> 5;
  const reach = new Uint32Array(size * words);
  const position = new Int32Array(size);
  for (let i = 0; i < size; i++) position[order[i] as number] = i;
  const keep = new Uint8Array(edgeCount);
  let kept = 0;
  const byProximity = (a: number, b: number) =>
    (position[targets[b] as number] as number) -
    (position[targets[a] as number] as number);
  for (let k = 0; k < size; k++) {
    const unit = order[k] as number;
    const base = unit * words;
    const edges: number[] = [];
    for (
      let e = offsets[unit] as number;
      e < (offsets[unit + 1] as number);
      e++
    ) {
      edges.push(e);
    }
    edges.sort(byProximity);
    for (const e of edges) {
      const target = targets[e] as number;
      const word = base + (target >>> 5);
      const mask = 1 << (target & 31);
      if (((reach[word] as number) & mask) !== 0) continue;
      keep[e] = 1;
      kept++;
      reach[word] = (reach[word] as number) | mask;
      const targetBase = target * words;
      for (let w = 0; w < words; w++) {
        reach[base + w] =
          (reach[base + w] as number) | (reach[targetBase + w] as number);
      }
    }
  }
  return { keep, kept, removed: edgeCount - kept };
};
